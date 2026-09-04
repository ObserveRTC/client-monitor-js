import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * `direction` is `'inbound'` only, deliberately — see the detector's doc comment for why the
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

type TransportState = {
	/** ICE restarts observed on this transport, inferred from the local username fragment. */
	iceGeneration: number;
	usernameFragment?: string;
	/** Whether inbound bytes were ever seen on this transport's selected pair. */
	sawInboundTraffic: boolean;
	/** Stats time accumulated while the stall condition held, reset the moment it breaks. */
	stalledForInMs: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'ice-transport-stalled';

export type IceTransportStalledDetectorConfig = {
	/**
	 * How long (in milliseconds) a connected transport may keep sending
	 * without receiving anything before an inbound stall is reported.
	 */
	transportStallThresholdInMs: number;
}

/**
 * The quiet failure: every state still reads healthy — ICE `connected`, the selected pair
 * `succeeded`, no error anywhere — while the transport keeps sending and receives nothing back. No
 * state machine will ever report this, because as far as the browser is concerned nothing has gone
 * wrong; the only evidence is the asymmetry between what leaves and what arrives.
 *
 * Our own outbound traffic is what makes the expectation defensible. A live ICE path returns at
 * least STUN consent responses and RTCP for whatever we send, so bytes going out with nothing coming
 * back is anomalous no matter what the application intended to receive. The mirror case — silence in
 * both directions — is deliberately **not** reportable: it cannot be told apart from a legitimately
 * idle connection, and a detector that guessed would spend its life reporting muted calls.
 *
 * Two guards keep it off paths where receiving nothing is the healthy state, and both are load
 * bearing. Inbound traffic must have been seen on this transport before, so a path that never
 * delivered anything is left to the detectors that own establishment. And inbound RTP must be
 * attributed to this transport at all: a send-only publish transport — the ordinary shape of a
 * mediasoup or SFU uplink — receives only consent responses and RTCP arriving in bursts seconds
 * apart, so between two of them its inbound delta is legitimately zero for longer than the
 * threshold, and there is no inbound media for it to be stalling in the first place. If such a path
 * really dies, consent stops and `IceDisconnectedDetector` owns it.
 *
 * The clock is stats time — each qualifying tick adds the transport's own `deltaTime` — so a late or
 * skipped collection still credits the stall with the time it actually lasted. Anything that breaks
 * the condition zeroes the accumulator, and an inferred ICE restart zeroes the inbound-traffic latch
 * too: the new generation has proven nothing yet and must earn the guard again.
 *
 * Issue raised: `ice-transport-stalled`, resolved when inbound traffic resumes, when the path stops
 * being connected, or when the transport goes away. Config: `iceTransportStalledDetector`.
 *
 * Category: Connectivity
 * Layer: 5 — Path continuity
 *
 */
export class IceTransportStalledDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'ice-transport-stalled-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.iceTransportStalledDetector!;
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
			state.stalledForInMs = 0;
			// The new generation has a new path and has proven nothing on it yet.
			state.sawInboundTraffic = false;

			this._resolve(transport.id, 'ice restarted');
		}
		if (usernameFragment !== undefined) state.usernameFragment = usernameFragment;

		const iceState = transport.iceState;
		const pair = transport.getSelectedCandidatePair();

		if ((iceState !== 'connected' && iceState !== 'completed') || !pair || pair.state !== 'succeeded') {
			state.stalledForInMs = 0;

			this._resolve(transport.id, 'ice path is no longer connected');

			return;
		}

		const inboundBytesDelta = pair.deltaBytesReceived;
		const outboundBytesDelta = pair.deltaBytesSent;

		// Half the evidence is no evidence: without both deltas the asymmetry cannot be measured.
		if (inboundBytesDelta === undefined || outboundBytesDelta === undefined) return;

		if (0 < inboundBytesDelta) {
			state.sawInboundTraffic = true;
			state.stalledForInMs = 0;

			this._resolve(transport.id, 'inbound traffic resumed');

			return;
		}

		if (!state.sawInboundTraffic || outboundBytesDelta <= 0) {
			state.stalledForInMs = 0;

			return;
		}

		if (!this._expectsInboundMedia(transport)) {
			state.stalledForInMs = 0;

			return;
		}

		state.stalledForInMs += transport.deltaTime ?? 0;

		if (state.stalledForInMs < this.config.transportStallThresholdInMs) return;
		if (state.raisedAt !== undefined) return;

		state.raisedAt = Date.now();

		this.peerConnection.parent.raiseIssue<IceTransportStalledIssuePayload>(
			this._issueKey(transport.id),
			{
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					transportId: transport.id,
					iceState,
					candidatePairState: pair.state,
					selectedCandidatePairId: transport.selectedCandidatePairId,
					direction: 'inbound',
					stalledForMs: state.stalledForInMs,
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
	 * Whether inbound media is expected on this transport at all: at least one inbound RTP stream is
	 * attributed to it. Without one there is nothing for an inbound stall to be about.
	 */
	private _expectsInboundMedia(transport: IceTransportMonitor): boolean {
		return 0 < transport.getInboundRtps().length;
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
				sawInboundTraffic: false,
				stalledForInMs: 0,
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

		clientMonitor.resolveIssue<IceTransportStalledIssuePayload>(key, {
			comment,
			payload: {
				...(issue.payload as IceTransportStalledIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
