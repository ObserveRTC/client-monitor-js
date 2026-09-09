import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export type IceTransportStalledIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	iceState?: string;
	candidatePairState?: string;
	selectedCandidatePairId?: string;
	/** Inbound only — the both-directions-silent case is not reportable. */
	direction: 'inbound';
	stalledForMs: number;
	/** What was still going out while `inboundBytesDelta` stayed at zero. */
	outboundBytesDelta?: number;
	inboundBytesDelta?: number;
	currentRoundTripTime?: number;
	lastPacketReceivedTimestamp?: number;
	iceGeneration: number;
	/** Filled in when the finding closes. */
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
	/** How long a connected transport may send without receiving anything before a stall is reported. */
	transportStallThresholdInMs: number;
}

/**
 * Reports the quiet failure every state machine misses: ICE `connected`, the selected pair
 * `succeeded`, no error anywhere, while the transport keeps sending and nothing comes back. Use it
 * to catch a dead path that still looks healthy — the only evidence is the asymmetry between what
 * leaves and what arrives.
 *
 * Our own outbound traffic makes the expectation defensible: a live path returns at least consent
 * responses and RTCP. Two guards keep it off paths where receiving nothing is healthy — inbound
 * traffic must have been seen here before, and inbound RTP must be attributed to this transport, so
 * a send-only SFU uplink with its seconds-apart consent bursts is never accused. The clock is stats
 * time; anything breaking the condition zeroes it, and an ICE restart also clears the
 * inbound-traffic latch, since the new generation has proven nothing yet.
 *
 * Silence in both directions is deliberately not reportable — it cannot be told apart from an idle
 * connection.
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

		this.peerConnection.issues.raise({
				key: this._issueKey(transport.id),
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

	/** Without an inbound RTP stream attributed here there is nothing for a stall to be about. */
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

		const key = this._issueKey(transportId);
		const issue = this.peerConnection.issues.get(key);

		if (!issue) return;

		this.peerConnection.issues.resolve({
			key: key,
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
