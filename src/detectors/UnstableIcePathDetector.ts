import { IcePathKind } from "../monitors/IceCandidatePairMonitor";
import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** The path whose selection keeps moving, and how many switches were counted inside the window. */
export type UnstableIcePathIssuePayload = {
	peerConnectionId: string;
	pathKey: string;
	transportId?: string;
	switches: number;
	windowInMs: number;
	/** Absent when the transport had no selected candidate pair to classify at raise time. */
	kind?: IcePathKind;
	/** Switches per the browser's own counter, where it reports one. It also sees flaps too fast to diff. */
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
	/** Tumbling window over which selected-path switches are counted, in stats time. */
	pathSwitchWindowInMs: number;

	/** Switches inside one window needed before the path counts as unstable. */
	pathSwitchThreshold: number;
}

/**
 * Reports an ICE transport whose selected path will not settle. Use it to tell path churn from a
 * path that is simply down: each reselection costs a fresh round of consent checks and a discarded
 * bandwidth estimate, so the call stutters while every state field reads `connected` throughout —
 * two live interfaces fighting, a NAT rewriting bindings, a TURN allocation being re-established.
 *
 * Switches are the larger of two counts. Diffing `selectedCandidatePairId` tick to tick is portable
 * but blind to a flap that departs and returns inside one collecting period; the browser's own
 * `deltaSelectedCandidatePairChanges` sees those but is not reported everywhere. The window tumbles
 * rather than slides, in stats time, so a late collection cannot shrink what it was measuring.
 *
 * It does not claim which path is better, or that the switching is the fault rather than a symptom.
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

			this.peerConnection.issues.raise({
					key: this._issueKey(transport.id),
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

		// A standing issue survives only if the window just closing still justified it.
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

		const key = this._issueKey(transportId);
		const issue = this.peerConnection.issues.get(key);

		if (!issue) return;

		this.peerConnection.issues.resolve({
			key: key,
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
