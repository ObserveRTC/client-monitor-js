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
	/** How long the connection had been trying when the issue was raised. */
	sinceMs: number;
	/** How long the issue stayed active; filled in on resolution. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'no-available-ice-candidate';

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
 * Issue raised: `no-available-ice-candidate`, resolved when a candidate appears, the
 * connection connects, or the peer connection closes.
 * Monitor event: `no-available-ice-candidate`.
 * Config: `noAvailableIceCandidateDetector`.
 */
export class NoAvailableIceCandidateDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'no-available-ice-candidate-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	private _previousConnectionState?: string;
	private _stateBeforeFailure?: string;
	private _firstSeenAt?: number;
	private _everConnected = false;
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this._issueKey = `${ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.noAvailableIceCandidateDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) {
			this._resolve('peer connection closed');
			return;
		}

		const now = Date.now();

		if (this._firstSeenAt === undefined) {
			this._firstSeenAt = now;
		}

		const connectionState = this.peerConnection.connectionState;

		if (connectionState !== this._previousConnectionState) {
			if (connectionState === 'disconnected' || connectionState === 'failed') {
				this._stateBeforeFailure = this._previousConnectionState;
			}
			this._previousConnectionState = connectionState;
		}

		if (connectionState === 'connected') {
			this._everConnected = true;
			this._resolve('connection established');
			return;
		}

		const localIceCandidateCount = this.peerConnection.localIceCandidates.length;

		if (0 < localIceCandidateCount) {
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
		if (!failing && now - this._firstSeenAt < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		this._raisedAt = now;

		const clientMonitor = this.peerConnection.parent;
		const payload: NoAvailableIceCandidateIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			connectionState,
			previousConnectionState: this._stateBeforeFailure,
			iceGatheringState: this.peerConnection.iceGatheringState,
			localIceCandidateCount,
			sinceMs: now - this._firstSeenAt,
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
