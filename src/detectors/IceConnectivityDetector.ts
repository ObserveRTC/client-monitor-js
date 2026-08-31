import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { IcePathKind } from "../monitors/IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

/**
 * `disconnectedForMs` is how long the transport had already been `disconnected` when the issue was
 * raised — the threshold, not the episode; `durationInMs` is the episode, filled in on resolve.
 * `iceGeneration` counts the ICE restarts observed on this transport so far, so an issue can be tied
 * to the generation it belongs to.
 */
export type IceDisconnectedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	iceState?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	disconnectedForMs: number;
	iceGeneration: number;
	durationInMs?: number;
};

/** `disconnectedForMs` is set only when the transport had been disconnected before it failed. */
export type IceConnectionFailedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	disconnectedForMs?: number;
	iceGeneration: number;
	durationInMs?: number;
};

/**
 * `direction` is `'inbound'` only, deliberately — see the detector's stall check for why the
 * outbound-silent case is not reportable. `outboundBytesDelta` is the traffic we were still sending
 * while `inboundBytesDelta` stayed at zero, which is what makes the expectation defensible.
 */
export type IceTransportStalledIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	iceState?: string;
	candidatePairState?: string;
	selectedCandidatePairId?: string;
	direction: 'inbound';
	stalledForMs: number;
	outboundBytesDelta?: number;
	inboundBytesDelta?: number;
	currentRoundTripTime?: number;
	lastPacketReceivedTimestamp?: number;
	iceGeneration: number;
	durationInMs?: number;
};

/**
 * `pathKey` identifies the path whose selection keeps moving, `switches` is how many switches were
 * counted inside `windowInMs`, and `kind` is how the path was classified at raise time.
 */
export type UnstableIcePathIssuePayload = {
	peerConnectionId: string;
	pathKey: string;
	transportId?: string;
	switches: number;
	windowInMs: number;
	kind: IcePathKind;
	/**
	 * Switches inside the window according to the browser's own
	 * `selectedCandidatePairChanges` counter, when the browser reports one
	 * (Chrome 80+, Firefox 155+). It also counts flaps too fast for the
	 * tick-to-tick path diffing to observe, which is why `switches` can
	 * exceed the observed transition count.
	 */
	nativePairChanges?: number;
	durationInMs?: number;
};

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
	/**
	 * The peer connection never finished establishing. Tracked at peer-connection level, because
	 * `connectionState` covers the DTLS handshake too — a connection can sit in `connecting` with
	 * every ICE transport reporting `connected` — and because an attempt that never gets anywhere may
	 * have no transport in a reportable state at all.
	 */
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
	iceGeneration: number;
	usernameFragment?: string;
	restartPending: boolean;

	disconnectedSince?: number;
	disconnectRaisedAt?: number;

	failedRaisedAt?: number;

	sawInboundTraffic: boolean;

	restartRecommendedAt?: number;
	restartRecommendations: number;
	inboundStalledSince?: number;
	stallRaisedAt?: number;

	/**
	 * When the browser reported a selected-pair change through the native
	 * `selectedCandidatePairChanges` counter: one entry per change, timestamped
	 * at the tick that observed it. Complements the path diffing, which cannot
	 * see a flap that departs and returns within one collecting period.
	 */
	nativeSwitchTimestamps: number[];
	/**
	 * Ticks left during which native pair changes are not recorded — set on an
	 * inferred ICE restart, whose own reselection is not churn.
	 */
	suppressNativeChurnTicks: number;
};

const DISCONNECTED_ISSUE_TYPE = 'ice-disconnected';
const FAILED_ISSUE_TYPE = 'ice-connection-failed';
const STALLED_ISSUE_TYPE = 'ice-transport-stalled';
const UNSTABLE_PATH_ISSUE_TYPE = 'unstable-ice-path';

