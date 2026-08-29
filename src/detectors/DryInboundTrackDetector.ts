import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";

export type DryInboundTrackIssuePayload = {
	trackId: string;
	/** How long the track had already been dry when the issue was raised, in milliseconds. */
	duration: number;
	/** How long the episode lasted; filled in when the issue is resolved. */
	durationInMs?: number;
}

/**
 * Watches one inbound track for the blunt case of media having stopped arriving: not degraded,
 * not concealed, but zero bytes received tick after tick. This is "their video is frozen" and
 * "I cannot hear them" at their most literal, and it catches the transmission failures that
 * leave the quality detectors quiet precisely because nothing is left to measure.
 *
 * Silence is only a fault when it is unexplained, so the detector stands down on both kinds of
 * deliberate silence and names which one it saw when it resolves: this leg's consumer being
 * paused, a local opt-out, and the remote producer being paused, where nobody is sending at all.
 * Either one discards the timer and resolves an already-raised issue, because the silence now
 * has an explanation even though no bytes have flowed. A stall must last `thresholdInMs` before
 * it is raised, and it is raised once per episode rather than once per tick.
 *
 * Raises `dry-inbound-track`. Emits `dry-inbound-track`. Config: `dryInboundTrackDetector`.
 */
export class DryInboundTrackDetector implements Detector {
	public static readonly ISSUE_TYPE = 'dry-inbound-track';
	public readonly name = 'dry-inbound-track-detector';
	public disabled = false;
	public includeIssueInSample = true;
	
	private readonly issueKey: string;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${DryInboundTrackDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private _startedDryAt?: number;

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.dryInboundTrackDetector!;
	}

	private _activatedAt?: number;

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			this._activatedAt = undefined;
			if (this._startedDryAt !== undefined) {
				this._resolve(this.trackMonitor.paused ? 'consumer paused' : 'remote track paused');
			}
			return;
		}

		if (this.trackMonitor.getInboundRtp()?.deltaBytesReceived !== 0) {
			this._activatedAt = undefined;
			if (this._startedDryAt !== undefined) {
				this._resolve('dry inbound track recovered');
			}
			return;
		}

		if (!this._activatedAt) {
			this._activatedAt = Date.now();
		}

		const duration = Date.now() - this._activatedAt;
		const clientMonitor = this.peerConnection.parent;

		if (duration < this.config.thresholdInMs) return;

		if (this._startedDryAt !== undefined) return;

		clientMonitor.emit('dry-inbound-track', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		this._raise({
			trackId: this.trackMonitor.track.id,
			duration,
		});
	}

	private _raise(payload: DryInboundTrackIssuePayload) {
		this._startedDryAt = Date.now();

		this.peerConnection.parent.raiseIssue<DryInboundTrackIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: DryInboundTrackDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: DryInboundTrackIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DryInboundTrackIssuePayload),
				durationInMs: this._startedDryAt ? Date.now() - this._startedDryAt : undefined,
			};
		}

		clientMonitor.resolveIssue<DryInboundTrackIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDryAt = undefined;
	}
}