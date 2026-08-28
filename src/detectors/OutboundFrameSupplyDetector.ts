import { Detector } from "./Detector";
import { maxTickGapInMs } from "../utils/common";
import type { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import type { ClientIssuePayload } from "../ClientMonitorEvents";
import type { FrameSupplyIssuePayload } from "../ClientMonitorIssues";

export type CaptureBottleneckIssuePayload = FrameSupplyIssuePayload;

export type OutboundFrameSupplyDetectorConfig = {
	/**
	 * How long the capture device is averaged over before it is judged.
	 *
	 * A duration rather than a tick count because what matters here is that the
	 * device stayed short for a stretch of time that means something — not that
	 * some number of samples agreed. (`EncoderPerformanceDetector` is the other
	 * way round, and says why there.)
	 */
	durationInMs: number;

	/** Fraction of the configured frame rate the capture average must stay above. */
	captureFpsRatioThreshold: number;
}

/**
 * Outbound Frame Supply Detector
 *
 * Is the capture device delivering the frames the track was configured to
 * capture? The send-side mirror of `InboundFrameSupplyDetector`, which asks the
 * same of the decoder.
 *
 * **The rule, in full.** Add up the frames the source delivered and the time it
 * had to deliver them. Once `durationInMs` has accumulated, compare the average
 * against `getSettings().frameRate`: below `captureFpsRatioThreshold` of it,
 * raise; at or above, resolve. Then start again. Two running totals, no history.
 *
 * **Why average rather than threshold each tick.** A camera that is failing
 * rather than merely busy dips and recovers: 150 frames per 5s tick becomes 132,
 * back to 150, then 97. Tick by tick most of it looks fine; the 15s average
 * reads 26.3fps against a configured 30 and raises while the camera is still
 * delivering. Averaging also weights *how far* the source fell short rather than
 * merely how often.
 *
 * **The rate is always the counter, never `mediaSource.framesPerSecond`.**
 * `sourceFps` is the frame counter differenced against *measured* elapsed time.
 * The browser's own figure is coarse and smooths this exact stutter away — it
 * can read `30` across an interval that actually delivered 132 frames in five
 * seconds. When `sourceFps` is undefined the counter restarted, and a restart is
 * not a measurement.
 *
 * **Without `getSettings().frameRate` there is no judgement.** Nothing is
 * substituted for a missing baseline: if the browser does not say what the track
 * was asked to capture at, there is nothing for the measured rate to fall short
 * *of*.
 *
 * **What it refuses to judge**, because a low frame rate there is legitimate: a
 * backgrounded tab, a paused or stopped sender, and screen shares, whose frame
 * rate is content-driven — a still document delivers nothing. Applications
 * capturing a moving surface that should be watched can say so with
 * `setOutboundTrackContext(id, { contentType: 'camera' })`. The totals also restart after a settings
 * change or a collection gap.
 *
 * **Issues created:** `capture-bottleneck`.
 */
export class OutboundFrameSupplyDetector implements Detector {
	public static readonly ISSUE_TYPE = 'capture-bottleneck';

	public readonly name = 'outbound-frame-supply-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	// The whole state: frames delivered so far, and the time they came over.
	private _framesInWindow = 0;
	private _windowSeconds = 0;
	/** Previous media-source timestamp, to measure each interval and spot gaps. */
	private _lastTimestamp?: number;
	/** `frameRate|width|height`, to spot a deliberate change mid-window. */
	private _settingsSignature?: string;

	private _on = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._issueKey = `${OutboundFrameSupplyDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config(): OutboundFrameSupplyDetectorConfig {
		return this.peerConnection.parent.config.outboundFrameSupplyDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const track = this.trackMonitor.track;

		if (!this.peerConnection.parent.activeTab) return this._reset('tab in background');
		if (this.trackMonitor.paused) return this._reset('track paused');
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._reset('track not sending');
		// Content-driven frame rate: nothing here can tell a still document apart
		// from a failing camera.
		if (this.trackMonitor.isScreenShare) return this._reset('screen share');

		const mediaSource = this.trackMonitor.getMediaSource();
		const timestamp = mediaSource?.timestamp;

		if (timestamp === undefined) return;

		const previousTimestamp = this._lastTimestamp;

		this._lastTimestamp = timestamp;

		// Nothing to difference against yet; this tick is the baseline.
		if (previousTimestamp === undefined) return;

		const elapsedInMs = timestamp - previousTimestamp;

		if (elapsedInMs <= 0) return;
		// The ticks themselves stopped, which says nothing about the device.
		if (maxTickGapInMs(this.peerConnection.parent.config.collectingPeriodInMs) < elapsedInMs) {
			return this._reset('collection gap');
		}

		const sourceFps = mediaSource?.sourceFps;

		if (sourceFps === undefined) return this._reset('frame counter restarted');

		// A deliberate resolution or frame-rate change restarts the totals: the
		// new settings are not the old ones falling short.
		const settings = this._trackSettings();
		const signature = `${settings?.frameRate ?? ''}|${settings?.width ?? ''}|${settings?.height ?? ''}`;
		const changed = this._settingsSignature !== undefined && this._settingsSignature !== signature;

		this._settingsSignature = signature;

		if (changed) return this._reset('capture settings changed');

		const elapsedInSec = elapsedInMs / 1000;

		this._framesInWindow += sourceFps * elapsedInSec;
		this._windowSeconds += elapsedInSec;

		if (this._windowSeconds * 1000 < this.config.durationInMs) return;

		const averageFps = this._framesInWindow / this._windowSeconds;
		const expectedFps = settings?.frameRate;

		this._framesInWindow = 0;
		this._windowSeconds = 0;

		// No configured frame rate means no bar to fall short of, and nothing is
		// assumed in its place: without the baseline there is no detection.
		if (expectedFps === undefined || expectedFps <= 0) return this._clear('no configured frame rate');
		if (expectedFps * this.config.captureFpsRatioThreshold <= averageFps) return this._clear('capture recovered');
		if (this._on) return;

		this._on = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('capture-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			sourceFps: averageFps,
			expectedFps,
		});

		clientMonitor.raiseIssue<CaptureBottleneckIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: OutboundFrameSupplyDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				sourceFps: averageFps,
				expectedFps,
				averagedOverInMs: this.config.durationInMs,
				sourceWidth: mediaSource?.width,
				sourceHeight: mediaSource?.height,
				trackReadyState: track.readyState,
				trackMuted: track.muted,
			},
		});
	}

	/** `getSettings()` throws on some platforms for a track being torn down. */
	private _trackSettings(): MediaTrackSettings | undefined {
		try {
			return this.trackMonitor.track.getSettings?.();
		} catch {
			return undefined;
		}
	}

	private _reset(comment: string) {
		this._lastTimestamp = undefined;

		this._clear(comment);
	}

	private _clear(comment: string) {
		this._framesInWindow = 0;
		this._windowSeconds = 0;

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
