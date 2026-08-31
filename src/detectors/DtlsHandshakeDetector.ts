import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** How the detector proved the ICE side healthy before judging DTLS. */
export type DtlsIceEvidence =
	/** The transport reported `iceState` `connected`/`completed`. */
	| 'transport-ice-state'
	/**
	 * The transport carries no `iceState` (Safari, and the transport
	 * reconstructed for Firefox < 153): the selected candidate pair being
	 * `succeeded` stood in for it.
	 */
	| 'selected-pair-succeeded';

export type DtlsHandshakeFailedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	iceState?: string;
	selectedCandidatePairId?: string;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

export type DtlsHandshakeStalledIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	iceState?: string;
	iceEvidence: DtlsIceEvidence;
	selectedCandidatePairId?: string;
	/** How long DTLS had already sat in `new`/`connecting` when the issue was raised. */
	stalledForMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

type TransportState = {
	/** Update ticks this transport has been observed for — the first tick is never judged. */
	ticks: number;
	usernameFragment?: string;
	stalledSince?: number;
	stalledRaisedAt?: number;
	failedRaisedAt?: number;
};

const FAILED_ISSUE_TYPE = 'dtls-handshake-failed';
const STALLED_ISSUE_TYPE = 'dtls-handshake-stalled';

/**
 * Separates "the network path failed" from "the secure media transport never
 * negotiated". The ICE detectors own the first; until now nothing owned the
 * second: a certificate fingerprint mismatch, DTLS version intolerance, or a
 * middlebox that passes STUN but eats DTLS all presented as a generically slow
 * `connecting` peer connection.
 *
 * Two findings share the per-transport state. *Failure*: `dtlsState: 'failed'`
 * raises `dtls-handshake-failed` immediately — the handshake is terminal for
 * this transport until an ICE restart re-keys it. *Stall*: ICE proven healthy
 * while `dtlsState` sits in `new`/`connecting` past `stalledThresholdInMs`
 * raises `dtls-handshake-stalled`. ICE health comes from the transport's
 * `iceState` where the browser reports one, and from the selected candidate
 * pair being `succeeded` where it does not (Safari, Firefox < 153) — the same
 * proxy `BlockedTransportDetector` uses.
 *
 * What it will not judge: a transport on its first observed tick (Firefox
 * 153/154 report pre-negotiation transport values that only 155 makes
 * trustworthy); `dtlsState: 'closed'`, which is a shutdown, not a failure; and
 * a transport whose ICE side is not proven healthy, where a DTLS stall cannot
 * be told from ICE still working. A changed ICE local username fragment (an
 * ICE restart) clears the stall timer, since the new generation re-runs the
 * handshake.
 *
 * Issues raised: `dtls-handshake-failed`, `dtls-handshake-stalled`. Monitor
 * events of the same names. Config: `dtlsHandshakeDetector`.
 */
export class DtlsHandshakeDetector implements Detector {
	public static readonly FAILED_ISSUE_TYPE = FAILED_ISSUE_TYPE;
	public static readonly STALLED_ISSUE_TYPE = STALLED_ISSUE_TYPE;

	public readonly name = 'dtls-handshake-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.dtlsHandshakeDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const seenIds = new Set<string>();

		for (const transport of this.peerConnection.iceTransports) {
			seenIds.add(transport.id);
			this._checkTransport(transport);
		}

		for (const id of [ ...this._states.keys() ]) {
			if (seenIds.has(id)) continue;

			this._resolveAll(id, 'ice transport is gone');
			this._states.delete(id);
		}
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const state = this._getState(transport);
		const ticks = state.ticks;

		state.ticks += 1;

