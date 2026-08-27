import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientIssuePayload } from "../ClientMonitorEvents";
import { maxTickGapInMs } from "../utils/common";
import { StarvingWindow } from "../utils/StarvingWindow";
import type { FrameSupplyIssuePayload } from "../ClientMonitorIssues";

export type CaptureBottleneckIssuePayload = FrameSupplyIssuePayload;

export type EncoderBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;
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

/**
 * Outbound Frame Supply Detector
 *
 * Splits one symptom — "we are sending fewer frames than we should" — into its
 * two distinct causes, which from RTP alone are indistinguishable:
 *
 * - **`capture-bottleneck`**: the capture device never produced the frames. A
 *   camera degrading, an OS-level capture stall, a device the browser is quietly
 *   downgrading. Nothing the encoder or the network can do about it.
 * - **`encoder-bottleneck`**: it produced them and the encoder could not keep up.
 *   A CPU-bound software encoder is the usual answer.
 *
 * One reading of `MediaSourceMonitor.sourceFps` answers both, which is why they
 * are one detector: the encoder question is "given a source delivering this
 * much, is the encoder keeping up?", and it needs the same number and the same
 * track guards the capture question already established.
 *
 * **Why the capture window rolls and does not count consecutive intervals.** A
 * camera that is failing rather than merely busy produces starving intervals
 * *interleaved* with healthy ones — 150 frames per 5s tick becomes 132, then 150
 * again, then 97. Any "N in a row" rule misses that by construction; it is a
 * property of the shape of the failure, not of the threshold. Counting
 * `minStarvingTimeInMs` of starving time anywhere inside `windowInMs` catches the
 * device while it is still delivering something, which is the only moment at
 * which anything can be done about it. The encoder half *does* count consecutive
 * ticks: an encoder falling behind does so continuously while the load lasts.
 *
 * **Why it never falls back to `mediaSource.framesPerSecond`.** The browser's own
 * figure is coarse and smooths this exact stutter away: it can read `30` across
 * an interval that actually delivered 132 frames in five seconds (~26.5fps).
 * `sourceFps` is the frame counter differenced against measured elapsed time. No
 * counter means no judgement.
 *
 * **What the capture half refuses to judge**, because a low frame rate there is
 * legitimate: a backgrounded tab (`ClientMonitor.activeTab === false`), a paused
 * or stopped sender, and screen shares, whose frame rate is content-driven — a
 * still document delivers nothing. The window is discarded rather than
 * interpreted after a settings change, a counter reset, or a gap longer than
 * a collection gap — whose threshold is derived from the monitor's own
 * `collectingPeriodInMs` rather than configured, since a fixed millisecond value
 * would mean something different at every collecting period. The encoder half
 * shares every guard except the screen-share
 * one: an encoder falling behind a screen share is as real as any other.
 *
 * **Issues created:**
 * - Type: `capture-bottleneck`
 * - Type: `encoder-bottleneck`
 */
export class OutboundFrameSupplyDetector implements Detector {
	public static readonly CAPTURE_ISSUE_TYPE = 'capture-bottleneck';
	public static readonly ENCODER_ISSUE_TYPE = 'encoder-bottleneck';

	public readonly name = 'outbound-frame-supply-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _captureIssueKey: string;
	private readonly _encoderIssueKey: string;
	private readonly _window = new StarvingWindow();

	/** Previous media-source timestamp, to measure the gap between collections. */
	private _lastTimestamp?: number;
	/** `frameRate|width|height` of the track's settings, to spot a deliberate change. */
	private _settingsSignature?: string;

	private _captureOn = false;
	private _captureStartedAt?: number;

	private _encoderTicks = 0;
	private _encoderOn = false;
	private _encoderStartedAt?: number;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		const trackId = trackMonitor.track.id;

