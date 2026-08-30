import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { Detector } from "./Detector";

export type DryOutboundTrackIssuePayload = {
	trackId: string;
	/** How long the track had already been dry when the issue was raised, in milliseconds. */
	duration: number;
	/** How long the episode lasted; filled in when the issue is resolved. */
	durationInMs?: number;
}

/**
 * The sending-side counterpart: watches one outbound track for zero bytes sent tick after tick,
 * which is this client failing to put anything on the wire — a stalled encoder, a capture source
 * that quietly stopped feeding it, or a sender that never really started. It is the one failure
 * the local user cannot see for themselves, since their own preview keeps rendering.
 *
 * The track's own state supplies the explanations that make silence legitimate: a paused sender
 * (a paused producer, say), a muted track, or a track no longer in the `live` state. Any of them
 * discards the timer and resolves an open issue rather than leaving it hanging, because the
 * silence is now accounted for. A stall must last `thresholdInMs` before it is raised, once per
 * episode rather than once per tick.
 *
 * Raises `dry-outbound-track`. Emits `dry-outbound-track`. Config: `dryOutboundTrackDetector`.
 */
export class DryOutboundTrackDetector implements Detector {
	public static readonly ISSUE_TYPE = 'dry-outbound-track';
	public readonly name = 'dry-outbound-track-detector';
	public disabled = false;
	public includeIssueInSample = true;
	
	private readonly issueKey: string;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this.issueKey = `${DryOutboundTrackDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private _startedDryAt?: number;

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.dryOutboundTrackDetector!;
	}

	private _activatedAt?: number;

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.paused || this.trackMonitor.track.muted || this.trackMonitor.track.readyState !== 'live') {
			this._activatedAt = undefined;
			if (this._startedDryAt !== undefined) {
				this._resolve('track paused, muted or not live');
			}
			return;
		}

		if (this.trackMonitor.getOutboundRtps()?.[0]?.deltaBytesSent !== 0) {
			this._activatedAt = undefined;
			if (this._startedDryAt !== undefined) {
				this._resolve('dry outbound track recovered');
			}
			return;
		}

		if (!this._activatedAt) {
			this._activatedAt = Date.now();
		}

		const duration = Date.now() - this._activatedAt;

		if (duration < this.config.thresholdInMs) return;

		if (this._startedDryAt !== undefined) return;


		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dry-outbound-track', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		this._raise({
			trackId: this.trackMonitor.track.id,
			duration,
		});
	}

	private _raise(payload: DryOutboundTrackIssuePayload) {
		this._startedDryAt = Date.now();

		this.peerConnection.parent.raiseIssue<DryOutboundTrackIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: DryOutboundTrackDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: DryOutboundTrackIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DryOutboundTrackIssuePayload),
				durationInMs: this._startedDryAt ? Date.now() - this._startedDryAt : undefined,
			};
		}

		clientMonitor.resolveIssue<DryOutboundTrackIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDryAt = undefined;
	}
}