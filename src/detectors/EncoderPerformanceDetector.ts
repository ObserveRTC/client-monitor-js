import { Detector } from "./Detector";
import { OutboundFrameSupplyDetector } from "./OutboundFrameSupplyDetector";
import type { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import type { ClientIssuePayload } from "../ClientMonitorEvents";

export type EncoderBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Frames per second the capture source handed the encoder this interval. */
	sourceFps?: number;
	/** Frames per second the encoder managed on the highest active layer. */
	encodedFps?: number;
	encodeTimePerFrameInMs?: number;
	qualityLimitationReason?: string;
	/** Share of the interval the encoder spent CPU-limited, in `0..1`. */
	cpuLimitationShare?: number;
	encoderImplementation?: string;
	powerEfficientEncoder?: boolean;
	consecutiveTicks: number;
	durationInMs?: number;
}

export type EncoderPerformanceDetectorConfig = {
	/** Fraction of the source frame rate the encoder must fall below to count as behind. */
	encodeFpsRatioThreshold: number;
	/** Fraction of the per-frame budget encoding may consume before counting as too slow. */
	encodeTimeBudgetRatio: number;
	/**
	 * Share of the interval the browser reported itself CPU-limited, above which
	 * the encoder counts as bottlenecked — or **`null` to ignore that signal
	 * entirely**, which is the default.
	 *
	 * Off by default because `CpuPerformanceDetector` already reports CPU
	 * limitation as `cpulimitation`, and the useful thing to do with the two is
	 * to correlate them: `encoder-bottleneck` and `cpulimitation` firing
	 * together is evidence the encoder is CPU-bound. That inference is only
	 * worth anything while `encoder-bottleneck` is derived independently — read
	 * the CPU share here too and the correlation becomes tautological.
	 */
	cpuLimitationShareThreshold: number | null;
	/**
	 * Consecutive collections the condition must hold before raising.
	 *
	 * A tick count rather than a duration, deliberately, and for the opposite
	 * reason to `OutboundFrameSupplyDetector`'s `durationInMs`: this number is a
	 * *confidence* floor, not a persistence bar. Every signal below is a
	 * per-interval ratio that a single stats read can get wrong, so what is
	 * wanted is two independent reads agreeing — which is two samples, whatever
	 * the collecting period happens to be. `DecoderPerformanceDetector`, the
	 * receive-side mirror of this detector, uses ticks for the same reason.
	 */
	minConsecutiveTicks: number;
}

/**
 * Encoder Performance Detector
 *
 * Given a capture source that is delivering, is the encoder keeping up with it?
 * The send-side mirror of `DecoderPerformanceDetector`.
 *
 * Any one of three signals is enough:
 * - the highest active layer encodes below `encodeFpsRatioThreshold` of what the
 *   source delivered,
 * - encoding one frame costs more than `encodeTimeBudgetRatio` of the per-frame
 *   budget (`1000 / sourceFps`), or
 * - the browser reported itself CPU-limited for more than
 *   `cpuLimitationShareThreshold` of the interval — **only if configured**, see
 *   that field.
 *
 * **Everything is measured against what the source actually delivered**, never
 * against what the track was configured to capture at. An encoder handed 3fps
 * and emitting 3fps is doing its job perfectly; comparing it to a configured 30
 * would call that a catastrophic failure. Whether the source itself is short is
 * `OutboundFrameSupplyDetector`'s question, and while its `capture-bottleneck`
 * stands this detector says nothing — the frames were never there to encode.
 *
 * **Chained through the issue, not through a shared field.** The capture check
 * raises `capture-bottleneck`, and this reads
 * `ClientMonitor.isIssueActive(...)`. `OutboundTrackMonitor` registers the
 * capture detector first and `Detectors.update()` preserves that order, so the
 * verdict is same-tick.
 *
 * **Issues created:** `encoder-bottleneck`.
 */
export class EncoderPerformanceDetector implements Detector {
	public static readonly ISSUE_TYPE = 'encoder-bottleneck';

	public readonly name = 'encoder-performance-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private readonly _captureIssueKey: string;
	private _consecutiveTicks = 0;
	private _on = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		const trackId = trackMonitor.track.id;

		this._issueKey = `${EncoderPerformanceDetector.ISSUE_TYPE}-track-${trackId}`;
		this._captureIssueKey = `${OutboundFrameSupplyDetector.ISSUE_TYPE}-track-${trackId}`;
	}

	private get config(): EncoderPerformanceDetectorConfig {
		return this.peerConnection.parent.config.encoderPerformanceDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const track = this.trackMonitor.track;

		if (!this.peerConnection.parent.activeTab) return this._clear('tab in background');
		if (this.trackMonitor.paused) return this._clear('track paused');
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._clear('track not sending');
		// The source is short; the frames were never there to encode.
		if (this.peerConnection.parent.isIssueActive(this._captureIssueKey)) {
			return this._clear('capture is short; not an encoder problem');
		}

		const highestLayer = this.trackMonitor.getHighestLayer();

		if (!highestLayer || highestLayer.active === false) return;

		const sourceFps = this.trackMonitor.getMediaSource()?.sourceFps;

		// Nothing to compare against, and a zero divisor for the time budget.
		if (sourceFps === undefined || sourceFps <= 0) return this._clear('source delivering nothing');

		const encodedFps = highestLayer.framesPerSecond;
		const cpuLimitationShare = highestLayer.qualityLimitationDurationShares?.cpu;
		const cpuThreshold = this.config.cpuLimitationShareThreshold;

		const behind = encodedFps !== undefined && encodedFps < sourceFps * this.config.encodeFpsRatioThreshold;
		const tooSlow = highestLayer.encodeTimePerFrameInMs !== undefined &&
			(1000 / sourceFps) * this.config.encodeTimeBudgetRatio < highestLayer.encodeTimePerFrameInMs;
		const cpuLimited = cpuThreshold !== null &&
			cpuLimitationShare !== undefined &&
			cpuThreshold < cpuLimitationShare;

		if (!behind && !tooSlow && !cpuLimited) return this._clear('encoder keeping up again');

		this._consecutiveTicks += 1;

		if (this._on) return;
		if (this._consecutiveTicks < this.config.minConsecutiveTicks) return;

		this._on = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('encoder-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			sourceFps,
			encodedFps,
		});

		clientMonitor.raiseIssue<EncoderBottleneckIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: EncoderPerformanceDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				sourceFps,
				encodedFps,
				encodeTimePerFrameInMs: highestLayer.encodeTimePerFrameInMs,
				qualityLimitationReason: highestLayer.qualityLimitationReason,
				cpuLimitationShare,
				encoderImplementation: highestLayer.encoderImplementation,
				powerEfficientEncoder: highestLayer.powerEfficientEncoder,
				consecutiveTicks: this._consecutiveTicks,
			},
		});
	}

	private _clear(comment: string) {
		this._consecutiveTicks = 0;

		if (!this._on) return;

		this._on = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		clientMonitor.resolveIssue(this._issueKey, {
			comment,
			payload: issue
				? { ...issue.payload, durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined } as ClientIssuePayload
				: undefined,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
