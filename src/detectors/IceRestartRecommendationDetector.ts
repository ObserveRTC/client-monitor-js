import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

/**
 * Why an ICE restart is warranted. Every reason describes a condition the browser will not recover
 * from on its own within the configured window.
 */
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
 * `transportId` is absent for a `never-established` recommendation, which is per peer connection
 * rather than per transport. `conditionDurationInMs` is how long the triggering condition had
 * persisted when the recommendation went out, `iceGeneration` how many restarts have already been
 * observed, and `recommendationCount` how many times a restart has been recommended for this
 * transport — a rising count with a flat generation means the application is not acting on them.
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
	/**
	 * Flag to indicate if the detector should create the
	 * `ICE_RESTART_RECOMMENDED` client event in addition to emitting the
	 * monitor event.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;

	/**
	 * How long (in milliseconds) a `disconnected` or stalled transport must
	 * persist before an ICE restart is recommended. ICE `failed` recommends
	 * immediately, since it never self-heals.
	 *
	 * Performing the restart is the application's responsibility — the
	 * library only reports that one is warranted.
	 */
	iceRestartRecommendationThresholdInMs: number;

	/**
	 * Minimum time (in milliseconds) between repeated restart
	 * recommendations for the same ICE transport, so a persisting condition
	 * does not produce one recommendation per stats tick.
	 */
	iceRestartRecommendationCooldownInMs: number;

	/**
	 * How long (in milliseconds) the peer connection must have been
	 * establishing before a `never-established` restart is recommended. This
	 * is the per-peer-connection condition, which has no failing transport to
	 * point at.
	 */
	restartRecommendationThresholdInMs: number;

	/**
	 * Minimum time (in milliseconds) between repeated `never-established`
	 * recommendations, so a persisting condition does not produce one
	 * recommendation per stats tick.
	 */
	restartRecommendationCooldownInMs: number;
}

