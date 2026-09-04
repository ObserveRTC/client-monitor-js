import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

export type IceRestartOutcome = 'detected' | 'recovered' | 'failed';

/**
 * `outcome` is the restart's fate: `detected` when a new generation was observed, then `recovered`
 * or `failed` once that generation resolved. `evidence` names how the generation was inferred, which
 * matters because the inference is stats-based rather than reported by the browser.
 */
export type IceRestartClientEventPayload = {
	peerConnectionId: string;
	transportId: string;
	iceGeneration: number;
	outcome: IceRestartOutcome;
	iceState?: string;
	evidence: 'ice-username-fragment-changed';
	timestamp: number;
};

type TransportState = {
	usernameFragment?: string;
	iceGeneration: number;
	/** A restart has been reported and the generation it started has not resolved yet. */
	restartPending: boolean;
};

export type IceRestartDetectorConfig = {
	/**
	 * Flag to indicate if the detector should create `ICE_RESTART` client
	 * events (buffered into the sample) in addition to emitting the
	 * `ice-restart` monitor event.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;
}

/**
 * Reports that an ICE transport started a new ICE generation, and how that generation turned out.
 * It raises no issue and never will: a restart is a fact about the connection, not a fault. Restarts
 * are exactly what a healthy application does when a network changes underneath a call, so an issue
 * would flag the recovery rather than the problem — and the fault that prompted it, if there was
 * one, already has a detector of its own.
 *
 * The evidence is a changed ICE local username fragment, which is renegotiated per generation and is
 * therefore the one field a restart cannot leave alone. That is an inference, not a report: the
 * browser exposes no "a restart happened" signal, and stats alone cannot separate a restart the
 * application asked for from one the browser started by itself. The inference is also not universally
 * available — Firefox's transport report is reconstructed by `FirefoxStatsAdapter` and carries no
 * fragment, so the detector falls back to the selected local candidate's `usernameFragment` and stays
 * silent when neither exists. An application that wants certainty should instrument its own
 * `restartIce()` calls; this is the best the stats can do without it.
 *
 * Three outcomes are emitted rather than one, because "a restart was attempted" and "the restart
 * worked" are different facts and only the pair of them is worth reading. `detected` goes out when
 * the fragment changes; the generation is then followed until the transport reaches `connected` or
 * `completed` (`recovered`) or `failed` (`failed`). A generation that is still checking has no
 * outcome yet, and none is invented for it.
 *
 * What it deliberately does not claim: that a restart was *needed*, or that one is now warranted —
 * `IceRestartRecommendationDetector` is the other half of that conversation, and the two share
 * nothing but the subject.
 *
 * Raises no issue. Monitor event: `ice-restart`. Client event: `ICE_RESTART`, when `createEvent`.
 * Config: `iceRestartDetector`.
 *
 * Category: Telemetry
 * Layer: Transport
 *
 */
export class IceRestartDetector implements Detector {
	public readonly name = 'ice-restart-detector';
	public disabled = false;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.iceRestartDetector!;
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

			this._states.delete(transportId);
		}
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const state = this._getState(transport);
		const iceState = transport.iceState;

		// Order is load-bearing. This tick's ICE state still describes the generation
		// the tick started in, so a pending outcome is settled before a fragment
		// change starts the next generation — otherwise a restart observed while the
		// transport still read `connected` would report itself recovered on the spot,
		// crediting the new generation with the old one's state.
		if (state.restartPending) {
			// A generation still in `new` / `checking` / `disconnected` has not
			// resolved yet, and no outcome is invented for it.
			if (iceState === 'connected' || iceState === 'completed') {
				state.restartPending = false;

				this._notify(transport, state, 'recovered');
			} else if (iceState === 'failed') {
				state.restartPending = false;

				this._notify(transport, state, 'failed');
			}
		}

		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment !== undefined && state.usernameFragment !== undefined
			&& usernameFragment !== state.usernameFragment) {
			state.iceGeneration += 1;
			state.restartPending = true;

			this._notify(transport, state, 'detected');
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;
	}

	private _notify(transport: IceTransportMonitor, state: TransportState, outcome: IceRestartOutcome) {
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('ice-restart', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			transportId: transport.id,
			iceGeneration: state.iceGeneration,
			outcome,
		});

		if (!this.config.createEvent) return;

		clientMonitor.addEvent<IceRestartClientEventPayload>({
			type: ClientEventTypes.ICE_RESTART,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				transportId: transport.id,
				iceGeneration: state.iceGeneration,
				outcome,
				iceState: transport.iceState,
				evidence: 'ice-username-fragment-changed',
				timestamp: Date.now(),
			},
		});
	}

	private _usernameFragmentOf(transport: IceTransportMonitor): string | undefined {
		return transport.iceLocalUsernameFragment
			?? transport.getSelectedCandidatePair()?.getLocalCandidate()?.usernameFragment;
	}

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				usernameFragment: this._usernameFragmentOf(transport),
				iceGeneration: 0,
				restartPending: false,
			};
			this._states.set(transport.id, state);
		}

		return state;
	}
}
