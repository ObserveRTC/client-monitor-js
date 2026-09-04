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
	/** Stats time accumulated while ICE was healthy and DTLS was not, reset whenever that breaks. */
	stalledForInMs: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'dtls-handshake-stalled';

export type DtlsHandshakeStalledDetectorConfig = {
	/**
	 * How long (in milliseconds) DTLS may stay in `new`/`connecting` on a
	 * transport whose ICE side is already healthy before the stall issue is
	 * raised. Keep it above the layer-5 thresholds so an ICE-level cause is
	 * reported by its own detector first.
	 */
	stalledThresholdInMs: number;
}

/**
 * Reports a handshake that never says anything at all: the ICE side of the
 * transport is demonstrably working while `dtlsState` sits in `new` or
 * `connecting` and stays there. Its sibling `DtlsHandshakeFailedDetector` has
 * the easy half of the problem — the browser announced a verdict. This half has
 * no verdict to read, because a handshake being eaten by a middlebox and one
 * that is merely a few hundred milliseconds from completing look identical in a
 * single stats report. Only duration separates them, which is what
 * `stalledThresholdInMs` is for.
 *
 * The stall is only meaningful once ICE is out of the picture, since DTLS
 * cannot complete over a path that is not yet usable and reporting it would
 * mean re-reporting whatever the ICE detectors already own. ICE health comes
 * from the transport's `iceState` where the browser reports one, and from the
 * selected candidate pair being `succeeded` where it does not (Safari, and the
 * transport reconstructed for Firefox < 153) — the same proxy
 * `BlockedStunRequestsDetector` uses. Which of the two carried the proof is
 * recorded on the issue, because a finding resting on the weaker of them is
 * worth less to whoever reads it.
 *
 * The clock is stats time, not wall time: each qualifying tick adds the
 * transport's own `deltaTime`, so a collection that ran late or was skipped
 * still credits the handshake with exactly the time it actually spent quiet.
 * Anything that ends the condition — ICE health lost, DTLS reaching `connected`
 * or `failed`, a `closed` transport, which is a shutdown rather than a fault —
 * resets that accumulator to zero, and so does a changed ICE local username
 * fragment: an ICE restart re-keys DTLS, and the new generation's handshake
 * deserves the full threshold rather than inheriting the old one's.
 *
 * A transport is never judged on its first observed tick. Firefox 153/154
 * report pre-negotiation transport values that only 155 makes trustworthy, and
 * a detector that believed them would raise on every peer connection at birth.
 *
 * Raises `dtls-handshake-stalled`. Emits `dtls-handshake-stalled`.
 * Config: `dtlsHandshakeStalledDetector`.
 *
 * Category: Connectivity
 * Layer: 4 — Secure transport
 *
 */
export class DtlsHandshakeStalledDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'dtls-handshake-stalled-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.dtlsHandshakeStalledDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		for (const transport of this.peerConnection.iceTransports) {
			this._checkTransport(transport);
		}

		for (const transportId of [ ...this._states.keys() ]) {
			if (this.peerConnection.iceTransports.some((transport) => transport.id === transportId)) continue;

			this._resolve(transportId, 'ice transport is gone');
			this._states.delete(transportId);
		}
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const state = this._getState(transport);
		const ticks = state.ticks;

		state.ticks += 1;

		// An ICE restart re-keys DTLS: the stall clock must restart with the new generation.
		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment !== undefined && state.usernameFragment !== undefined
			&& usernameFragment !== state.usernameFragment) {
			state.stalledForInMs = 0;
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;

		const dtlsState = transport.dtlsState;

		if (dtlsState === 'connected') {
			state.stalledForInMs = 0;

			this._resolve(transport.id, 'dtls handshake completed');

			return;
		}

		if (dtlsState === 'failed') {
			// Terminal, and `DtlsHandshakeFailedDetector` reports it. A stall is a
			// handshake that has not answered yet, which this one no longer is.
			state.stalledForInMs = 0;

			this._resolve(transport.id, 'dtls handshake failed');

			return;
		}

		// 'closed' is a shutdown, not a failure; and without a dtlsState there is nothing to judge.
		if (dtlsState !== 'new' && dtlsState !== 'connecting') {
			state.stalledForInMs = 0;

			return;
		}

		// Firefox 153/154 report pre-negotiation transport values that only 155
		// makes trustworthy — a transport is never judged on its first tick.
		if (ticks < 1) return;

		const iceEvidence = this._iceHealthEvidence(transport);

		if (iceEvidence === undefined) {
			// ICE itself is not proven healthy: the ICE detectors own whatever is wrong.
			state.stalledForInMs = 0;

			return;
		}

		state.stalledForInMs += transport.deltaTime ?? 0;

		if (state.stalledForInMs < this.config.stalledThresholdInMs) return;
		if (state.raisedAt !== undefined) return;

		state.raisedAt = Date.now();

		const payload: DtlsHandshakeStalledIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: transport.id,
			dtlsState,
			iceState: transport.iceState,
			iceEvidence,
			selectedCandidatePairId: transport.selectedCandidatePairId,
			stalledForMs: state.stalledForInMs,
		};

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dtls-handshake-stalled', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<DtlsHandshakeStalledIssuePayload>(
			this._issueKey(transport.id),
			{
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
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

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				ticks: 0,
				usernameFragment: this._usernameFragmentOf(transport),
				stalledForInMs: 0,
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

		clientMonitor.resolveIssue<DtlsHandshakeStalledIssuePayload>(key, {
			comment,
			payload: {
				...(issue.payload as DtlsHandshakeStalledIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
