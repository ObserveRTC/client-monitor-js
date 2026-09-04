import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
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
	/**
	 * How long (in milliseconds) an ICE transport must stay `disconnected`
	 * before an issue is raised. Transient disconnections below this
	 * threshold are ignored, since they are common and self-healing; raising
	 * it tolerates longer blips, lowering it reports them.
	 */
	disconnectedThresholdInMs: number;
}

/**
 * Reports an ICE transport that has been `disconnected` long enough that it is no longer going to
 * fix itself. `disconnected` on its own is not a fault and never worth an issue: it is what a
 * browser says when consent checks have missed for a moment, and a Wi-Fi roam, a brief radio dropout
 * or a busy CPU produce it several times in an ordinary call while ICE quietly recovers. What
 * separates the blip from the outage is only how long it lasts, which is what
 * `disconnectedThresholdInMs` measures.
 *
 * The clock is stats time — each `disconnected` tick adds the transport's own `deltaTime` — so a
 * collection that ran late or was skipped still credits the outage with the time it actually lasted
 * underneath, rather than the time the library happened to spend not looking. Anything that ends the
 * condition resets the accumulator to zero, so the next blip is judged fresh instead of inheriting
 * the last one's credit.
 *
 * A changed ICE local username fragment means a new ICE generation, and the new generation deserves
 * to be judged on its own: the standing issue is resolved and the clock restarts. The fragment is
 * read here rather than asked of `IceRestartDetector`, so neither detector depends on the other or
 * on the order they run in.
 *
 * What it deliberately does not claim: that the media path is gone. A `disconnected` transport
 * frequently comes back, which is why the issue is resolved rather than terminal, and why `failed` —
 * which is terminal for the generation — belongs to `IceConnectionFailedDetector` instead. It also
 * says nothing about a transport that is `connected` and simply carrying nothing;
 * `IceTransportStalledDetector` owns that, and the two conditions cannot be true at once.
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
			// 'new' / 'checking' / 'closed' / 'failed'. None of them is this detector's
			// condition, and a standing issue is left standing: a transport that fell
			// from `disconnected` into `failed` has not recovered, it has got worse.
			state.disconnectedForInMs = 0;

			return;
		}

		state.disconnectedForInMs += transport.deltaTime ?? 0;

		if (state.disconnectedForInMs < this.config.disconnectedThresholdInMs) return;
		if (state.raisedAt !== undefined) return;

		state.raisedAt = Date.now();

		this.peerConnection.parent.raiseIssue<IceDisconnectedIssuePayload>(
			this._issueKey(transport.id),
			{
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

		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(transportId);
		const issue = clientMonitor.activeIssues.get(key);

		if (!issue) return;

		clientMonitor.resolveIssue<IceDisconnectedIssuePayload>(key, {
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
