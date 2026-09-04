import { IcePathKind } from "../monitors/IceCandidatePairMonitor";
import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

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
	/** Absent when the transport had no selected candidate pair to classify at raise time. */
	kind?: IcePathKind;
	/**
	 * Switches inside the window according to the browser's own
	 * `selectedCandidatePairChanges` counter, when the browser reports one
	 * (Chrome 80+, Firefox 155+). It also counts flaps too fast for the
	 * tick-to-tick pair diffing to observe, which is why `switches` can
	 * exceed the observed transition count.
	 */
	nativePairChanges?: number;
	durationInMs?: number;
};

type TransportState = {
	/** The selected pair id as of the previous tick, for the portable diffing fallback. */
	selectedCandidatePairId?: string;
	/** Stats time accumulated in the current window; the window tumbles when it exceeds the config. */
	windowElapsedInMs: number;
	switchesInWindow: number;
	nativeChangesInWindow: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'unstable-ice-path';

export type UnstableIcePathDetectorConfig = {
	/**
	 * The window (in milliseconds) over which selected-path switches are
	 * counted. It tumbles rather than slides: once this much stats time has
	 * accumulated the count starts over. A wider window catches slower
	 * churn at the cost of remembering switches for longer.
	 */
	pathSwitchWindowInMs: number;

	/**
	 * How many selected-path switches inside `pathSwitchWindowInMs` are
	 * needed before the path is considered unstable.
	 */
	pathSwitchThreshold: number;
}

/**
 * Reports an ICE transport whose selected path will not settle. This is a different failure from a
 * path that is down, and a worse one to experience: each reselection is a fresh round of consent
 * checks over a new tuple, so media stutters, the encoder's bandwidth estimate is thrown away and
 * rebuilt, and the call sounds broken while every state field reports `connected` throughout. The
 * usual causes are a device with two live interfaces fighting over which one wins, a NAT rewriting
 * bindings underneath a live flow, or a TURN allocation that keeps being re-established.
 *
 * Switches are counted as the larger of two sources, because neither alone is sufficient. Diffing
 * `selectedCandidatePairId` from tick to tick is portable and works everywhere, but it is blind to a
 * flap that departs and returns inside one collecting period — two switches that look like none. The
 * browser's own `deltaSelectedCandidatePairChanges` sees exactly those, and is the ground truth for
 * *how many* happened, but Safari does not report it at all and neither does Firefox before 155.
 * Taking the maximum means the detector uses the better evidence where it exists and still works
 * where it does not.
 *
 * The window is **tumbling**, not sliding: each tick adds the transport's own `deltaTime`, and once
 * the accumulated time passes `pathSwitchWindowInMs` both counters reset and a new window starts.
 * A sliding window would need a timestamp per switch and the bookkeeping to age them out, and it
 * would buy nothing here — the question being asked is "is this path flapping right now", where the
 * difference between a window that slides and one that tumbles is at worst a threshold reached one
 * window later. The clock is stats time for the usual reason: a collection that ran late must not
 * shrink the window it was measuring.
 *
 * What it deliberately does not claim: which path is better, or that the switching itself is the
 * fault rather than a symptom of the network underneath. It reports that the selection is not
 * settling and how often, and leaves the cause to whoever reads the candidate types alongside it.
 *
 * Issue raised: `unstable-ice-path`, resolved when a whole window passes below the threshold or when
 * the transport goes away. Config: `unstableIcePathDetector`.
 *
 * Category: Connectivity
 * Layer: 5 — Path continuity
 *
 */
export class UnstableIcePathDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'unstable-ice-path-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.unstableIcePathDetector!;
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
		const { pathSwitchWindowInMs, pathSwitchThreshold } = this.config;
		const state = this._getState(transport);
		const observedSwitch = state.selectedCandidatePairId !== undefined
			&& state.selectedCandidatePairId !== transport.selectedCandidatePairId;
		const nativeChanges = transport.deltaSelectedCandidatePairChanges ?? 0;

		state.selectedCandidatePairId = transport.selectedCandidatePairId;
		state.windowElapsedInMs += transport.deltaTime ?? 0;
		state.switchesInWindow += Math.max(observedSwitch ? 1 : 0, nativeChanges);
		state.nativeChangesInWindow += nativeChanges;

		if (pathSwitchThreshold <= state.switchesInWindow && state.raisedAt === undefined) {
			const pair = transport.getSelectedCandidatePair();

			state.raisedAt = Date.now();

			this.peerConnection.parent.raiseIssue<UnstableIcePathIssuePayload>(
				this._issueKey(transport.id),
				{
					includeInSample: this.includeIssueInSample,
					type: ISSUE_TYPE,
					payload: {
						peerConnectionId: this.peerConnection.peerConnectionId,
						pathKey: pair?.pathKey ?? transport.id,
						transportId: transport.id,
						switches: state.switchesInWindow,
						windowInMs: pathSwitchWindowInMs,
						kind: pair?.pathKind,
						nativePairChanges: 0 < state.nativeChangesInWindow ? state.nativeChangesInWindow : undefined,
					},
				}
			);
		}

		if (state.windowElapsedInMs < pathSwitchWindowInMs) return;

		// The window tumbles: a standing issue survives only if the window that
		// just closed still carried enough switches to justify it.
		if (state.switchesInWindow < pathSwitchThreshold) {
			this._resolve(transport.id, 'ice path became stable');
		}

		state.windowElapsedInMs = 0;
		state.switchesInWindow = 0;
		state.nativeChangesInWindow = 0;
	}

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				selectedCandidatePairId: transport.selectedCandidatePairId,
				windowElapsedInMs: 0,
				switchesInWindow: 0,
				nativeChangesInWindow: 0,
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

		clientMonitor.resolveIssue<UnstableIcePathIssuePayload>(key, {
			comment,
			payload: {
				...(issue.payload as UnstableIcePathIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
