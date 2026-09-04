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
	/**
	 * The time threshold (in milliseconds) to determine if an inbound track
	 * is considered stalled.
	 */
	thresholdInMs: number;
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
 * That threshold is measured in the stream's own time: each dry tick adds the inbound RTP's
 * `deltaTime`, the gap between the two stats reports the zero-byte reading came from, rather than
 * wall-clock elapsed. The two only agree while collection runs on schedule, and a track goes dry
 * for reasons — a wedged main thread, a sleeping device — that make it run late. Wall-clock elapsed
 * would then count the library's own absence towards the threshold; the stats timestamps count the
 * stretch over which the browser genuinely saw no bytes.
 *
 * Raises `dry-inbound-track`. Emits `dry-inbound-track`. Config: `dryInboundTrackDetector`.
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
		if (this.disabled) return;
		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve(this.trackMonitor.paused ? 'consumer paused' : 'remote track paused');
			}
			return;
		}

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (inboundRtp?.deltaBytesReceived !== 0) {
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve('dry inbound track recovered');
			}
			return;
		}

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