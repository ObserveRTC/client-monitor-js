import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export type IceDisconnectedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	iceState?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	/** How long the transport had been `disconnected` when the issue was raised — the threshold, not the episode. */
	disconnectedForMs: number;
	/** ICE restarts observed on this transport so far, tying the issue to its generation. */
	iceGeneration: number;
	/** The episode's length, filled in on resolve. */
	durationInMs?: number;
};

type TransportState = {
	/** ICE restarts observed on this transport, inferred from the local username fragment. */
	iceGeneration: number;
	usernameFragment?: string;
	/** Stats time accumulated while `disconnected`, reset the moment that stops being true. */
	disconnectedForInMs: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'ice-disconnected';

export type IceDisconnectedDetectorConfig = {
	/** How long a transport must stay `disconnected` before an issue is raised; shorter blips are ignored. */
	disconnectedThresholdInMs: number;
}

/**
 * Reports an ICE transport that has been `disconnected` long enough that it is no longer going to
 * fix itself. Use it to tell an outage from the ordinary blip a Wi-Fi roam or a busy CPU produces
 * several times a call: only duration separates them, which is what `disconnectedThresholdInMs`
 * measures.
 *
 * The clock is stats time, so a late or skipped collection still credits the outage with the time it
 * really lasted, and anything ending the condition zeroes it. A changed ICE local username fragment
 * means a new generation, which resolves the standing issue and restarts the clock; the fragment is
 * read here rather than asked of `IceRestartDetector`, so neither depends on the other's ordering.
 *
 * It does not claim the media path is gone — `disconnected` often comes back, terminal `failed`
 * belongs to `IceConnectionFailedDetector`, and a connected path carrying nothing belongs to
 * `IceTransportStalledDetector`.
 *
 * Issue raised: `ice-disconnected`, resolved when ICE reconnects, when an ICE restart is inferred,
 * or when the transport goes away. Config: `iceDisconnectedDetector`.
 *
 * Category: Connectivity
 * Layer: 5 — Path continuity
 *
 */
export class IceDisconnectedDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'ice-disconnected-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.iceDisconnectedDetector!;
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
		const state = this._getState(transport);
		const usernameFragment = this._usernameFragmentOf(transport);

		if (usernameFragment !== undefined && state.usernameFragment !== undefined
			&& usernameFragment !== state.usernameFragment) {
			state.iceGeneration += 1;
			state.disconnectedForInMs = 0;

			this._resolve(transport.id, 'ice restarted');
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;

		const iceState = transport.iceState;

		if (iceState === 'connected' || iceState === 'completed') {
			state.disconnectedForInMs = 0;

			this._resolve(transport.id, 'ice connection recovered');

			return;
		}

		if (iceState !== 'disconnected') {
			// A standing issue is left standing: a fall into `failed` is not a recovery.
			state.disconnectedForInMs = 0;

			return;
		}

		state.disconnectedForInMs += transport.deltaTime ?? 0;

		if (state.disconnectedForInMs < this.config.disconnectedThresholdInMs) return;
		if (state.raisedAt !== undefined) return;

		state.raisedAt = Date.now();

		this.peerConnection.issues.raise({
				key: this._issueKey(transport.id),
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					transportId: transport.id,
					iceState,
					dtlsState: transport.dtlsState,
					selectedCandidatePairId: transport.selectedCandidatePairId,
					disconnectedForMs: state.disconnectedForInMs,
					iceGeneration: state.iceGeneration,
				},
			}
		);
	}

	private _usernameFragmentOf(transport: IceTransportMonitor): string | undefined {
		return transport.iceLocalUsernameFragment
			?? transport.getSelectedCandidatePair()?.getLocalCandidate()?.usernameFragment;
	}

	private _getState(transport: IceTransportMonitor): TransportState {
		let state = this._states.get(transport.id);

		if (!state) {
			state = {
				iceGeneration: 0,
				usernameFragment: this._usernameFragmentOf(transport),
				disconnectedForInMs: 0,
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
				...(issue.payload as IceDisconnectedIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