/**
 * Runtime ICE and transport health for a peer connection: the difference between a call that drops,
 * one that goes silent while every state still reads healthy, and one that keeps hopping between
 * paths. Setup latency is explicitly out of scope — `LongPcConnectionEstablishmentDetector` owns
 * that. All state is kept per ICE transport, because a peer connection without BUNDLE has several
 * and they fail independently.
 *
 * Five distinct findings live here, and they are one detector because they share the transport state
 * machine and the ICE generation counter that dates every one of them. *Persistent disconnection*:
 * `disconnected` starts a timer and only raises `ice-disconnected` once it has held for
 * `disconnectedThresholdInMs`, so the transient blips that ICE self-heals from never produce an
 * issue. *Failure*: `failed` raises `ice-connection-failed` immediately, since unlike `disconnected`
 * it is terminal for that generation. *Inbound stall*: the interesting one, because every state
 * still reads connected — see `_checkInboundStall` for why our own outbound traffic is what makes
 * the expectation defensible, and why "no traffic in either direction" is deliberately not
 * reportable. *Restart detection and recommendation*: a changed ICE local username fragment means a
 * new generation, reported as an event rather than an issue because confidence is limited; and when
 * a condition outlasts `iceRestartRecommendationThresholdInMs` the detector *recommends* a restart
 * and never performs one. *Unstable path*: too many path switches inside a window.
 *
 * Order within a tick is load-bearing and the code says so where it matters: this tick's ICE state
 * describes the generation the tick started in, restart detection has to run before the
 * recommendation, and the recommendation must know a restart is already in flight.
 *
 * What it will not judge: a closed peer connection; a transport that has gone away, whose issues are
 * resolved rather than left standing; a stall on a path that never delivered inbound traffic or is
 * not currently sending; and a `connected` to `checking` transition on its own, which is not treated
 * as a restart. Known limits: `iceLocalUsernameFragment` is not exposed by every browser — on
 * Firefox the transport report is reconstructed by `FirefoxStatsAdapter` and carries none, so
 * restart inference falls back to the selected local candidate's `usernameFragment` and is silently
 * unavailable when neither is present. High-confidence restart detection needs the application to
 * instrument `restartIce()`; stats alone cannot separate an application-triggered restart from a
 * browser-initiated one.
 *
 * Issues raised: `ice-disconnected`, `ice-connection-failed`, `ice-transport-stalled`,
 * `unstable-ice-path`. Monitor events: `ice-restart`, `ice-restart-recommended`. Client events:
 * `ICE_RESTART` and `ICE_RESTART_RECOMMENDED`, when `createEvent`. Config:
 * `iceConnectivityDetector`.
 */
export class IceConnectivityDetector implements Detector {
	public static readonly DISCONNECTED_ISSUE_TYPE = DISCONNECTED_ISSUE_TYPE;
	public static readonly FAILED_ISSUE_TYPE = FAILED_ISSUE_TYPE;
	public static readonly STALLED_ISSUE_TYPE = STALLED_ISSUE_TYPE;
	public static readonly UNSTABLE_PATH_ISSUE_TYPE = UNSTABLE_PATH_ISSUE_TYPE;

	public readonly name = 'ice-connectivity-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();
	private readonly _unstablePaths = new Map<string, number>();

	private _establishmentRecommendedAt?: number;
	private _establishmentRecommendations = 0;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.iceConnectivityDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const seenIds = new Set<string>();
		let recommendedThisTick = false;

		for (const transport of this.peerConnection.iceTransports) {
			seenIds.add(transport.id);

			const state = this._getState(transport);

			// Order is load-bearing: this tick's ICE state still describes the generation the tick started in, so it
			// goes first; restart detection then runs before the recommendation, which must know about a restart already in flight.
			this._checkIceState(transport, state);
			this._checkInboundStall(transport, state);
			this._checkIceRestart(transport, state);
			// after restart detection, which suppresses the restart's own reselection
			this._recordNativePairChanges(transport, state);
			recommendedThisTick = this._checkRestartRecommendation(transport, state) || recommendedThisTick;
		}

		this._checkPathStability();
		this._checkEstablishmentRecommendation(recommendedThisTick);

