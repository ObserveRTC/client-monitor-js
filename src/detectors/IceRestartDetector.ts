import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

export type IceRestartOutcome = 'detected' | 'recovered' | 'failed';

export type IceRestartClientEventPayload = {
	peerConnectionId: string;
	transportId: string;
	iceGeneration: number;
	/** `detected` when a new generation was observed, then `recovered` or `failed` once it resolved. */
	outcome: IceRestartOutcome;
	iceState?: string;
	/** How the generation was inferred — this is stats-based, not reported by the browser. */
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
	/** Also buffer `ICE_RESTART` client events into the sample. Default true. */
	createEvent?: boolean;
}

/**
 * Reports that an ICE transport started a new ICE generation, and how that generation turned out.
 * Use it to see whether a call's recoveries are working — a restart followed by `recovered` is the
 * network healing, a run of `failed` is a connection that cannot re-establish itself. It raises no
 * issue: a restart is a fact about the connection, not a fault.
 *
 * The evidence is a changed ICE local username fragment, the one field a restart cannot leave alone,
 * falling back to the selected local candidate's fragment and staying silent when neither exists.
 * `detected` goes out on the change; the generation is then followed to `connected`/`completed`
 * (`recovered`) or `failed`, and one still checking gets no outcome invented for it.
 *
 * It does not claim a restart was needed or is warranted — that is
 * `IceRestartRecommendationDetector`.
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

		// Order is load-bearing: this tick's ICE state describes the generation the tick started in,
		// so a pending outcome must settle before a fragment change starts the next generation.
		if (state.restartPending) {
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