/**
 * The one place that says "restart ICE". It recommends and never performs: only the application
 * knows whether renegotiation is safe at this moment, whether the signalling channel is even up, and
 * what an SFU on the other end expects. Listen for `'ice-restart-recommended'` and call
 * `pc.restartIce()`, or the transport-level equivalent.
 *
 * Four conditions warrant one, and they are together in one class because they answer one question —
 * *would starting ICE over help?* — and because the rate limiting only means anything if it is
 * shared. Two detectors each politely waiting out their own cooldown produce twice the nagging.
 *
 * Three of the conditions are per transport. `failed` recommends on sight, since ICE never
 * self-heals from it. `disconnected` and a connected-but-not-receiving path each have to outlast
 * `iceRestartRecommendationThresholdInMs` first, because both recover on their own often enough that
 * recommending immediately would ask for a renegotiation the connection did not need. The fourth is
 * per peer connection: an establishment that never finished at all, past
 * `restartRecommendationThresholdInMs`, where there is no failing transport to point at because
 * nothing ever got far enough to have one.
 *
 * Every one of those verdicts is reached from raw transport and connection state, never by asking
 * another detector what it concluded. That is what lets this run in any order relative to the
 * detectors that raise the corresponding issues, lets any of them be disabled without silencing the
 * recommendation, and keeps a recommendation defensible on its own evidence rather than on a
 * conclusion reached elsewhere. The cost is that the stall condition and its guards are written out
 * here a second time, which is the right trade: twenty lines of duplicated bookkeeping in exchange
 * for two detectors that cannot break each other.
 *
 * Condition clocks are stats time, accumulated from each monitor's own `deltaTime` — the transport's
 * for the three per-transport reasons, the peer connection's for `never-established` — so a
 * collection that ran late does not shorten the window a condition had to survive. The cooldowns are
 * the deliberate exception and stay on the wall clock: they throttle how often the application is
 * told, which is a fact about the application's time rather than about the connection's. A restart
 * already in flight
 * — inferred here from a changed ICE local username fragment — suppresses recommendations until it
 * resolves, since asking for a second restart while the first is still negotiating is how an
 * application ends up in a restart loop.
 *
 * What it deliberately does not claim: that a restart will help. It reports that the condition is
 * one a restart is the standard remedy for; a path that has no route to the far end at all will fail
 * again on the new generation, and the rising `recommendationCount` against a flat `iceGeneration`
 * is what tells a reader the advice is not being taken — or is not working.
 *
 * Raises no issue. Monitor event: `ice-restart-recommended`. Client event:
 * `ICE_RESTART_RECOMMENDED`, when `createEvent`. Config: `iceRestartRecommendationDetector`, which
 * holds the thresholds and cooldowns for all four conditions. They are its own rather than borrowed
 * from the detectors that raise the corresponding issues: recommending a renegotiation is a
 * different decision from reporting a fault, and it is normal to want the recommendation to wait
 * longer than the issue did. Disabling `iceDisconnectedDetector` or `icePathEstablishmentDetector`
 * therefore no longer silences the matching recommendation, and vice versa.
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
	/**
	 * Stats time this peer connection has spent in `connecting`, accumulated from its own
	 * `deltaTime` exactly as the three per-transport clocks accumulate the transport's. The
	 * condition being timed is the connection's, so the clock is the connection's.
	 */
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

		// A pending restart has resolved once the transport reaches a terminal verdict
		// for the new generation, either way.
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
			// Rearmed rather than merely quiet: the next incident on this transport
			// should be recommended promptly instead of serving out a cooldown that
			// belongs to a condition which has since cleared.
			state.recommendedAt = undefined;

			return;
		}

		const now = Date.now();

		// Wall clock, deliberately, and unlike the condition clocks in `_accumulate()`:
		// the cooldown rate-limits *notifications* rather than measuring how long
		// anything held, and the thing being throttled is how often the application is
		// told, in the time the application lives in. The known consequence is that a
		// backgrounded tab burns cooldown it never observed and may recommend again on
		// its first tick back — which is the right behaviour for a rate limit: the
		// condition is still true, and real time has passed for it to be acted on.
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
	 * Advances the three per-transport condition clocks from raw state, each one zeroed the moment
	 * its condition stops holding. The stall condition is spelled out here in full — connected on a
	 * succeeded pair, still sending, receiving nothing, having received something before, and
	 * carrying inbound RTP at all — rather than borrowed from the detector that raises the stall
	 * issue, so that neither depends on the other. A send-only publish transport legitimately
	 * receives nothing between consent bursts, which is why the last guard is not optional.
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
	 * Recommends a restart for a peer connection that never finished establishing. Unlike the three
	 * per-transport conditions this one is measured on the peer connection itself, because the fault
	 * is the absence of a working transport — there may be no transport in a reportable state, or no
	 * transport at all, and `connecting` covers the DTLS handshake as well as ICE. What it is *not*
	 * is a different kind of clock: it accumulates the connection's `deltaTime` just as the
	 * per-transport clocks accumulate the transport's, so all four reasons ship a
	 * `conditionDurationInMs` that means the same thing and can be compared with each other.
	 *
	 * It yields to `ice-failed` and `ice-disconnected`: a transport in either state names what went
	 * wrong, where "it never connected" only names what did not happen. Because both reasons now
	 * live in one class this is precedence between two verdicts rather than coordination between two
	 * detectors, and it is still decided from the transports' own states.
	 */
	private _checkEstablishment() {
		const config = this.config;

		if (this.peerConnection.connectionState !== 'connecting') {
			this._neverEstablishedRecommendedAt = undefined;
			// The condition has broken — established, failed or closed — so the next
			// attempt is timed from its own start rather than from this one's.
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

		// Wall clock, deliberately, and unlike the condition clock above: the cooldown
		// rate-limits *notifications* rather than measuring how long anything held, and
		// what a listener wants throttled is how often it is told, in the time it lives
		// in. The known consequence is that a backgrounded tab burns cooldown it never
		// observed and may recommend again on its first tick back — which is the right
		// behaviour for a rate limit: the condition is still true, and the application
		// has had real time to act on the previous recommendation.
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

	/**
	 * Severity used to pick the transport that best explains a stalled establishment. A connection
	 * without BUNDLE has several transports, and the failing one is the story — not whichever
	 * healthy sibling was listed first.
	 */
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
