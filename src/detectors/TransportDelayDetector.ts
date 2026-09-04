import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

export type TransportDelayIssuePayload = {
	peerConnectionId: string;
	/** Smoothed round trip in milliseconds at the moment the issue was raised. */
	rttInMs: number;
	/** How long the round trip stayed above the threshold before raising, from stats timestamps. */
	sustainedForInMs: number;
	durationInMs?: number;
}

export type TransportDelayDetectorConfig = {
	/** Smoothed round trip (ms) at or above which the path counts as slow. */
	thresholdInMs: number;

	/**
	 * Round trip (ms) below which the issue resolves. Keep it under
	 * `thresholdInMs`: the gap is what stops a call sitting on the line from
	 * flapping the issue open and shut.
	 */
	recoveryThresholdInMs: number;

	/** How long (ms of stats time) the round trip must stay high before raising. */
	durationInMs: number;
}

/**
 * Reports a network path that works but takes too long — the round trip stays high enough, for long
 * enough, that conversation stops being conversation and becomes turn-taking. Every connectivity
 * stage completed and the path holds; delay is simply the property of it that makes the call bad.
 *
 * This is deliberately not congestion. `UplinkCongestionDetector` and `DownlinkCongestionDetector`
 * answer "is this path narrower than what is being put on it", which is about capacity and is a
 * different fault with a different fix. A path can be uncongested and slow (a long physical route, a
 * relay on the wrong continent) or congested and short. They will co-fire when both are true, and
 * none of them reads another to decide.
 *
 * `ewmaRttInSec` is already smoothed on the peer connection, which is the right input: a single
 * inflated RTT sample is common and means nothing. What this adds on top is duration — the round
 * trip must stay above `thresholdInMs` for `durationInMs` of *stats time* before anything is raised,
 * and must fall below `recoveryThresholdInMs` to clear. The gap between the two thresholds is what
 * stops a call sitting exactly on the line from flapping the issue open and shut.
 *
 * Note that RTT to an SFU is a half-path measurement and never sees the far leg, so this is evidence
 * about *this endpoint's* path and must not be presented as end-to-end latency.
 *
 * Issue raised: `transport-delay-degraded`. Monitor event: `transport-delay-degraded`.
 * Config: `transportDelayDetector`.
 *
 * Category: Transport Quality
 * Layer: Delay
 *
 */
export class TransportDelayDetector implements Detector {
	public static readonly ISSUE_TYPE = 'transport-delay-degraded';
	public readonly name = 'transport-delay-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _sustainedForInMs = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this.issueKey = `${TransportDelayDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.transportDelayDetector!;
	}

	public update() {
		if (this.disabled) return;

		const rttInSec = this.peerConnection.ewmaRttInSec;

		if (rttInSec === undefined) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		const rttInMs = rttInSec * 1000;

		if (rttInMs < this.config.recoveryThresholdInMs) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('round trip recovered');

			return;
		}

		if (rttInMs < this.config.thresholdInMs) return;

		this._sustainedForInMs += this.peerConnection.deltaTime ?? 0;

		if (this._raised) return;
		if (this._sustainedForInMs < this.config.durationInMs) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('transport-delay-degraded', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			rttInMs,
		});

		clientMonitor.raiseIssue<TransportDelayIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: TransportDelayDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				rttInMs,
				sustainedForInMs: this._sustainedForInMs,
			},
		});
	}

	private _resolve(comment: string) {
		this._raised = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: TransportDelayIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as TransportDelayIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<TransportDelayIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
