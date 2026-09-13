import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

/** Why a restart is warranted: a condition the browser will not recover from within the window. */
export type IceRestartRecommendationReason =
	/** ICE gave up on this generation; only a restart can revive it. */
	| 'ice-failed'
	/** `disconnected` outlasted the window in which ICE usually self-heals. */
	| 'ice-disconnected'
	/** ICE still reports connected, but the selected path stopped delivering. */
	| 'transport-stalled'
	/** The peer connection never finished establishing in the first place. */
	| 'never-established';

/**
 * `transportId` is absent for `never-established`, which is per peer connection. A rising
 * `recommendationCount` against a flat `iceGeneration` means the recommendations are not being acted on.
 */
export type IceRestartRecommendedEventPayload = {
	peerConnectionId: string;
	transportId?: string;
	reason: IceRestartRecommendationReason;
	conditionDurationInMs: number;
	iceGeneration: number;
	recommendationCount: number;
	iceState?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
};

type TransportState = {
	usernameFragment?: string;
	iceGeneration: number;
	/** A restart has already been started on this transport and has not resolved yet. */
	restartPending: boolean;
	/** Whether inbound bytes were ever seen on this transport's selected pair. */
	sawInboundTraffic: boolean;
	failedForInMs: number;
	disconnectedForInMs: number;
	stalledForInMs: number;
	recommendedAt?: number;
	recommendations: number;
};

export type IceRestartRecommendationDetectorConfig = {
	/** Also add the `ICE_RESTART_RECOMMENDED` client event. DEFAULT: true */
	createEvent?: boolean;

	/** How long a `disconnected` or stalled transport must persist, in ms. `failed` recommends on sight. */
	iceRestartRecommendationThresholdInMs: number;

	/** Minimum time between repeated recommendations for the same transport, in ms. */
	iceRestartRecommendationCooldownInMs: number;

	/** How long the peer connection must have been establishing before `never-established`, in ms. */
	restartRecommendationThresholdInMs: number;

	/** Minimum time between repeated `never-established` recommendations, in ms. */
	restartRecommendationCooldownInMs: number;
}

/**
 * The one place that says "restart ICE". Use it to answer "is this connection worth restarting right
 * now" — it recommends and never performs, since only the application knows whether renegotiation is
 * safe. Listen for `'ice-restart-recommended'` and call `pc.restartIce()`.
 *
 * Four conditions warrant one, kept in one class so the rate limiting is shared. Three are per
 * transport — `failed` on sight, `disconnected` and a connected-but-not-receiving path once they
 * outlast `iceRestartRecommendationThresholdInMs` — and `never-established` is per peer connection,
 * where nothing ever got far enough to have a failing transport. Each verdict is read from raw
 * transport and connection state, so this runs in any order and no other detector can silence it.
 * Condition clocks are stats time; the cooldowns are wall clock, since they throttle notifications.
 * A restart already in flight, inferred from a changed username fragment, suppresses the rest.
 *
 * It does not claim a restart will help, only that it is the standard remedy for the condition.
 *
 * Raises no issue. Monitor event: `ice-restart-recommended`.
 * Client event: `ICE_RESTART_RECOMMENDED`, when `createEvent`.
 * Config: `iceRestartRecommendationDetector`.
 *
 * Category: Telemetry
 * Layer: Transport
 *
 */
export class IceRestartRecommendationDetector implements Detector {
	public readonly name = 'ice-restart-recommendation-detector';
	public disabled = false;

	private readonly _states = new Map<string, TransportState>();

	/** `never-established` is per peer connection, so its rate limiting cannot live in the map. */
	private _neverEstablishedRecommendedAt?: number;
	private _neverEstablishedRecommendations = 0;
	/** Stats time spent in `connecting`, from the connection's own `deltaTime`. */
	private _connectingForInMs = 0;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.iceRestartRecommendationDetector!;
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

