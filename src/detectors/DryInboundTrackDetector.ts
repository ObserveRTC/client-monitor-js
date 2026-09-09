import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";

export type DryInboundTrackIssuePayload = {
	trackId: string;
	/** How long the track had already been dry when the issue was raised, in milliseconds of stats time. */
	duration: number;
	/** How long the episode lasted; filled in when the issue is resolved. */
	durationInMs?: number;
}

export type DryInboundTrackDetectorConfig = {
	/** How long (ms of stats time) an inbound track must be dry before it counts as stalled. */
	thresholdInMs: number;
}

/**
 * Reports one inbound track receiving zero bytes tick after tick — "their video is frozen" and "I
 * cannot hear them" at their most literal. Use it to catch the transmission failures that leave the
 * quality detectors quiet precisely because nothing is left to measure.
 *
 * A finding means delivery for this one track stopped while the connection itself stayed up: an
 * SFU that stopped forwarding, a producer that died, or a consumer wired to nothing. A connection
 * losing every track at once is a transport fault and belongs to the connectivity detectors.
 *
 * Silence is only a fault when unexplained: a paused consumer or a paused remote producer discards
 * the timer and resolves an open issue, naming which one it saw. A stall must last `thresholdInMs`
 * of the stream's own stats time — not wall clock, which would count the library's own late
 * collection towards the threshold — and is raised once per episode, not once per tick.
 *
 * Raises `dry-inbound-track`. Emits `dry-inbound-track`.
 * Track attribute: `InboundTrackMonitor.dry`.
 * Config: `dryInboundTrackDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — the wire to the track
 *
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

	/** Stats time accumulated over the current dry stretch; `0` whenever the silence is explained or over. */
	private _dryForInMs = 0;

	public update() {
		if (this.disabled) {
			this.trackMonitor.dry = undefined;

			return;
		}
		// A paused end legitimately sends nothing, so there is no silence to judge.
		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			this.trackMonitor.dry = undefined;
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve(this.trackMonitor.paused ? 'consumer paused' : 'remote track paused');
			}
			return;
		}

		const inboundRtp = this.trackMonitor.getInboundRtp();

		// No counter at all is blind; a non-zero one is bytes arriving, which is health.
		if (inboundRtp?.deltaBytesReceived === undefined) {
			this.trackMonitor.dry = undefined;
		}

		if (inboundRtp?.deltaBytesReceived !== 0) {
			if (inboundRtp?.deltaBytesReceived !== undefined) this.trackMonitor.dry = false;
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve('dry inbound track recovered');
			}
			return;
		}

		// Zero bytes, but not yet long enough to be a fault: judged, and not yet wrong.
		this.trackMonitor.dry = false;

		this._dryForInMs += inboundRtp.deltaTime ?? 0;

		const duration = this._dryForInMs;
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
		// Set here, not at the call site, so the flag and the finding cannot drift.
		this.trackMonitor.dry = true;
		this._startedDryAt = Date.now();

		this.trackMonitor.issues.raise({
				key: this.issueKey,
				includeInSample: this.includeIssueInSample,
			type: DryInboundTrackDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: DryInboundTrackIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DryInboundTrackIssuePayload),
				durationInMs: this._startedDryAt ? Date.now() - this._startedDryAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDryAt = undefined;
	}
}