		for (const id of [ ...this._states.keys() ]) {
			if (seenIds.has(id)) continue;

			this._resolveAll(id, 'ice transport is gone');
			this._states.delete(id);
		}
	}

	/**
	 * Records this tick's native selected-pair changes, when the browser reports
	 * the `selectedCandidatePairChanges` counter (Chrome 80+, Firefox 155+). The
	 * path diffing in `SelectedIcePath` is the classifier and the portable
	 * fallback, but it is tick-to-tick and structurally blind to a flap that
	 * departs and returns within one collecting period — the native counter is
	 * the browser's own ground truth for *how many* switches happened.
	 */
	private _recordNativePairChanges(transport: IceTransportMonitor, state: TransportState) {
		if (0 < state.suppressNativeChurnTicks) {
			state.suppressNativeChurnTicks -= 1;

			return;
		}

		const delta = transport.deltaSelectedCandidatePairChanges;

		if (delta === undefined || delta <= 0) return;

		const now = Date.now();
		const since = now - this.config.pathSwitchWindowInMs;

		for (let i = 0; i < Math.min(delta, 16); ++i) {
			state.nativeSwitchTimestamps.push(now);
		}

		state.nativeSwitchTimestamps = state.nativeSwitchTimestamps.filter((timestamp) => since <= timestamp);

		if (64 < state.nativeSwitchTimestamps.length) {
			state.nativeSwitchTimestamps.splice(0, state.nativeSwitchTimestamps.length - 64);
		}
	}

	/**
	 * Raises `unstable-ice-path` when a selected path switched at least `pathSwitchThreshold` times
	 * inside `pathSwitchWindowInMs` — a path that keeps moving is a different failure from one that is
	 * down, and the switching itself is what the user hears. Counted as the larger of the observed
	 * path transitions and the browser's own `selectedCandidatePairChanges` deltas, which also see
	 * flaps too fast for tick-to-tick diffing. Resolved when the rate falls back below the threshold,
	 * or when the path disappears.
	 */
	private _checkPathStability() {
		const { pathSwitchWindowInMs, pathSwitchThreshold } = this.config;
		const now = Date.now();
		const seenKeys = new Set<string>();

		for (const path of this.peerConnection.selectedIcePaths) {
			seenKeys.add(path.key);

			const since = now - pathSwitchWindowInMs;
			const nativePairChanges = this._states.get(path.transportId ?? '')
				?.nativeSwitchTimestamps.filter((timestamp) => since <= timestamp).length ?? 0;
			const switches = Math.max(path.getSwitchCountSince(since), nativePairChanges);
			const raisedAt = this._unstablePaths.get(path.key);

			if (switches < pathSwitchThreshold) {
				if (raisedAt !== undefined) {
					this._resolveIssue(UNSTABLE_PATH_ISSUE_TYPE, path.key, raisedAt, 'ice path became stable');
					this._unstablePaths.delete(path.key);
				}
				continue;
			}

			if (raisedAt !== undefined) continue;

			this._unstablePaths.set(path.key, now);

			this.peerConnection.parent.raiseIssue<UnstableIcePathIssuePayload>(
				this._issueKey(UNSTABLE_PATH_ISSUE_TYPE, path.key),
				{
				includeInSample: this.includeIssueInSample,
					type: UNSTABLE_PATH_ISSUE_TYPE,
					payload: {
						peerConnectionId: this.peerConnection.peerConnectionId,
						pathKey: path.key,
						transportId: path.transportId,
						switches,
						windowInMs: pathSwitchWindowInMs,
						kind: path.kind,
						nativePairChanges: 0 < nativePairChanges ? nativePairChanges : undefined,
					},
				}
			);
		}

		for (const [ key, raisedAt ] of [ ...this._unstablePaths.entries() ]) {
			if (seenKeys.has(key)) continue;

			this._resolveIssue(UNSTABLE_PATH_ISSUE_TYPE, key, raisedAt, 'ice path is gone');
			this._unstablePaths.delete(key);
		}
	}

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				iceGeneration: 0,
				usernameFragment: this._usernameFragmentOf(transport),
				restartPending: false,
				sawInboundTraffic: false,
				restartRecommendations: 0,
				nativeSwitchTimestamps: [],
				suppressNativeChurnTicks: 0,
			};
			this._states.set(transport.id, state);
		}

		return state;
	}

	/**
	 * Infers an ICE restart from a changed local username fragment, which means a new ICE generation.
	 * Reported as the `ice-restart` event with outcome `detected`, never as an issue, because the
	 * inference is stats-based. The new generation invalidates everything observed under the old one,
	 * so the disconnect, failure and stall issues are resolved and their timers cleared.
	 */
	private _checkIceRestart(transport: IceTransportMonitor, state: TransportState) {
		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment === undefined) return;
		if (state.usernameFragment === undefined) {
			state.usernameFragment = usernameFragment;
			return;
		}
		if (state.usernameFragment === usernameFragment) return;

		state.usernameFragment = usernameFragment;
		state.iceGeneration += 1;
		state.restartPending = true;

		if (state.disconnectRaisedAt !== undefined) {
			this._resolveIssue(DISCONNECTED_ISSUE_TYPE, transport.id, state.disconnectRaisedAt, 'ice restarted');
		}
		if (state.failedRaisedAt !== undefined) {
			this._resolveIssue(FAILED_ISSUE_TYPE, transport.id, state.failedRaisedAt, 'ice restarted');
		}
		if (state.stallRaisedAt !== undefined) {
			this._resolveIssue(STALLED_ISSUE_TYPE, transport.id, state.stallRaisedAt, 'ice restarted');
		}

		state.disconnectedSince = undefined;
		state.disconnectRaisedAt = undefined;
		state.failedRaisedAt = undefined;
		state.stallRaisedAt = undefined;
		state.inboundStalledSince = undefined;
		state.sawInboundTraffic = false;
		// the restart's own reselection increments the native counter, and is not churn
		state.nativeSwitchTimestamps = [];
		state.suppressNativeChurnTicks = 2;

		this._notifyRestart(transport, state, 'detected');
	}

	private _usernameFragmentOf(transport: IceTransportMonitor): string | undefined {
		return transport.iceLocalUsernameFragment
			?? transport.getSelectedCandidatePair()?.getLocalCandidate()?.usernameFragment;
	}

	/**
	 * Owns the two state-driven issues. `failed` raises `ice-connection-failed` at once, since it is
	 * terminal for the generation, and supersedes any stall issue. `disconnected` raises
	 * `ice-disconnected` only after it has persisted for `disconnectedThresholdInMs`, so self-healing
	 * blips stay quiet. `connected` / `completed` resolves both and settles any restart still pending.
	 */
	private _checkIceState(transport: IceTransportMonitor, state: TransportState) {
		const iceState = transport.iceState;

		switch (iceState) {
			case 'failed': {
				state.disconnectedSince = undefined;

				if (state.failedRaisedAt !== undefined) return;

				state.failedRaisedAt = Date.now();

				if (state.restartPending) {
					state.restartPending = false;
					this._notifyRestart(transport, state, 'failed');
				}

				this.peerConnection.parent.raiseIssue<IceConnectionFailedIssuePayload>(
					this._issueKey(FAILED_ISSUE_TYPE, transport.id),
					{
				includeInSample: this.includeIssueInSample,
						type: FAILED_ISSUE_TYPE,
						payload: {
							peerConnectionId: this.peerConnection.peerConnectionId,
							transportId: transport.id,
							dtlsState: transport.dtlsState,
							selectedCandidatePairId: transport.selectedCandidatePairId,
							iceGeneration: state.iceGeneration,
						},
					}
				);

				this._resolveIssue(STALLED_ISSUE_TYPE, transport.id, state.stallRaisedAt, 'ice connection failed');
				state.stallRaisedAt = undefined;
				state.inboundStalledSince = undefined;
				return;
			}
			case 'disconnected': {
				if (state.disconnectedSince === undefined) {
					state.disconnectedSince = Date.now();
				}

				const disconnectedForMs = Date.now() - state.disconnectedSince;

				if (disconnectedForMs < this.config.disconnectedThresholdInMs) return;
				if (state.disconnectRaisedAt !== undefined) return;

				state.disconnectRaisedAt = Date.now();

				this.peerConnection.parent.raiseIssue<IceDisconnectedIssuePayload>(
					this._issueKey(DISCONNECTED_ISSUE_TYPE, transport.id),
					{
				includeInSample: this.includeIssueInSample,
						type: DISCONNECTED_ISSUE_TYPE,
						payload: {
							peerConnectionId: this.peerConnection.peerConnectionId,
							transportId: transport.id,
							iceState,
							dtlsState: transport.dtlsState,
							selectedCandidatePairId: transport.selectedCandidatePairId,
							disconnectedForMs,
							iceGeneration: state.iceGeneration,
						},
					}
				);
				return;
			}
			case 'connected':
			case 'completed': {
				state.disconnectedSince = undefined;

				if (state.disconnectRaisedAt !== undefined) {
					this._resolveIssue(DISCONNECTED_ISSUE_TYPE, transport.id, state.disconnectRaisedAt, 'ice connection recovered');
					state.disconnectRaisedAt = undefined;
				}
				if (state.failedRaisedAt !== undefined) {
					this._resolveIssue(FAILED_ISSUE_TYPE, transport.id, state.failedRaisedAt, 'ice connection recovered');
					state.failedRaisedAt = undefined;
				}
				state.restartRecommendedAt = undefined;

				if (state.restartPending) {
					state.restartPending = false;
					this._notifyRestart(transport, state, 'recovered');
				}
				return;
			}
			default:
				// 'new' / 'checking' / 'closed': a return to `checking` is deliberately not treated as a restart on its own.
				state.disconnectedSince = undefined;
				return;
		}
	}

	/**
	 * Raises `ice-transport-stalled` when a connected transport on a succeeded pair is still sending
	 * but has received nothing for `transportStallThresholdInMs`, and only once inbound traffic had
	 * previously been seen. Deliberately narrow: a live ICE path returns at least STUN consent, so
	 * sending-without-receiving is anomalous whatever the application intends to send, whereas silence
	 * in both directions cannot be told from a legitimately idle connection.
	 */
	private _checkInboundStall(transport: IceTransportMonitor, state: TransportState) {
		const iceState = transport.iceState;
		const pair = transport.getSelectedCandidatePair();

		if ((iceState !== 'connected' && iceState !== 'completed') || !pair || pair.state !== 'succeeded') {
			state.inboundStalledSince = undefined;
			return;
		}

		const inboundBytesDelta = pair.deltaBytesReceived;
		const outboundBytesDelta = pair.deltaBytesSent;

		if (inboundBytesDelta === undefined || outboundBytesDelta === undefined) return;

		if (0 < inboundBytesDelta) {
			state.sawInboundTraffic = true;
			state.inboundStalledSince = undefined;

			if (state.stallRaisedAt !== undefined) {
				this._resolveIssue(STALLED_ISSUE_TYPE, transport.id, state.stallRaisedAt, 'inbound traffic resumed');
				state.stallRaisedAt = undefined;
			}
			return;
		}

		// Our own outbound traffic is what makes the expectation defensible (a live path returns at least STUN
		// consent); without it, or without prior inbound, a stall cannot be told from a legitimately idle path.
		if (!state.sawInboundTraffic || outboundBytesDelta <= 0) {
			state.inboundStalledSince = undefined;
			return;
		}

		if (state.inboundStalledSince === undefined) {
			state.inboundStalledSince = Date.now();
		}

		const stalledForMs = Date.now() - state.inboundStalledSince;

		if (stalledForMs < this.config.transportStallThresholdInMs) return;
		if (state.stallRaisedAt !== undefined) return;

		state.stallRaisedAt = Date.now();

		this.peerConnection.parent.raiseIssue<IceTransportStalledIssuePayload>(
			this._issueKey(STALLED_ISSUE_TYPE, transport.id),
			{
				includeInSample: this.includeIssueInSample,
				type: STALLED_ISSUE_TYPE,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					transportId: transport.id,
					iceState,
					candidatePairState: pair.state,
					selectedCandidatePairId: transport.selectedCandidatePairId,
					direction: 'inbound',
					stalledForMs,
					outboundBytesDelta,
					inboundBytesDelta,
					currentRoundTripTime: pair.currentRoundTripTime,
					lastPacketReceivedTimestamp: pair.lastPacketReceivedTimestamp,
					iceGeneration: state.iceGeneration,
				},
			}
		);
	}

	/**
	 * Emits `ice-restart-recommended` for a transport stuck in `failed`, or `disconnected` or stalled
	 * for longer than `iceRestartRecommendationThresholdInMs`, rate-limited by
	 * `iceRestartRecommendationCooldownInMs` and suppressed while a restart is already pending.
	 *
	 * Recommends, never performs: only the application knows whether renegotiation is safe right now.
	 * Listen for `'ice-restart-recommended'` and call `pc.restartIce()` (or the SFU equivalent).
	 */
	private _checkRestartRecommendation(transport: IceTransportMonitor, state: TransportState): boolean {
		const now = Date.now();
		const { iceRestartRecommendationThresholdInMs, iceRestartRecommendationCooldownInMs } = this.config;

		if (state.restartPending) return false;

		let reason: IceRestartRecommendationReason | undefined;
		let conditionDurationInMs = 0;

		if (transport.iceState === 'failed') {
			reason = 'ice-failed';
			conditionDurationInMs = state.failedRaisedAt === undefined ? 0 : now - state.failedRaisedAt;
		} else if (state.disconnectedSince !== undefined && iceRestartRecommendationThresholdInMs <= now - state.disconnectedSince) {
			reason = 'ice-disconnected';
			conditionDurationInMs = now - state.disconnectedSince;
		} else if (state.inboundStalledSince !== undefined && iceRestartRecommendationThresholdInMs <= now - state.inboundStalledSince) {
			reason = 'transport-stalled';
			conditionDurationInMs = now - state.inboundStalledSince;
		}

		if (reason === undefined) {
			state.restartRecommendedAt = undefined;
			return false;
		}

		if (state.restartRecommendedAt !== undefined && now - state.restartRecommendedAt < iceRestartRecommendationCooldownInMs) {
			return false;
		}

		state.restartRecommendedAt = now;
		state.restartRecommendations += 1;

		this._recommendRestart({
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: transport.id,
			reason,
			conditionDurationInMs,
			iceGeneration: state.iceGeneration,
			recommendationCount: state.restartRecommendations,
			iceState: transport.iceState,
			dtlsState: transport.dtlsState,
			selectedCandidatePairId: transport.selectedCandidatePairId,
		});

		return true;
	}

	/**
	 * The peer-connection-level `never-established` recommendation, for a connection that has sat in
	 * `connecting` past the same threshold. Kept separate from the per-transport path because
	 * `connectionState` also covers DTLS and because a failing attempt may have no transport in a
	 * reportable state; it stands down if any transport already recommended this tick or has a restart
	 * pending.
	 */
	private _checkEstablishmentRecommendation(alreadyRecommended: boolean) {
		const { connectionState, connectingStartedAt } = this.peerConnection;
		const now = Date.now();

		if (connectionState !== 'connecting' || connectingStartedAt === undefined) {
			this._establishmentRecommendedAt = undefined;
			return;
		}

		const conditionDurationInMs = now - connectingStartedAt;

		if (conditionDurationInMs < this.config.iceRestartRecommendationThresholdInMs) return;
		if (alreadyRecommended) return;
		for (const state of this._states.values()) {
			if (state.restartPending) return;
		}
		if (this._establishmentRecommendedAt !== undefined
			&& now - this._establishmentRecommendedAt < this.config.iceRestartRecommendationCooldownInMs) {
			return;
		}

		this._establishmentRecommendedAt = now;
		this._establishmentRecommendations += 1;

		// The transport whose state best explains the stall — the most severe one.
		// A connection without BUNDLE has several transports, and the failing one
		// is the story, not whichever healthy sibling happened to be listed first.
		const severity: Record<string, number> = {
			failed: 6, disconnected: 5, checking: 4, new: 3, connected: 2, completed: 1, closed: 0,
		};
		let subject: IceTransportMonitor | undefined;

		for (const transport of this.peerConnection.iceTransports) {
			if (subject === undefined
				|| (severity[subject.iceState ?? ''] ?? -1) < (severity[transport.iceState ?? ''] ?? -1)) {
				subject = transport;
			}
		}

		this._recommendRestart({
			peerConnectionId: this.peerConnection.peerConnectionId,
			reason: 'never-established',
			conditionDurationInMs,
			iceGeneration: this._states.get(subject?.id ?? '')?.iceGeneration ?? 0,
			recommendationCount: this._establishmentRecommendations,
			iceState: subject?.iceState,
			dtlsState: subject?.dtlsState,
		});
	}

	private _recommendRestart(payload: IceRestartRecommendedEventPayload) {
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

	private _notifyRestart(transport: IceTransportMonitor, state: TransportState, outcome: IceRestartOutcome) {
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

	private _resolveAll(transportId: string, comment: string) {
		const state = this._states.get(transportId);

		if (state?.disconnectRaisedAt !== undefined) {
			this._resolveIssue(DISCONNECTED_ISSUE_TYPE, transportId, state.disconnectRaisedAt, comment);
		}
		if (state?.failedRaisedAt !== undefined) {
			this._resolveIssue(FAILED_ISSUE_TYPE, transportId, state.failedRaisedAt, comment);
		}
		if (state?.stallRaisedAt !== undefined) {
			this._resolveIssue(STALLED_ISSUE_TYPE, transportId, state.stallRaisedAt, comment);
		}
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

	private _issueKey(type: string, transportId: string) {
		return `${type}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
