import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export type NoAvailableIceCandidateIssuePayload = {
	peerConnectionId: string;
	/** The connection state when the issue was raised. */
	connectionState?: string;
	/** The state the connection was in before it fell over. */
	previousConnectionState?: string;
	/** The ICE gathering state at the time the issue was raised. */
	iceGatheringState?: string;
	/** Always 0 when raised — the whole point — kept for the record. */
	localIceCandidateCount: number;
	/** How long the connection had been trying when the issue was raised. */
	sinceMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'no-available-ice-candidate';

/**
 * No Available ICE Candidate Detector
 *
 * Detects the case where a peer connection cannot even *begin* to connect
 * because the client has no usable network: ICE gathering produced **zero
 * local candidates** while the connection state falls over.
 *
 * **The signature.** A healthy establishment gathers at least one host
 * candidate within milliseconds — even without internet, any up interface
 * yields one. When the connection state jumps from `new`/`connecting`
 * straight to `disconnected` or `failed` and not a single local candidate
 * was ever gathered, there was nothing to connect *with*: no interface, no
 * route, airplane mode, a VPN that just tore down every route, or a network
 * so locked down the sockets cannot even bind. This is a different diagnosis
 * from every other ICE issue — `ice-disconnected`, `ice-connection-failed`
 * and friends all describe a path that existed and stopped working; this one
 * says no path was ever possible.
 *
 * **Detection logic, per stats tick:**
 *
 * 1. If any local ICE candidate exists, the diagnosis is off the table:
 *    resolve any active issue and stand down.
 * 2. With zero local candidates and a connection that has never been
 *    `connected`:
 *    - `disconnected` / `failed` raises immediately — the browser already
 *      gave its verdict, and combined with the empty candidate list the
 *      explanation is unambiguous.
 *    - `new` / `connecting` raises only after `thresholdInMs`, covering the
 *      variant where gathering silently never produces anything and the
 *      state machine just sits there.
 * 3. The issue resolves when a local candidate finally appears or the
 *    connection reaches `connected` (e.g. the network came back and an ICE
 *    restart succeeded).
 *
 * **What it reads.** `PeerConnectionMonitor.connectionState` (fed by the
 * RTCPeerConnection / mediasoup-transport bindings),
 * `PeerConnectionMonitor.iceGatheringState` (ditto) and the local ICE
 * candidates from stats. Note that with no network, `getStats()` itself
 * still works — it just returns no `local-candidate` entries.
 *
 * **Known limitations:**
 * - A peer connection created but never negotiated (no
 *   `setLocalDescription`) also has zero candidates; the never-`connected` +
 *   threshold guard keeps the detector from judging it until the state
 *   machine actually moves or enough time passes. Applications that keep
 *   idle, un-negotiated peer connections around for a long time should
 *   disable this detector for those or accept the sustained-variant issue.
 * - The detector cannot distinguish "no network" from "every candidate type
 *   forbidden by policy" (mDNS off + host candidates blocked + no STUN/TURN
 *   reachable). Operationally both mean the same thing: this client cannot
 *   do WebRTC on this network.
 *
 * **Issues created:** `no-available-ice-candidate`.
 * **Events emitted:** `no-available-ice-candidate` (monitor event).
 *
 * @example
 * ```typescript
 * const config = {
 *   noAvailableIceCandidateDetector: {
 *     thresholdInMs: 6000,
 *   }
 * };
 *
 * monitor.on('issue', (issue) => {
 *   if (issue.type === 'no-available-ice-candidate') {
 *     // No point recommending an ICE restart — tell the user to check
 *     // their connection instead.
 *   }
 * });
 * ```
 */
export class NoAvailableIceCandidateDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	/** Unique identifier for this detector type */
	public readonly name = 'no-available-ice-candidate-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	/** When this detector first observed the peer connection. */
	private _firstSeenAt?: number;
	/** The connection state observed on the previous tick. */
	private _previousConnectionState?: string;
	/** The last state seen *before* the connection fell to disconnected/failed. */
	private _stateBeforeFailure?: string;
	/** True once the connection has ever reached `connected`. */
	private _everConnected = false;
	/** Set when the issue has been raised; timestamp of the raise. */
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this._issueKey = `${ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	/** Gets the detector configuration from the client monitor */
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

		// A connection that once worked and lost its network mid-call is the
		// ICE connectivity detectors' story (disconnected/failed/restart); this
		// detector only owns the "never had a network to begin with" case.
		if (this._everConnected) return;

		const failing = connectionState === 'disconnected' || connectionState === 'failed';
		const stuck = !failing && this.config.thresholdInMs <= now - this._firstSeenAt;

		if (!failing && !stuck) return;
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
					...(issue.payload as Record<string, unknown>),
					durationInMs: Date.now() - this._raisedAt,
				},
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}
}
