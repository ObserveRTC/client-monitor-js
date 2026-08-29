import { Detector } from "./Detector";
import { OutboundFrameSupplyDetector } from "./OutboundFrameSupplyDetector";
import type { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import type { ClientIssuePayload } from "../ClientMonitorEvents";

/**
 * `sourceFps` is what the capture source handed the encoder over the interval and `encodedFps` what
 * the highest active layer managed of it — the pair the verdict is made on, never a configured rate.
 * `cpuLimitationShare` is the share of the interval (`0..1`) the browser reported itself CPU-limited,
 * carried for correlation even when it is not part of the trigger, and `consecutiveTicks` is how
 * many collections in a row agreed before raising.
 */
export type EncoderBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	sourceFps?: number;
	encodedFps?: number;
	encodeTimePerFrameInMs?: number;
	qualityLimitationReason?: string;
	cpuLimitationShare?: number;
	encoderImplementation?: string;
	powerEfficientEncoder?: boolean;
	consecutiveTicks: number;
	durationInMs?: number;
}

export type EncoderPerformanceDetectorConfig = {
	encodeFpsRatioThreshold: number;
	encodeTimeBudgetRatio: number;
	/** `null` by default: `CpuPerformanceDetector` already reports `cpulimitation`, so folding it in here would make the two correlate tautologically. */
	cpuLimitationShareThreshold: number | null;
	/** A tick count, not a duration: a confidence floor (two stats reads agreeing on a per-interval ratio), not a persistence bar. */
	minConsecutiveTicks: number;
}

/**
 * Given a capture source that is delivering, is the encoder keeping up with it? The send-side mirror
 * of `DecoderPerformanceDetector`, and one quadrant of the four video detectors that split pipeline
 * trouble along two axes: frames going *missing*, averaged over a duration
 * (`OutboundFrameSupplyDetector`, `InboundFrameSupplyDetector`), versus a stage that cannot *keep
 * up*, judged over consecutive ticks (this one and `DecoderPerformanceDetector`). The units are not
 * interchangeable: a duration is a persistence bar, while a tick count is a confidence floor —
 * every signal here is a per-interval ratio a single stats read can fabricate, so what is wanted is
 * two independent reads agreeing, whatever the collecting period happens to be.
 *
 * Any one of three signals raises: the highest active layer encodes below `encodeFpsRatioThreshold`
 * of what the source delivered; encoding one frame costs more than `encodeTimeBudgetRatio` of the
 * per-frame budget (`1000 / sourceFps`); or the browser reported itself CPU-limited for more than
 * `cpuLimitationShareThreshold` of the interval — the last only when that threshold is configured,
 * which by default it is not, so that `encoder-bottleneck` and `cpulimitation` stay independently
 * derived and correlating them still means something.
 *
 * Everything is judged against what the source actually delivered, never the configured capture
 * rate: an encoder handed 3fps and emitting 3fps is doing its job perfectly, and comparing that to a
 * configured 30 would call it a catastrophic failure. Whether the source itself is short is
 * `OutboundFrameSupplyDetector`'s question, and the two are mutually exclusive — while its
 * `capture-bottleneck` stands, this detector stands down, because an encoder handed too few frames
 * has nothing to answer for. The chain runs through `ClientMonitor.isIssueActive()` rather than a
 * shared field, and lands same-tick because `OutboundTrackMonitor` registers the capture detector
 * first and `Detectors.update()` preserves registration order. It also declines to judge a
 * backgrounded tab, a paused track, a track that is not live/unmuted/enabled, a track with no active
 * layer, and a source delivering nothing at all.
 *
 * Issue raised: `encoder-bottleneck`. Monitor event: `encoder-bottleneck`.
 * Config: `encoderPerformanceDetector`.
 */
export class EncoderPerformanceDetector implements Detector {
	public static readonly ISSUE_TYPE = 'encoder-bottleneck';

	public readonly name = 'encoder-performance-detector';
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
		// Chained through `OutboundFrameSupplyDetector`'s issue rather than a shared field; it lands
		// same-tick because `OutboundTrackMonitor` registers that detector first and `Detectors.update()` keeps the order.
		if (this.peerConnection.parent.isIssueActive(this._captureIssueKey)) {
			return this._clear('capture is short; not an encoder problem');
		}

		const highestLayer = this.trackMonitor.getHighestLayer();

		if (!highestLayer || highestLayer.active === false) return this._clear('no active layer');

		// `sourceFps` is derived from the frame counter, never `mediaSource.framesPerSecond`: the browser's
		// own figure is smoothed and hides exactly the stutter this compares against.
		const sourceFps = this.trackMonitor.getMediaSource()?.sourceFps;

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
