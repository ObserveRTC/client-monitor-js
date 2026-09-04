import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * `everConnected` is the transport's own latch, not a guess: `true` means this transport reached
 * `connected` or `completed` at some point before it failed. `iceGeneration` counts the ICE restarts
 * observed on this transport so far, and `durationInMs` is filled in when the failure is resolved by
 * a recovery or a restart.
 */
export type IceConnectionFailedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	/** Whether this transport had ever reached `connected`/`completed` before it failed. */
	everConnected: boolean;
	iceGeneration: number;
	durationInMs?: number;
};

type TransportState = {
	/** ICE restarts observed on this transport, inferred from the local username fragment. */
	iceGeneration: number;
	usernameFragment?: string;
	raisedAt?: number;
};

const ISSUE_TYPE = 'ice-connection-failed';

/**
 * `IceConnectionFailedDetector` has no tunables — a terminal state needs no threshold, so there is
 * nothing to move. The type exists so the detector can be disabled on its own: `{}` enables it,
 * `null` disables it.
 */
export type IceConnectionFailedDetectorConfig = Record<string, never>;

/**
 * Reports an ICE transport the browser has given up on. Unlike `disconnected`, `failed` is terminal
 * for the ICE generation — the browser will not retry candidates on its own — so there is nothing to
 * wait out and the issue is raised on the first tick that reports it. Waiting would only delay the
 * report of something that has already finished happening.
 *
 * The payload carries `everConnected`, read from the transport's own latch, because `failed` on its
 * own conflates two faults that share a state and share nothing else. `everConnected: false` is a
 * path that **never worked**: no candidate pair ever won, which points at what was tried and what
 * was reachable — symmetric NAT with no TURN, a firewall eating the checks, a TURN credential the
 * client never got. `everConnected: true` is a path that **worked and was lost**: connectivity that
 * existed and then stopped, which points at the network underneath — the interface changed, the NAT
 * binding expired, the route died. The evidence to gather and the fix are different in each case,
 * and a reader with only `failed` cannot tell which one they are looking at.
 *
 * A changed ICE local username fragment means a new ICE generation, whose failure is a fresh
 * finding: the standing issue is resolved so the next `failed` under the new generation raises again
 * with the generation counter incremented. The fragment is read here rather than asked of
 * `IceRestartDetector`, so neither detector depends on the other or on the order they run in.
 *
 * What it deliberately does not claim: a cause. `failed` says candidate checking ended without a
 * usable pair; it does not say whether that was the network, the TURN configuration or the far end,
 * and this detector reports the fact plus the one distinction — `everConnected` — that the stats can
 * actually support.
 *
 * Issue raised: `ice-connection-failed`, resolved when ICE comes back, when an ICE restart is
 * inferred, or when the transport goes away. Config: `iceConnectionFailedDetector` — `{}` registers
 * the detector, `null` leaves it unregistered. The block holds no values, since a terminal state has
 * no threshold to wait out.
 *
 * Category: Connectivity
 * Layer: 5 — Path continuity
 *
 */
export class IceConnectionFailedDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'ice-connection-failed-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const seenIds = new Set<string>();

		for (const transport of this.peerConnection.iceTransports) {
			seenIds.add(transport.id);

			this._checkTransport(transport);
		}

		for (const transportId of [ ...this._states.keys() ]) {
			if (seenIds.has(transportId)) continue;

			this._resolve(transportId, 'ice transport is gone');
			this._states.delete(transportId);
		}
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const state = this._getState(transport);
		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment !== undefined && state.usernameFragment !== undefined
			&& usernameFragment !== state.usernameFragment) {
			state.iceGeneration += 1;

			this._resolve(transport.id, 'ice restarted');
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;

		const iceState = transport.iceState;

		if (iceState === 'connected' || iceState === 'completed') {
			this._resolve(transport.id, 'ice connection recovered');

			return;
		}

		if (iceState !== 'failed') return;
		if (state.raisedAt !== undefined) return;

		state.raisedAt = Date.now();

		this.peerConnection.parent.raiseIssue<IceConnectionFailedIssuePayload>(
			this._issueKey(transport.id),
			{
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					transportId: transport.id,
					dtlsState: transport.dtlsState,
					selectedCandidatePairId: transport.selectedCandidatePairId,
					everConnected: transport.everConnected === true,
					iceGeneration: state.iceGeneration,
				},
			}
		);
	}

	private _usernameFragmentOf(transport: IceTransportMonitor): string | undefined {
		return transport.iceLocalUsernameFragment
			?? transport.getSelectedCandidatePair()?.getLocalCandidate()?.usernameFragment;
	}

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				iceGeneration: 0,
				usernameFragment: this._usernameFragmentOf(transport),
			};
			this._states.set(transport.id, state);
		}

		return state;
	}

	private _resolve(transportId: string, comment: string) {
		const state = this._states.get(transportId);

		if (state?.raisedAt === undefined) return;

		const raisedAt = state.raisedAt;

		state.raisedAt = undefined;

		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(transportId);
		const issue = clientMonitor.activeIssues.get(key);

		if (!issue) return;

		clientMonitor.resolveIssue<IceConnectionFailedIssuePayload>(key, {
			comment,
			payload: {
				...(issue.payload as IceConnectionFailedIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
