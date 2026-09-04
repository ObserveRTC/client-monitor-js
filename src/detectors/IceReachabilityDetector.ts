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
	/**
	 * How long the connection had been trying without a candidate when the issue was raised,
	 * accumulated from the peer connection's own `deltaTime` rather than measured against the wall
	 * clock — so it says how much *observed* time the condition survived.
	 */
	sustainedForInMs: number;
	/** How long the issue stayed active; filled in on resolution. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'no-available-ice-candidate';

export type IceReachabilityDetectorConfig = {
	/**
	 * How long (in milliseconds) a never-connected peer connection may
	 * sit with zero local candidates in `new`/`connecting` before the
	 * issue is raised. `disconnected`/`failed` with zero candidates
	 * raises immediately.
	 */
	thresholdInMs: number;
}

/**
 * Watches a peer connection that has never connected and reports the case where ICE
 * gathering produced zero local candidates — the client had no usable network to
 * connect *with*: no interface up, airplane mode, a VPN that just tore down every
 * route, or a network locked down so tightly the sockets cannot bind.
 *
 * Every other ICE issue — `ice-disconnected`, `ice-connection-failed` and the rest —
 * describes a path that existed and stopped working; this one says no path was ever
 * possible. A healthy establishment gathers at least one host candidate within
 * milliseconds, since any interface that is up yields one even with no internet, so
 * an empty candidate list is not a slow start but an absent network. `getStats()`
 * keeps working throughout; it simply returns no `local-candidate` entries.
 *
 * Falling to `disconnected`/`failed` with zero candidates raises immediately — the
 * browser has given its verdict and the empty list explains it. Sitting in
 * `new`/`connecting` raises only after `thresholdInMs`, covering the variant where
 * gathering silently never produces anything and the state machine never moves.
 *
 * It never fires on a connection that once reached `connected`: once a path existed,
 * a later candidate-free stretch belongs to some other ICE failure. It stands down
 * as soon as any local candidate appears, and the threshold is what keeps it off an
 * un-negotiated peer connection, which has zero candidates too. It cannot separate
 * "no network" from "every candidate type forbidden by policy", and does not try —
 * operationally both mean this client cannot do WebRTC here.
 *
 * The threshold is spent in stats time: `_waitingForInMs` accumulates the peer connection's
 * own `deltaTime` — the gap between the two reports actually read — instead of wall-clock
 * elapsed. A tab that was backgrounded for a minute has not watched a minute of failing
 * gathering; it has watched whatever the collector managed to sample, and only that may count
 * towards a verdict as absolute as "this client has no network".
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
	/**
	 * Stats time spent watching this connection go without a local candidate, accumulated from
	 * the peer connection's `deltaTime`. Not a wall-clock stamp: the question the threshold
	 * answers is how long the *observed* connection has had nothing to connect with, and a
	 * collection that never ran observed nothing.
	 */
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

		// Advanced before any verdict is reached, so the interval this collection
		// covers counts once and only once — the branches below that prove the
		// condition broken zero it again rather than skipping it.
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
			// The condition is broken, not merely quiet: candidates that later age out
			// of the stats must start their own window rather than inherit this one.
			this._waitingForInMs = 0;
			this._resolve('local ice candidate appeared');
			return;
		}

		if (this._everConnected) return;

		// Zero candidate rows is only evidence once gathering says it is done
		// looking. Before that it means gathering is still running, and where
		// the field is absent — a stats source that reports no candidates at
		// all, or rows dropped in validation — it means nothing was measured.
		// Neither is "gathering produced nothing".
		if (this.peerConnection.iceGatheringState !== 'complete') return;

		const failing = connectionState === 'disconnected' || connectionState === 'failed';
		if (!failing && this._waitingForInMs < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		// wall clock, deliberately: read only to report how long the issue itself stood
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

		clientMonitor.raiseIssue<NoAvailableIceCandidateIssuePayload>(this._issueKey, {
				includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment: string) {
		if (this._raisedAt === undefined) return;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		if (issue) {
			clientMonitor.resolveIssue(this._issueKey, {
				comment,
				payload: {
					...issue.payload,
					durationInMs: Date.now() - this._raisedAt,
				},
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}
}
