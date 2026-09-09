import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export type IceConnectionFailedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	/** The transport's own latch: had it ever reached `connected`/`completed` before failing. */
	everConnected: boolean;
	/** ICE restarts observed on this transport so far. */
	iceGeneration: number;
	/** Filled in when the failure is resolved. */
	durationInMs?: number;
};

type TransportState = {
	/** ICE restarts observed on this transport, inferred from the local username fragment. */
	iceGeneration: number;
	usernameFragment?: string;
	raisedAt?: number;
};

const ISSUE_TYPE = 'ice-connection-failed';

/** No tunables — a terminal state needs no threshold. `{}` enables the detector, `null` disables it. */
export type IceConnectionFailedDetectorConfig = Record<string, never>;

/**
 * Reports an ICE transport the browser has given up on. Use `everConnected` in the payload to
 * tell apart the two faults that share the `failed` state and share nothing else: a path that
 * **never worked** (no candidate pair ever won — symmetric NAT with no TURN, a firewall eating
 * the checks, a credential that never arrived) and a path that **worked and was lost** (the
 * interface changed, the NAT binding expired, the route died).
 *
 * `failed` is terminal for the ICE generation, so the issue is raised on the first tick that
 * reports it rather than waited out. A changed ICE local username fragment means a new
 * generation: the standing issue is resolved so the next failure raises again with the
 * generation counter incremented.
 *
 * It does not claim a cause — only the fact, plus the one distinction the stats can support.
 *
 * Issue raised: `ice-connection-failed`, resolved when ICE comes back, when an ICE restart is
 * inferred, or when the transport goes away. Config: `iceConnectionFailedDetector`.
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

		this.peerConnection.issues.raise({
				key: this._issueKey(transport.id),
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

		const key = this._issueKey(transportId);
		const issue = this.peerConnection.issues.get(key);

		if (!issue) return;

		this.peerConnection.issues.resolve({
			key: key,
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
