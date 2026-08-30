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
 * Asks one question of an outbound video track: is the capture device delivering the
 * frames the track was configured to capture? A camera degrading in place — a driver
 * struggling, another application contending for it, thermal throttling — reports
 * itself `live` and unmuted throughout while the far end's picture turns stuttery.
 * This is the capture half only; the encoder behind the device belongs to
 * `EncoderPerformanceDetector`, the decoder to `InboundFrameSupplyDetector`.
 *
 * Frames delivered and the time they had to arrive in are accumulated until
 * `durationInMs` of measured time has accrued, then the average is compared against
 * `getSettings().frameRate`: below `captureFpsRatioThreshold` of it raises, at or
 * above resolves, and the totals start over. A camera that is failing rather than
 * merely busy produces starving intervals interleaved with healthy ones — 150 frames
 * per 5s tick, then 132, then 150, then 97 — so tick by tick most of it looks fine and
 * per-tick thresholding never reaches it, while the average reads well under the
 * configured rate and raises with the camera still delivering. Averaging also weights
 * how far the source fell short rather than only how often. The rate is always the
 * frame counter differenced against measured elapsed time, never
 * `mediaSource.framesPerSecond`, which smooths this exact stutter away.
 *
 * Without `getSettings().frameRate` there is no judgement: nothing is substituted for
 * a missing baseline, because there would be nothing to fall short *of*. Screen shares
 * are refused, their frame rate being content-driven — a still document legitimately
 * delivers nothing, and an application capturing a moving surface can opt in with
 * `setOutboundTrackContext(id, { contentType: 'camera' })` — as are a backgrounded tab
 * and a paused, muted, disabled or ended sender. A restarted frame counter, a
 * collection gap or a capture-settings change restarts the totals rather than counting
 * against the device.
 *
 * Issue raised: `capture-bottleneck`, resolved when the average recovers or the
 * detector stands down.
 * Monitor event: `capture-bottleneck`.
 * Config: `outboundFrameSupplyDetector`.
 */
export class OutboundFrameSupplyDetector implements Detector {
	public static readonly ISSUE_TYPE = 'capture-bottleneck';

	public readonly name = 'outbound-frame-supply-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	private _framesInWindow = 0;
	private _windowSeconds = 0;
	private _lastTimestamp?: number;
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
		if (this.trackMonitor.isScreenShare) return this._reset('screen share');

		const mediaSource = this.trackMonitor.getMediaSource();
		const timestamp = mediaSource?.timestamp;

		if (timestamp === undefined) return;

		const previousTimestamp = this._lastTimestamp;

		this._lastTimestamp = timestamp;

		if (previousTimestamp === undefined) return;

		const elapsedInMs = timestamp - previousTimestamp;

		if (elapsedInMs <= 0) return;
		// Derived from `collectingPeriodInMs` rather than configured separately, so the bar follows whatever collection rate the application chose.
		if (maxTickGapInMs(this.peerConnection.parent.config.collectingPeriodInMs) < elapsedInMs) {
			return this._reset('collection gap');
		}

		// The frame counter, never `mediaSource.framesPerSecond`, which is coarse enough to smooth the stutter being looked for away.
		const sourceFps = mediaSource?.sourceFps;

		if (sourceFps === undefined) return this._reset('frame counter restarted');

		const settings = this._trackSettings();
		const signature = `${settings?.frameRate ?? ''}|${settings?.width ?? ''}|${settings?.height ?? ''}`;
		const changed = this._settingsSignature !== undefined && this._settingsSignature !== signature;

		this._settingsSignature = signature;

		if (changed) return this._reset('capture settings changed');

		const elapsedInSec = elapsedInMs / 1000;

		// Two running totals: frames accumulated over the elapsed time actually measured between ticks.
		// The average is judged once `durationInMs` of time has accrued, not once N ticks have passed.
		this._framesInWindow += sourceFps * elapsedInSec;
		this._windowSeconds += elapsedInSec;

		if (this._windowSeconds * 1000 < this.config.durationInMs) return;

		const averageFps = this._framesInWindow / this._windowSeconds;
		const expectedFps = settings?.frameRate;

		this._framesInWindow = 0;
		this._windowSeconds = 0;

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
