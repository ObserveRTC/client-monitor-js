import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** How the detector proved the ICE side healthy before judging DTLS. */
export type DtlsIceEvidence =
	/** The transport reported `iceState` `connected`/`completed`. */
	| 'transport-ice-state'
	/** No `iceState` reported (Safari), so a `succeeded` selected pair stood in for it. */
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
	/** How long DTLS may stay in `new`/`connecting` over a healthy ICE side before raising, in ms. */
	stalledThresholdInMs: number;
}

/**
 * Reports a DTLS handshake that never answers: the ICE side of the transport is demonstrably
 * working while `dtlsState` sits in `new` or `connecting` and stays there. Use it to tell a
 * handshake eaten by a middlebox from one the browser has actually failed — its sibling
 * `DtlsHandshakeFailedDetector` reports that verdict; only duration separates the two here.
 *
 * ICE must be proven healthy first, since DTLS cannot complete over an unusable path and the ICE
 * detectors already own that case. Proof comes from the transport's `iceState`, or from a
 * `succeeded` selected pair where no `iceState` is reported, and `iceEvidence` records which. The
 * clock is stats time, and it resets whenever the condition ends or an ICE restart re-keys DTLS,
 * which is what a changed local username fragment marks. The first observed tick is never judged,
 * because some browsers report pre-negotiation transport values.
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
			// Terminal, and `DtlsHandshakeFailedDetector`'s to report.
			state.stalledForInMs = 0;

			this._resolve(transport.id, 'dtls handshake failed');

			return;
		}

		// 'closed' is a shutdown, not a failure; and without a dtlsState there is nothing to judge.
		if (dtlsState !== 'new' && dtlsState !== 'connecting') {
			state.stalledForInMs = 0;

			return;
		}

		// Never judge a first tick: some browsers report pre-negotiation transport values.
		if (ticks < 1) return;

		const iceEvidence = this._iceHealthEvidence(transport);

		if (iceEvidence === undefined) {
			// ICE is not proven healthy, so the ICE detectors own whatever is wrong.
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

		this.peerConnection.issues.raise({
				key: this._issueKey(transport.id),
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload,
			}
		);
	}

	/** Proof the ICE side is healthy. `undefined` means no proof, not proof of the opposite. */
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

		const key = this._issueKey(transportId);
		const issue = this.peerConnection.issues.get(key);

		if (!issue) return;

		this.peerConnection.issues.resolve({
			key: key,
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