		this._captureIssueKey = `${OutboundFrameSupplyDetector.CAPTURE_ISSUE_TYPE}-track-${trackId}`;
		this._encoderIssueKey = `${OutboundFrameSupplyDetector.ENCODER_ISSUE_TYPE}-track-${trackId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.outboundFrameSupplyDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Derived from the monitor's own cadence rather than configured. */
	private get _maxTickGapInMs() {
		return maxTickGapInMs(this.peerConnection.parent.config.collectingPeriodInMs);
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const track = this.trackMonitor.track;

		// A backgrounded tab is throttled by the browser, capture included.
		// Frames legitimately stop arriving there; that is not the device
		// degrading. The collection-gap guard catches a tab whose timers stopped,
		// but not one that keeps ticking while capture is throttled.
		if (!this.peerConnection.parent.activeTab) return this._reset('tab in background');
		// A paused, stopped, muted or disabled sender produces nothing on purpose.
		if (this.trackMonitor.paused) return this._reset('track paused');
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._reset('track not sending');

		const mediaSource = this.trackMonitor.getMediaSource();
		const timestamp = mediaSource?.timestamp;

		if (timestamp === undefined) return;

		const previousTimestamp = this._lastTimestamp;

		this._lastTimestamp = timestamp;

		// Nothing to difference against yet; this tick is the baseline.
		if (previousTimestamp === undefined) return;

		const elapsedInMs = timestamp - previousTimestamp;

		// Same reading twice, or a clock that went backwards: nothing to measure.
		if (elapsedInMs <= 0) return;

		// A gap far longer than the collecting period means the ticks themselves
		// stopped. Neither the gap nor the frames missing across it say anything
		// about the device, so the window restarts.
		if (this._maxTickGapInMs < elapsedInMs) return this._reset('collection gap; window restarted');

		// `sourceFps` is undefined when the browser reports no frame counter and
		// when the counter went backwards — a replaced track or a re-acquired
		// device. A restart is not a measurement.
		const sourceFps = mediaSource?.sourceFps;

		if (sourceFps === undefined) return this._reset('no comparable frame count');

		// A deliberate resolution or frame-rate change restarts the window: the
		// new settings are not the old ones falling short.
		const settings = this._trackSettings();
		const signature = `${settings?.frameRate ?? ''}|${settings?.width ?? ''}|${settings?.height ?? ''}`;
		const changed = this._settingsSignature !== undefined && this._settingsSignature !== signature;

		this._settingsSignature = signature;

		if (changed) return this._reset('track settings changed');

		if (this.trackMonitor.isScreenShare) {
			// Content-driven frame rate: nothing here can tell a still document
			// apart from a failing camera. An application capturing a moving
			// surface that should be watched can say so with
			// `setTrackContentType(id, 'camera')`.
			this._clearCapture('screen share');
		} else {
			this._judgeCapture(sourceFps, settings?.frameRate, elapsedInMs, mediaSource?.width, mediaSource?.height);
		}

		this._judgeEncoder(sourceFps);
	}

	/** `getSettings()` throws on some platforms for a track being torn down. */
	private _trackSettings(): MediaTrackSettings | undefined {
		try {
			return this.trackMonitor.track.getSettings?.();
		} catch {
			return undefined;
		}
	}

	private _judgeCapture(
		sourceFps: number,
		expectedFps: number | undefined,
		elapsedInMs: number,
		width?: number,
		height?: number,
	) {
		// Without a configured frame rate there is no bar to fall short of, so an
		// absolute floor stands in for the ratio.
		const floor = expectedFps !== undefined && 0 < expectedFps
			? expectedFps * this.config.fpsRatioThreshold
			: this.config.minProducedFps;

		const now = Date.now();

		this._window.evict(now, this.config.windowInMs);

		if (sourceFps < floor) this._window.push(now, sourceFps, elapsedInMs);

		if (this._window.empty) return this._clearCapture('capture recovered');
		if (this._captureOn) return;
		if (this._window.starvingTimeInMs < this.config.minStarvingTimeInMs) return;

		this._captureOn = true;
		this._captureStartedAt = now;

		const clientMonitor = this.peerConnection.parent;
		const track = this.trackMonitor.track;

		clientMonitor.emit('capture-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			sourceFps,
			expectedFps,
		});

		clientMonitor.raiseIssue<CaptureBottleneckIssuePayload>(this._captureIssueKey, {
			includeInSample: this.includeIssueInSample,
			type: OutboundFrameSupplyDetector.CAPTURE_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				sourceFps,
				expectedFps,
				sourceWidth: width,
				sourceHeight: height,
				starvingTimeInMs: this._window.starvingTimeInMs,
				windowSeconds: this.config.windowInMs / 1000,
				worstSourceFps: this._window.worstFps,
				msSinceFirstStarvingTick: now - this._window.oldestAt!,
				trackReadyState: track.readyState,
				trackMuted: track.muted,
			},
		});
	}

	/**
	 * Given a source that is delivering, is the encoder keeping up? Any one of
	 * three signals is enough: the highest active layer encodes below
	 * `encodeFpsRatioThreshold` of what the source delivered, encoding one frame
	 * costs more than `encodeTimeBudgetRatio` of the per-frame budget, or the
	 * encoder reported itself CPU-limited for more than
	 * `cpuLimitationShareThreshold` of the interval.
	 */
	private _judgeEncoder(sourceFps: number) {
		const highestLayer = this.trackMonitor.getHighestLayer();

		// Nothing is encoding, so there is no encoder question to answer.
		if (!highestLayer || highestLayer.active === false) return;

		// A starving source is a capture problem, not the encoder's fault.
		if (sourceFps < this.config.minProducedFps) {
			return this._clearEncoder('source not healthy; not an encoder problem');
		}

		const encodedFps = highestLayer.framesPerSecond;
		const cpuLimitationShare = highestLayer.qualityLimitationDurationShares?.cpu;

		const encoderBehind = encodedFps !== undefined &&
			encodedFps < sourceFps * this.config.encodeFpsRatioThreshold;

		const encodeTooSlow = highestLayer.encodeTimePerFrameInMs !== undefined &&
			(1000 / sourceFps) * this.config.encodeTimeBudgetRatio < highestLayer.encodeTimePerFrameInMs;

		const cpuLimited = cpuLimitationShare !== undefined &&
			this.config.cpuLimitationShareThreshold < cpuLimitationShare;

		if (!encoderBehind && !encodeTooSlow && !cpuLimited) {
			return this._clearEncoder('encoder keeping up again');
		}

		this._encoderTicks += 1;

		if (this._encoderOn) return;
		if (this._encoderTicks < this.config.minConsecutiveTicks) return;

		this._encoderOn = true;
		this._encoderStartedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('encoder-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			sourceFps,
			encodedFps,
		});

		clientMonitor.raiseIssue<EncoderBottleneckIssuePayload>(this._encoderIssueKey, {
			includeInSample: this.includeIssueInSample,
			type: OutboundFrameSupplyDetector.ENCODER_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				sourceFps,
				encodedFps,
				encodeTimePerFrameInMs: highestLayer.encodeTimePerFrameInMs,
				qualityLimitationReason: highestLayer.qualityLimitationReason,
				cpuLimitationShare,
				encoderImplementation: highestLayer.encoderImplementation,
				powerEfficientEncoder: highestLayer.powerEfficientEncoder,
				consecutiveTicks: this._encoderTicks,
			},
		});
	}

	private _reset(comment: string) {
		this._lastTimestamp = undefined;

		this._clearCapture(comment);
		this._clearEncoder(comment);
	}

	private _clearCapture(comment: string) {
		this._window.clear();

		if (!this._captureOn) return;

		this._captureOn = false;
		this._resolve(this._captureIssueKey, comment, this._captureStartedAt);
		this._captureStartedAt = undefined;
	}

	private _clearEncoder(comment: string) {
		this._encoderTicks = 0;

		if (!this._encoderOn) return;

		this._encoderOn = false;
		this._resolve(this._encoderIssueKey, comment, this._encoderStartedAt);
		this._encoderStartedAt = undefined;
	}

	private _resolve(issueKey: string, comment: string, startedAt?: number) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(issueKey);

		clientMonitor.resolveIssue(issueKey, {
			comment,
			payload: issue
				? {
					...issue.payload,
					durationInMs: startedAt ? Date.now() - startedAt : undefined,
				} as ClientIssuePayload
				: undefined,
			resolvedAt: Date.now(),
		});
	}
}
