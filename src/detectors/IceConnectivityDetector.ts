import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { IcePathKind } from "../monitors/IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

export type IceDisconnectedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	iceState?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	/** How long the transport had been disconnected when the issue was raised. */
	disconnectedForMs: number;
	iceGeneration: number;
	durationInMs?: number;
};

export type IceConnectionFailedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	/** Set when the transport had been disconnected before it failed. */
	disconnectedForMs?: number;
	iceGeneration: number;
	durationInMs?: number;
};

export type IceTransportStalledIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	iceState?: string;
	candidatePairState?: string;
	selectedCandidatePairId?: string;
	/** Only `'inbound'` today — see the detector docs for why. */
	direction: 'inbound';
	stalledForMs: number;
	outboundBytesDelta?: number;
	inboundBytesDelta?: number;
	currentRoundTripTime?: number;
	lastPacketReceivedTimestamp?: number;
	iceGeneration: number;
	durationInMs?: number;
};

export type UnstableIcePathIssuePayload = {
	peerConnectionId: string;
	/** The ICE transport (or candidate pair) whose path keeps changing. */
	pathKey: string;
	transportId?: string;
	/** Number of path switches counted inside the observation window. */
	switches: number;
	windowInMs: number;
	/** The path kind at the time the issue was raised. */
	kind: IcePathKind;
	durationInMs?: number;
};

/**
 * Why an ICE restart is warranted. Every reason describes a condition the
 * browser will not recover from on its own within the configured window.
 */
export type IceRestartRecommendationReason =
	/** ICE gave up on this generation; only a restart can revive it. */
	| 'ice-failed'
	/** `disconnected` outlasted the window in which ICE usually self-heals. */
	| 'ice-disconnected'
	/** ICE still reports connected, but the selected path stopped delivering. */
	| 'transport-stalled'
	/**
	 * The peer connection never finished establishing. Tracked at peer-connection
	 * level, because `connectionState` covers the DTLS handshake too — a
	 * connection can sit in `connecting` with every ICE transport reporting
	 * `connected` — and because an attempt that never gets anywhere may have no
	 * transport in a reportable state at all.
	 */
	| 'never-established';

export type IceRestartRecommendedEventPayload = {
	peerConnectionId: string;
	/** Absent for a `never-established` recommendation, which is not per transport. */
	transportId?: string;
	reason: IceRestartRecommendationReason;
	/** How long the triggering condition had persisted when we recommended. */
	conditionDurationInMs: number;
	/** ICE generations observed so far — how many restarts already happened. */
	iceGeneration: number;
	/** How many times a restart has been recommended for this transport. */
	recommendationCount: number;
	iceState?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
};

export type IceRestartOutcome = 'detected' | 'recovered' | 'failed';

export type IceRestartClientEventPayload = {
	peerConnectionId: string;
	transportId: string;
	iceGeneration: number;
	outcome: IceRestartOutcome;
	iceState?: string;
	/** How the new ICE generation was inferred. */
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

	/** True once inbound traffic has been observed on this transport. */
	sawInboundTraffic: boolean;

	restartRecommendedAt?: number;
	restartRecommendations: number;
	inboundStalledSince?: number;
	stallRaisedAt?: number;
};

const DISCONNECTED_ISSUE_TYPE = 'ice-disconnected';
const FAILED_ISSUE_TYPE = 'ice-connection-failed';
const STALLED_ISSUE_TYPE = 'ice-transport-stalled';
const UNSTABLE_PATH_ISSUE_TYPE = 'unstable-ice-path';

