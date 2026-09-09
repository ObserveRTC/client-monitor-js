import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";

export type PlayoutDiscrepancyIssuePayload = {
	trackId: string;
	/** Frames delivered to the track minus frames painted, over the tick that opened the episode. */
	frameSkew: number;
	/** {@link frameSkew} over the frames received in that tick — what the thresholds compare. */
	skewRatio?: number;
	/** The track's smoothed frame rate at that moment, for scale. */
	ewmaFps?: number;
	/** Filled in when the finding closes. */
	durationInMs?: number;
}

export type PlayoutDiscrepancyDetectorConfig = {
	/** Skew ratio at which an open episode resolves. */
	lowSkewRatio: number;

	/** Skew ratio at which an episode opens. A ratio, not a frame count, so it means the same at every interval and frame rate. */
	highSkewRatio: number;

	/** Frames the interval must carry before the ratio is computed at all. */
	minFramesReceived: number;
}

/**
 * Reports frames that arrived at an inbound video track but were never painted. Use it to tell a
 * rendering-path fault apart from loss, jitter or a slow decoder: the viewer sees a frozen or
 * stuttering tile while every network statistic reads healthy, because the frames are here and
 * something after the network dropped them.
 *
 * A finding means the fault is after the network and after the decoder: a throttled or hidden
 * element, a compositor under load, or a renderer that cannot keep up with the machine it is on.
 * Nothing about the call needs fixing; the page or the device does.
 *
 * Both frame counters come from `InboundTrackMonitor.detectionRecoveryWindow` rather than from one
 * collection's deltas, so the ratio is an average over the window the whole inbound cluster judges
 * on. That is what catches a renderer dropping in bursts: interleave a stalled second with a clean
 * one and no single collection need cross the bar, while the window still shows a tenth of the
 * picture going unpainted. Endpoint differencing also means a missed collection costs nothing,
 * because the totals carry across it.
 *
 * The two skew ratios are hysteresis, not two conditions — the episode opens above `highSkewRatio`
 * and closes only below `lowSkewRatio`, so a track at the boundary does not flap. That hysteresis
 * is the detector's own and is kept: the window supplies the measurement, not the resolve.
 *
 * It refuses to judge a backgrounded tab, a paused consumer or a paused remote sender, where the
 * skew is by design rather than a fault.
 *
 * Issue raised: `inbound-video-playout-discrepancy`, resolved when the skew drops below
 * the low threshold or the detector stands down.
 * Monitor event: `inbound-video-playout-discrepancy`.
 * Config: `playoutDiscrepancyDetector`.
 * Track attributes: `InboundTrackMonitor.playoutDiscrepancy` for the verdict, and
 * `InboundTrackMonitor.videoPlayoutSkew` for the share of arriving frames that went unpainted,
 * written on every judged collection whether or not it crossed a threshold.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — decoder to renderer
 *
 */
export class PlayoutDiscrepancyDetector implements Detector {
	public static readonly ISSUE_TYPE = 'inbound-video-playout-discrepancy';
	public readonly name = 'playout-discrepancy-detector';
	public disabled = false;
	public includeIssueInSample = true;
	
	private readonly issueKey: string;

	private _startedDiscrepancyAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${PlayoutDiscrepancyDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.playoutDiscrepancyDetector!;
	}

	public active = false;

	private _standDown(comment: string): void {
		if (!this.active) return;

		this._resolve(comment);
		this.active = false;
	}

	public update() {

		if (this.disabled) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			return;
		}

		if (!this.peerConnection.parent.activeTab) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			if (this.active) {
				this._resolve('tab in background');
				this.active = false;
			}

			return;
		}

		if (this.trackMonitor.paused) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			return this._standDown('consumer paused');
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			return this._standDown('remote track paused');
		}

		const window = this.trackMonitor.detectionRecoveryWindow;
		const framesReceived = window.detectionDelta.totalFramesReceived;
		const framesRendered = window.detectionDelta.totalFramesRendered;

		// No render counter over the window: the comparison cannot be made at all.
		if (framesReceived === null || framesRendered === null) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			return;
		}

		// Not judged before the window says it holds the stretch it is configured to cover.
		if (!window.detectionWindowIsReady) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			return;
		}

		if (framesReceived < this.config.minFramesReceived) {
			this.trackMonitor.playoutDiscrepancy = undefined;
			this.trackMonitor.videoPlayoutSkew = undefined;

			return this._standDown('too few frames to judge');
		}

		const frameSkew = framesReceived - framesRendered;
		const skewRatio = frameSkew / framesReceived;

		// Beside the flag: the measurement it was a verdict on, on every collection that was judged
		// rather than only the ones past the threshold, so a score can read how much of the picture
		// is being dropped before it becomes a finding.
		this.trackMonitor.videoPlayoutSkew = skewRatio;

		if (this.active) {
			if (skewRatio < this.config.lowSkewRatio) {
				this.trackMonitor.playoutDiscrepancy = false;
				this._resolve('playout discrepancy ended');
				this.active = false;
				return;
			}

			return;
		}

		if (skewRatio < this.config.highSkewRatio) {
			this.trackMonitor.playoutDiscrepancy = false;

			return;
		}

		this.active = true;
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.trackMonitor.playoutDiscrepancy = true;

		const clientMonitor = this.peerConnection.parent;

		// Spelled out rather than taken from the static: applications grep for the event name.
		clientMonitor.emit('inbound-video-playout-discrepancy', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		this._raise({
			trackId: this.trackMonitor.track.id,
			frameSkew,
			skewRatio,
			ewmaFps: this.trackMonitor.getInboundRtp()?.ewmaFps,
		});
	}

	private _raise(payload: PlayoutDiscrepancyIssuePayload) {
		this._startedDiscrepancyAt = Date.now();

		this.trackMonitor.issues.raise({
				key: this.issueKey,
				includeInSample: this.includeIssueInSample,
			type: PlayoutDiscrepancyDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: PlayoutDiscrepancyIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as PlayoutDiscrepancyIssuePayload),
				durationInMs: this._startedDiscrepancyAt ? Date.now() - this._startedDiscrepancyAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDiscrepancyAt = undefined;
	}
}