		this._checkEstablishment();
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const config = this.config;
		const state = this._getState(transport);
		const iceState = transport.iceState;
		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment !== undefined && state.usernameFragment !== undefined
			&& usernameFragment !== state.usernameFragment) {
			state.iceGeneration += 1;
			state.restartPending = true;
			state.failedForInMs = 0;
			state.disconnectedForInMs = 0;
			state.stalledForInMs = 0;
			state.sawInboundTraffic = false;
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;

		// A pending restart has resolved once the new generation reaches a terminal verdict.
		if (state.restartPending
			&& (iceState === 'connected' || iceState === 'completed' || iceState === 'failed')) {
			state.restartPending = false;
		}

		this._accumulate(transport, state);

		if (state.restartPending) return;

		let reason: IceRestartRecommendationReason | undefined;
		let conditionDurationInMs = 0;

		if (iceState === 'failed') {
			reason = 'ice-failed';
			conditionDurationInMs = state.failedForInMs;
		} else if (config.iceRestartRecommendationThresholdInMs <= state.disconnectedForInMs) {
			reason = 'ice-disconnected';
			conditionDurationInMs = state.disconnectedForInMs;
		} else if (config.iceRestartRecommendationThresholdInMs <= state.stalledForInMs) {
			reason = 'transport-stalled';
			conditionDurationInMs = state.stalledForInMs;
		}

		if (reason === undefined) {
			// Rearmed, so the next incident is not made to serve out a cleared condition's cooldown.
			state.recommendedAt = undefined;

			return;
		}

		const now = Date.now();

		// Wall clock, unlike the condition clocks: this throttles notifications, not measurement.
		if (state.recommendedAt !== undefined
			&& now - state.recommendedAt < config.iceRestartRecommendationCooldownInMs) {
			return;
		}

		state.recommendedAt = now;
		state.recommendations += 1;

		this._recommend({
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: transport.id,
			reason,
			conditionDurationInMs,
			iceGeneration: state.iceGeneration,
			recommendationCount: state.recommendations,
			iceState,
			dtlsState: transport.dtlsState,
			selectedCandidatePairId: transport.selectedCandidatePairId,
		});
	}

	/**
	 * Advances the three per-transport condition clocks, each zeroed the moment its condition stops
	 * holding. The last stall guard is not optional: a send-only transport legitimately receives nothing.
	 */
	private _accumulate(transport: IceTransportMonitor, state: TransportState) {
		const iceState = transport.iceState;
		const deltaTime = transport.deltaTime ?? 0;

		state.failedForInMs = iceState === 'failed' ? state.failedForInMs + deltaTime : 0;
		state.disconnectedForInMs = iceState === 'disconnected' ? state.disconnectedForInMs + deltaTime : 0;

		const pair = transport.getSelectedCandidatePair();

		if ((iceState !== 'connected' && iceState !== 'completed') || !pair || pair.state !== 'succeeded') {
			state.stalledForInMs = 0;

			return;
		}

		const inboundBytesDelta = pair.deltaBytesReceived;
		const outboundBytesDelta = pair.deltaBytesSent;

		if (inboundBytesDelta === undefined || outboundBytesDelta === undefined) return;

		if (0 < inboundBytesDelta) {
			state.sawInboundTraffic = true;
			state.stalledForInMs = 0;

			return;
		}

		if (!state.sawInboundTraffic || outboundBytesDelta <= 0 || !this._expectsInboundMedia(transport)) {
			state.stalledForInMs = 0;

			return;
		}

		state.stalledForInMs += deltaTime;
	}

	/**
	 * Recommends for a peer connection that never finished establishing. Yields to `ice-failed` and
	 * `ice-disconnected`, which name what went wrong rather than only what did not happen.
	 */
	private _checkEstablishment() {
		const config = this.config;

		if (this.peerConnection.connectionState !== 'connecting') {
			this._neverEstablishedRecommendedAt = undefined;
			// The condition has broken, so the next attempt is timed from its own start.
			this._connectingForInMs = 0;

			return;
		}

		this._connectingForInMs += this.peerConnection.deltaTime ?? 0;

		for (const transport of this.peerConnection.iceTransports ?? []) {
			if (transport.iceState === 'failed' || transport.iceState === 'disconnected') return;
		}

		const conditionDurationInMs = this._connectingForInMs;

		if (conditionDurationInMs < config.restartRecommendationThresholdInMs) return;

		const now = Date.now();

		// Wall clock, unlike the condition clock above: this throttles notifications.
		if (this._neverEstablishedRecommendedAt !== undefined
			&& now - this._neverEstablishedRecommendedAt < config.restartRecommendationCooldownInMs) {
			return;
		}

		this._neverEstablishedRecommendedAt = now;
		this._neverEstablishedRecommendations += 1;

		const [ subject ] = this._bySeverity();

		this._recommend({
			peerConnectionId: this.peerConnection.peerConnectionId,
			reason: 'never-established',
			conditionDurationInMs,
			iceGeneration: 0,
			recommendationCount: this._neverEstablishedRecommendations,
			iceState: subject?.iceState,
			dtlsState: subject?.dtlsState,
		});
	}

	/** Picks the transport that best explains a stalled establishment, not whichever was listed first. */
	private static readonly ICE_STATE_SEVERITY: Record<string, number> = {
		failed: 6, disconnected: 5, checking: 4, new: 3, connected: 2, completed: 1, closed: 0,
	};

	private _bySeverity(): IceTransportMonitor[] {
		// nullish-guarded so a partially mocked monitor (tests, custom sources) stays judgeable
		return [ ...(this.peerConnection.iceTransports ?? []) ].sort(
			(a, b) => (IceRestartRecommendationDetector.ICE_STATE_SEVERITY[b.iceState ?? ''] ?? -1)
				- (IceRestartRecommendationDetector.ICE_STATE_SEVERITY[a.iceState ?? ''] ?? -1)
		);
	}

	private _expectsInboundMedia(transport: IceTransportMonitor): boolean {
		return 0 < transport.getInboundRtps().length;
	}

	private _recommend(payload: IceRestartRecommendedEventPayload) {
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('ice-restart-recommended', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		if (!this.config.createEvent) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.ICE_RESTART_RECOMMENDED,
			payload: { ...payload },
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
				sawInboundTraffic: false,
				failedForInMs: 0,
				disconnectedForInMs: 0,
				stalledForInMs: 0,
				recommendations: 0,
			};
			this._states.set(transport.id, state);
		}

		return state;
	}
}