/**
 * ICE Connectivity Detector
 *
 * Runtime ICE/transport health for a peer connection. Setup latency is **not**
 * in scope — `LongPcConnectionEstablishmentDetector` owns that.
 *
 * All state is kept per ICE transport, because a peer connection without
 * BUNDLE has several, and they fail independently.
 *
 * **What it detects:**
 *
 * 1. *Persistent disconnection.* A `disconnected` ICE transport starts a timer
 *    and only raises `ice-disconnected` once the state has persisted for
 *    `disconnectedThresholdInMs`. Transient blips — which are normal and
 *    self-healing — never produce an issue. Recovery resolves the issue with
 *    the episode duration, following the same lifecycle as the dry-track
 *    detectors.
 *
 * 2. *ICE failure.* `failed` raises `ice-connection-failed` immediately, since
 *    unlike `disconnected` it is terminal for that generation. If a later ICE
 *    restart brings the transport back, the issue is resolved.
 *
 * 3. *Inbound transport stall.* Deliberately narrow: only raised when this
 *    endpoint is still **sending** on a succeeded pair of a connected
 *    transport while receiving nothing, and only after inbound traffic had
 *    previously been observed. Our own outbound traffic is what makes the
 *    expectation defensible — a live ICE path returns at least STUN consent
 *    traffic, so a sending-but-not-receiving path is anomalous regardless of
 *    what the application intends to send. "No traffic in either direction" is
 *    *not* reported: at peer-connection level it cannot be distinguished from a
 *    legitimately idle or paused connection.
 *
 * 4. *ICE restart (inferred).* A change of the ICE local username fragment
 *    means a new ICE generation. This is reported as a client event with an
 *    incrementing generation counter, never as an issue, because confidence is
 *    limited (see below). A `connected → checking` transition alone is *not*
 *    treated as a restart.
 *
 * **Relationship to other detectors.** `IceTupleChangeDetector` remains the
 * low-level primitive reporting that the selected tuple set changed, and
 * `SelectedIcePath` classifies what kind of path change it was and emits
 * `ice-path-changed`. This detector does not re-report those changes; it only
 * owns the *issue* raised when a path keeps switching.
 *
 * **Known limitations:**
 * - `iceLocalUsernameFragment` is not exposed by every browser. On Firefox the
 *   transport report is reconstructed by `FirefoxStatsAdapter` and
 *   carries no username fragment, so restart inference falls back to the
 *   selected local candidate's `usernameFragment` and is silently unavailable
 *   when neither is present.
 * - High-confidence restart detection needs the application to instrument
 *   `restartIce()`; inference from stats alone cannot distinguish an
 *   application-triggered restart from a browser-initiated one.
 *
 * **Issues created:** `ice-disconnected`, `ice-connection-failed`,
 * `ice-transport-stalled`.
 *
 * **Events emitted:** `ice-restart` (monitor event) and `ICE_RESTART` (client
 * event, when `createEvent`).
 *
 * @example
 * ```typescript
 * const config = {
 *   iceConnectivityDetector: {
 *     disconnectedThresholdInMs: 5000,
 *     transportStallThresholdInMs: 5000,
 *     createEvent: true,
 *   }
 * };
 *
 * monitor.on('issue', (issue) => {
 *   if (issue.type === 'ice-disconnected') console.warn('ICE down', issue.payload);
 * });
 * ```
 */
export class IceConnectivityDetector implements Detector {
	public static readonly DISCONNECTED_ISSUE_TYPE = DISCONNECTED_ISSUE_TYPE;
	public static readonly FAILED_ISSUE_TYPE = FAILED_ISSUE_TYPE;
	public static readonly STALLED_ISSUE_TYPE = STALLED_ISSUE_TYPE;
	public static readonly UNSTABLE_PATH_ISSUE_TYPE = UNSTABLE_PATH_ISSUE_TYPE;

	/** Unique identifier for this detector type */
	public readonly name = 'ice-connectivity-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();
	/** Path keys with an active `unstable-ice-path` issue, and when it was raised. */
	private readonly _unstablePaths = new Map<string, number>();

	/** Peer-connection-level recommendation state for the never-established case. */
	private _establishmentRecommendedAt?: number;
	private _establishmentRecommendations = 0;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	/** Gets the detector configuration from the client monitor */
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