		// An ICE restart re-keys DTLS: the stall timer must restart with the new generation.
		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment !== undefined && state.usernameFragment !== undefined
			&& usernameFragment !== state.usernameFragment) {
			state.stalledSince = undefined;
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;

		const dtlsState = transport.dtlsState;

		if (dtlsState === 'failed') {
			state.stalledSince = undefined;

			this._resolveStalled(transport.id, state, 'dtls handshake failed');

			if (state.failedRaisedAt !== undefined) return;

			state.failedRaisedAt = Date.now();

			const payload: DtlsHandshakeFailedIssuePayload = {
				peerConnectionId: this.peerConnection.peerConnectionId,
				transportId: transport.id,
				dtlsState,
				iceState: transport.iceState,
				selectedCandidatePairId: transport.selectedCandidatePairId,
			};

			const clientMonitor = this.peerConnection.parent;

			clientMonitor.emit('dtls-handshake-failed', {
				clientMonitor,
				peerConnectionMonitor: this.peerConnection,
				...payload,
			});

			clientMonitor.raiseIssue<DtlsHandshakeFailedIssuePayload>(
				this._issueKey(FAILED_ISSUE_TYPE, transport.id),
				{
					includeInSample: this.includeIssueInSample,
					type: FAILED_ISSUE_TYPE,
					payload,
				}
			);

			return;
		}

		if (dtlsState === 'connected') {
			state.stalledSince = undefined;

			this._resolveStalled(transport.id, state, 'dtls handshake completed');
			this._resolveFailed(transport.id, state, 'dtls handshake completed');

			return;
		}

		// 'closed' is a shutdown, not a failure; and without a dtlsState there is nothing to judge.
		if (dtlsState !== 'new' && dtlsState !== 'connecting') {
			state.stalledSince = undefined;

			return;
		}

		// Firefox 153/154 report pre-negotiation transport values that only 155
		// makes trustworthy — a transport is never judged on its first tick.
		if (ticks < 1) return;

		const iceEvidence = this._iceHealthEvidence(transport);

		if (iceEvidence === undefined) {
			// ICE itself is not proven healthy: the ICE detectors own whatever is wrong.
			state.stalledSince = undefined;

			return;
		}

		if (state.stalledSince === undefined) {
			state.stalledSince = Date.now();
		}

		const stalledForMs = Date.now() - state.stalledSince;

		if (stalledForMs < this.config.stalledThresholdInMs) return;
		if (state.stalledRaisedAt !== undefined) return;

		state.stalledRaisedAt = Date.now();

		const payload: DtlsHandshakeStalledIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: transport.id,
			dtlsState,
			iceState: transport.iceState,
			iceEvidence,
			selectedCandidatePairId: transport.selectedCandidatePairId,
			stalledForMs,
		};

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dtls-handshake-stalled', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<DtlsHandshakeStalledIssuePayload>(
			this._issueKey(STALLED_ISSUE_TYPE, transport.id),
			{
				includeInSample: this.includeIssueInSample,
				type: STALLED_ISSUE_TYPE,
				payload,
			}
		);
	}

	/**
	 * Proof that the ICE side of the transport is healthy, so a quiet DTLS
	 * handshake is DTLS's own fault. `undefined` means no proof — not proof of
	 * the opposite.
	 */
	private _iceHealthEvidence(transport: IceTransportMonitor): DtlsIceEvidence | undefined {
		const iceState = transport.iceState;

		if (iceState === 'connected' || iceState === 'completed') return 'transport-ice-state';
		if (iceState !== undefined) return undefined;

		return transport.getSelectedCandidatePair()?.state === 'succeeded'
			? 'selected-pair-succeeded'
			: undefined;
	}

	private _usernameFragmentOf(transport: IceTransportMonitor): string | undefined {
		return transport.iceLocalUsernameFragment
			?? transport.getSelectedCandidatePair()?.getLocalCandidate()?.usernameFragment;
	}

	private _resolveStalled(transportId: string, state: TransportState, comment: string) {
		if (state.stalledRaisedAt === undefined) return;

		this._resolveIssue(STALLED_ISSUE_TYPE, transportId, state.stalledRaisedAt, comment);
		state.stalledRaisedAt = undefined;
	}

	private _resolveFailed(transportId: string, state: TransportState, comment: string) {
		if (state.failedRaisedAt === undefined) return;

		this._resolveIssue(FAILED_ISSUE_TYPE, transportId, state.failedRaisedAt, comment);
		state.failedRaisedAt = undefined;
	}

	private _resolveAll(transportId: string, comment: string) {
		const state = this._states.get(transportId);

		if (!state) return;

		this._resolveStalled(transportId, state, comment);
		this._resolveFailed(transportId, state, comment);
	}

	private _resolveIssue(type: string, transportId: string, raisedAt: number | undefined, comment: string) {
		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(type, transportId);
		const issue = clientMonitor.activeIssues.get(key);

		if (!issue) return;

		clientMonitor.resolveIssue(key, {
			comment,
			payload: {
				...issue.payload,
				durationInMs: raisedAt !== undefined ? Date.now() - raisedAt : undefined,
			},
			resolvedAt: Date.now(),
		});
	}

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				ticks: 0,
				usernameFragment: this._usernameFragmentOf(transport),
			};
			this._states.set(transport.id, state);
		}

		return state;
	}

	private _issueKey(type: string, transportId: string) {
		return `${type}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
