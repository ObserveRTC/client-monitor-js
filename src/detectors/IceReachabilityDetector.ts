import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** A snapshot of the connection at the moment the diagnosis was made. */
export type NoAvailableIceCandidateIssuePayload = {
	peerConnectionId: string;
	connectionState?: string;
	/** The last state seen before the connection fell to `disconnected`/`failed`. */
	previousConnectionState?: string;
	iceGatheringState?: string;
	/** Always 0 when raised — the whole point — kept for the record. */
	localIceCandidateCount: number;
	/** Observed time the connection went without a candidate, in stats time. */
	sustainedForInMs: number;
	/** How long the issue stayed active; filled in on resolution. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'no-available-ice-candidate';

export type IceReachabilityDetectorConfig = {
	/** How long a never-connected peer connection may sit with zero candidates in `new`/`connecting`, in ms. */
	thresholdInMs: number;
}

/**
 * Reports ICE gathering producing zero local candidates on a connection that never connected — the
 * client had no network to connect *with*: no interface up, airplane mode, a VPN that tore down
 * every route. Use it to tell "this client cannot do WebRTC here at all" apart from every other ICE
 * issue, which describes a path that existed and then stopped working.
 *
 * Any interface that is up yields a host candidate within milliseconds, so an empty list once
 * gathering is `complete` is an absent network rather than a slow start. `disconnected`/`failed`
 * with zero candidates raises at once; `new`/`connecting` waits out `thresholdInMs` in stats time,
 * which is also what keeps it off an un-negotiated connection. It never fires once a connection has
 * reached `connected`.
 *
 * It cannot separate no network from every candidate type forbidden by policy, and does not try.
 *
 * Issue raised: `no-available-ice-candidate`, resolved when a candidate appears, the
 * connection connects, or the peer connection closes.
 * Monitor event: `no-available-ice-candidate`.
 * Config: `iceReachabilityDetector`.
 *
 * Category: Connectivity
 * Layer: 1 — Reachability
 *
 */
export class IceReachabilityDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'ice-reachability-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	private _previousConnectionState?: string;
	private _stateBeforeFailure?: string;
	/** Stats time spent watching this connection go without a local candidate. */
	private _waitingForInMs = 0;
	private _everConnected = false;
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this._issueKey = `${ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.iceReachabilityDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) {
			this._resolve('peer connection closed');
			return;
		}

		// Advanced before any verdict, so the branches below that break the condition zero it again.
		this._waitingForInMs += this.peerConnection.deltaTime ?? 0;

		const connectionState = this.peerConnection.connectionState;

		if (connectionState !== this._previousConnectionState) {
			if (connectionState === 'disconnected' || connectionState === 'failed') {
				this._stateBeforeFailure = this._previousConnectionState;
			}
			this._previousConnectionState = connectionState;
		}

		if (connectionState === 'connected') {
			this._everConnected = true;
			this._waitingForInMs = 0;
			this._resolve('connection established');
			return;
		}

		const localIceCandidateCount = this.peerConnection.localIceCandidates.length;

		if (0 < localIceCandidateCount) {
			// Candidates aging out later must start their own window, not inherit this one.
			this._waitingForInMs = 0;
			this._resolve('local ice candidate appeared');
			return;
		}

		if (this._everConnected) return;

		// Zero candidates is only evidence once gathering says it is done looking.
		if (this.peerConnection.iceGatheringState !== 'complete') return;

		const failing = connectionState === 'disconnected' || connectionState === 'failed';
		if (!failing && this._waitingForInMs < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		// Wall clock, and only for the resolved issue's `durationInMs`.
		this._raisedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;
		const payload: NoAvailableIceCandidateIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			connectionState,
			previousConnectionState: this._stateBeforeFailure,
			iceGatheringState: this.peerConnection.iceGatheringState,
			localIceCandidateCount,
			sustainedForInMs: this._waitingForInMs,
		};

		clientMonitor.emit('no-available-ice-candidate', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		this.peerConnection.issues.raise({
				key: this._issueKey,
				includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment: string) {
		if (this._raisedAt === undefined) return;

		const issue = this.peerConnection.issues.get(this._issueKey);

		if (issue) {
			this.peerConnection.issues.resolve({
				key: this._issueKey,
				comment,
				payload: {
					...issue.payload,
					durationInMs: Date.now() - this._raisedAt,
				} as NoAvailableIceCandidateIssuePayload,
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}
}