			// Order matters: the ICE state of *this* tick still describes the
			// generation we were in when the tick started, so it is evaluated
			// first. Restart detection runs last, so a restart is never reported
			// as detected and resolved within the same tick — its outcome is
			// decided by the state observed on a later tick.
			this._checkIceState(transport, state);
			this._checkInboundStall(transport, state);
			this._checkIceRestart(transport, state);
			// Last: so a restart the application already performed is known
			// before we decide whether to ask for one.
			recommendedThisTick = this._checkRestartRecommendation(transport, state) || recommendedThisTick;
		}

		this._checkPathStability();
		this._checkEstablishmentRecommendation(recommendedThisTick);

		for (const id of [ ...this._states.keys() ]) {
			if (seenIds.has(id)) continue;

			// The transport is gone (renegotiated away or peer connection
			// closing). Clear anything it still owns so no issue outlives it.
			this._resolveAll(id, 'ice transport is gone');
			this._states.delete(id);
		}
	}

	/**
	 * A selected path that keeps changing is a connectivity problem even when
	 * every individual path works. The switches themselves are counted by
	 * `SelectedIcePath`; this only applies the window and owns the issue.
	 */
	private _checkPathStability() {
		const { pathSwitchWindowInMs, pathSwitchThreshold } = this.config;
		const now = Date.now();
		const seenKeys = new Set<string>();

		for (const path of this.peerConnection.selectedIcePaths) {
			seenKeys.add(path.key);

			const switches = path.getSwitchCountSince(now - pathSwitchWindowInMs);
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
			};
			this._states.set(transport.id, state);
		}

		return state;
	}

	/**
	 * A new ICE local username fragment means the browser is running a new ICE
	 * generation. Falls back to the selected local candidate's fragment for
	 * browsers that do not expose it on the transport report.
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

		// A restart starts a fresh ICE generation, so nothing observed about the
		// previous one still applies. Close its issues and clear the
		// bookkeeping, otherwise the new generation is judged against stale
		// state — a re-failure would look like the old, already-reported one and
		// would never resolve `restartPending`, silencing every later finding.
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
		// The new generation has not proven inbound traffic yet.
		state.sawInboundTraffic = false;

		this._notifyRestart(transport, state, 'detected');
	}

	private _usernameFragmentOf(transport: IceTransportMonitor): string | undefined {
		return transport.iceLocalUsernameFragment
			?? transport.getSelectedCandidatePair()?.getLocalCandidate()?.usernameFragment;
	}

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

				// A failed transport carries no useful traffic expectation.
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
				// 'new' / 'checking' / 'closed' / undefined: establishment and
				// teardown are not this detector's concern. A transition back to
				// `checking` is intentionally NOT treated as a restart on its own.
				state.disconnectedSince = undefined;
				return;
		}
	}

	/**
	 * See the class docs: this only fires for the sending-but-not-receiving
	 * case, on a transport that has previously received traffic.
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

		// Without prior inbound traffic there is no evidence traffic is expected,
		// and without outbound traffic we cannot tell a stall from an idle path.
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
	 * Decide whether an ICE restart is warranted and say so — without doing it.
	 *
	 * Performing the restart is the application's call: only it knows whether a
	 * renegotiation is safe right now, whether signalling is up, and whether it
	 * would rather tear the call down. The library's job is to name the moment
	 * with enough evidence to act on, then get out of the way.
	 *
	 * Listen for `'ice-restart-recommended'` and call `pc.restartIce()` (or your
	 * SFU's equivalent) if your application is in a position to.
	 */
	private _checkRestartRecommendation(transport: IceTransportMonitor, state: TransportState): boolean {
		const now = Date.now();
		const { iceRestartRecommendationThresholdInMs, iceRestartRecommendationCooldownInMs } = this.config;

		// A restart we already spotted is in flight — let it play out.
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
			// Healthy again: the next incident may recommend immediately.
			state.restartRecommendedAt = undefined;
			return false;
		}

		// Don't nag: one recommendation per cooldown while the condition lasts.
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
	 * The peer connection is still trying to establish and has been for too
	 * long. `LongPcConnectionEstablishmentDetector` reports that setup is slow;
	 * this decides that it is not going to happen on its own and a restart (or a
	 * rejoin) is warranted — the escalation the two thresholds describe together.
	 */
	private _checkEstablishmentRecommendation(alreadyRecommended: boolean) {
		const { connectionState, connectingStartedAt } = this.peerConnection;
		const now = Date.now();

		if (connectionState !== 'connecting' || connectingStartedAt === undefined) {
			// Either established or given up on: rearm for the next attempt.
			this._establishmentRecommendedAt = undefined;
			return;
		}

		const conditionDurationInMs = now - connectingStartedAt;

		if (conditionDurationInMs < this.config.iceRestartRecommendationThresholdInMs) return;
		// A transport already asked this tick, and a restart the application
		// started is still in flight on any transport — don't pile on.
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

		const [ firstTransport ] = this.peerConnection.iceTransports;

		this._recommendRestart({
			peerConnectionId: this.peerConnection.peerConnectionId,
			reason: 'never-established',
			conditionDurationInMs,
			iceGeneration: this._states.get(firstTransport?.id ?? '')?.iceGeneration ?? 0,
			recommendationCount: this._establishmentRecommendations,
			iceState: firstTransport?.iceState,
			dtlsState: firstTransport?.dtlsState,
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
				...(issue.payload as Record<string, unknown>),
				durationInMs: raisedAt !== undefined ? Date.now() - raisedAt : undefined,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(type: string, transportId: string) {
		return `${type}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
