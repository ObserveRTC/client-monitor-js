import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";

export type PlayoutDiscrepancyIssuePayload = {
	trackId: string;
	/** Frames delivered to the track minus frames painted, over the tick that opened the episode. */
	frameSkew: number;
	/** {@link frameSkew} over the frames received in that tick — what the thresholds compare. */
	skewRatio?: number;
	/** The track's smoothed frame rate at that moment, for scale — a skew of 10 means very different things at 30fps and at 5. */
	ewmaFps?: number;
	/** How long the episode lasted; filled in on resolution. */
	durationInMs?: number;
}

/**
 * Compares the frames delivered to an inbound video track against the frames the
 * browser actually painted, and reports when the two diverge: video that arrives
 * perfectly well over the network and never reaches the screen. The viewer sees a
 * frozen or stuttering tile while every network statistic reads healthy, which is what
 * makes this worth separating from loss, jitter or a decoder problem — the frames are
 * here, and the rendering path is what dropped them.
 *
 * The two skew thresholds are hysteresis rather than two conditions: the episode opens
 * once the per-tick skew reaches `highSkewThreshold` and closes only once it falls
 * below `lowSkewThreshold`, so a track hovering at the boundary does not flap the issue
 * on and off. A tick where nothing was painted at all (`deltaFramesRendered === 0`) is
 * judged like any other — it is the worst case of the failure being looked for, not a
 * missing measurement.
 *
 * It refuses to judge a backgrounded tab, where the browser stops rendering by design
 * and the skew is throttling rather than a fault, and it stands down on a paused
 * consumer or a paused remote sender, resolving any open episode in each case. A tick
 * with no `deltaFramesReceived` or no `deltaFramesRendered` carries no measurement and
 * is skipped without disturbing the current state.
 *
 * Issue raised: `inbound-video-playout-discrepancy`, resolved when the skew drops below
 * the low threshold or the detector stands down.
 * Monitor event: `inbound-video-playout-discrepancy`.
 * Config: `playoutDiscrepancyDetector`.
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

		if (this.disabled) return;

		if (!this.peerConnection.parent.activeTab) {
			if (this.active) {
				this._resolve('tab in background');
				this.active = false;
			}

			return;
		}

		if (this.trackMonitor.paused) return this._standDown('consumer paused');
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._standDown('remote track paused');

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp) return;

		if (inboundRtp.deltaFramesReceived === undefined) return;
		if (inboundRtp.deltaFramesRendered === undefined) return;

		const framesReceived = inboundRtp.deltaFramesReceived;

		if (framesReceived < this.config.minFramesReceived) return this._standDown('too few frames to judge');

		const frameSkew = framesReceived - inboundRtp.deltaFramesRendered;
		const skewRatio = frameSkew / framesReceived;

		if (this.active) {
			if (skewRatio < this.config.lowSkewRatio) {
				this._resolve('playout discrepancy ended');
				this.active = false;
				return;
			}

			return;
		}

		if (skewRatio < this.config.highSkewRatio) return;

		this.active = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit(PlayoutDiscrepancyDetector.ISSUE_TYPE, {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		this._raise({
			trackId: this.trackMonitor.track.id,
			frameSkew,
			skewRatio,
			ewmaFps: inboundRtp.ewmaFps,
		});
	}

	private _raise(payload: PlayoutDiscrepancyIssuePayload) {
		this._startedDiscrepancyAt = Date.now();

		this.peerConnection.parent.raiseIssue<PlayoutDiscrepancyIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: PlayoutDiscrepancyDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: PlayoutDiscrepancyIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as PlayoutDiscrepancyIssuePayload),
				durationInMs: this._startedDiscrepancyAt ? Date.now() - this._startedDiscrepancyAt : undefined,
			};
		}

		clientMonitor.resolveIssue<PlayoutDiscrepancyIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDiscrepancyAt = undefined;
	}
}