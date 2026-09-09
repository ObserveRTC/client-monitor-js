import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { Detector } from "./Detector";

export type DryOutboundTrackIssuePayload = {
	trackId: string;
	/** How long the track had already been dry when the issue was raised, in milliseconds of stats time. */
	duration: number;
	/** How long the episode lasted; filled in when the issue is resolved. */
	durationInMs?: number;
}
export type DryOutboundTrackIssueType = 'dry-outbound-track';

export type DryOutboundTrackDetectorConfig = {
	/** How long (ms of stats time) an outbound track must be dry before it counts as stalled. */
	thresholdInMs: number;
}

/**
 * The sending-side counterpart: reports one outbound track sending zero bytes tick after tick — a
 * stalled encoder, a capture source that quietly stopped feeding it, or a sender that never really
 * started. Use it for the one failure the local user cannot see for themselves, since their own
 * preview keeps rendering.
 *
 * A paused sender, a muted track or a track no longer `live` explains the silence: any of them
 * discards the timer and resolves an open issue. A stall must last `thresholdInMs` of the sender's
 * own stats time — a busy main thread that collects late would otherwise be counted as evidence for
 * a stalled encoder — and is raised once per episode, not once per tick.
 *
 * Raises `dry-outbound-track`. Emits `dry-outbound-track`. Config: `dryOutboundTrackDetector`.
 * Track attribute: `OutboundTrackMonitor.dry`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — RTP sender to the wire
 *
 */
export class DryOutboundTrackDetector implements Detector {
	public static readonly ISSUE_TYPE: DryOutboundTrackIssueType = 'dry-outbound-track';

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

	/** Stats time accumulated over the current dry stretch; `0` whenever the silence is explained or over. */
	private _dryForInMs = 0;

	public update() {
		if (this.disabled) {
			this.trackMonitor.dry = undefined;

			return;
		}

		// A paused, muted or dead track legitimately sends nothing.
		if (this.trackMonitor.paused || this.trackMonitor.track.muted || this.trackMonitor.track.readyState !== 'live') {
			this.trackMonitor.dry = undefined;
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve('track paused, muted or not live');
			}
			return;
		}

		const outboundRtp = this.trackMonitor.getOutboundRtps()?.[0];

		// No counter at all is blind; a non-zero one is bytes leaving, which is health.
		if (outboundRtp?.deltaBytesSent === undefined) {
			this.trackMonitor.dry = undefined;
		}

		if (outboundRtp?.deltaBytesSent !== 0) {
			if (outboundRtp?.deltaBytesSent !== undefined) this.trackMonitor.dry = false;
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve('dry outbound track recovered');
			}
			return;
		}

		// Zero bytes, but not yet long enough to be a fault: judged, and not yet wrong.
		this.trackMonitor.dry = false;

		this._dryForInMs += outboundRtp.deltaTime ?? 0;

		const duration = this._dryForInMs;

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
		// Set here, not at the call site, so the flag and the finding cannot drift.
		this.trackMonitor.dry = true;
		this._startedDryAt = Date.now();

		// The track's own registry, never the client's: it forwards up, and resolving anywhere
		// else would leave this copy standing for the rest of the call.
		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: DryOutboundTrackDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: DryOutboundTrackIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DryOutboundTrackIssuePayload),
				durationInMs: this._startedDryAt ? Date.now() - this._startedDryAt : undefined,
			};
		}

		// Same registry the raise went to, so both copies close together.
		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDryAt = undefined;
	}
}