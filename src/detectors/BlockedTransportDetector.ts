import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { IcePathKind } from "../monitors/IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { attributeRtpToTransport } from "../utils/common";
import { Detector } from "./Detector";

/**
 * What was observed that makes a firewall the best available explanation.
 *
 * - `media-not-leaving-transport`: the RTP senders are producing bytes, but the ICE transport's
 *   own send counter barely moves — packets never make it onto the wire (host firewall, blocked
 *   socket, or the OS dropping on send).
 * - `no-return-traffic`: media leaves at full rate and STUN keeps answering, but nothing except
 *   STUN ever comes back, not even RTCP receiver reports. A middlebox is passing the small,
 *   well-known STUN packets and eating everything else (classic DPI / UDP-throttling firewall).
 */
export type BlockedTransportEvidence = 'media-not-leaving-transport' | 'no-return-traffic';

export type BlockedTransportIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	/** Which discrepancy was observed. See `BlockedTransportEvidence`. */
	evidence: BlockedTransportEvidence;
	/** `direct`, `turn-udp`, `turn-tcp`, `turn-tls` or `turn-unknown`. */
	pathKind?: IcePathKind;
	/** How long the discrepancy had already persisted when the issue was raised. */
	blockedForMs: number;
	/** Combined bitrate of the outbound RTP streams attributed to this transport, in bps. */
	outboundMediaBitrate: number;
	/** What the ICE transport reports actually going out on the wire, in bps. */
	transportSendingBitrate?: number;
	/** What the ICE transport reports coming back — STUN included — in bps. */
	transportReceivingBitrate?: number;
	/** STUN responses received on the selected pair during the last interval. */
	stunResponsesReceivedDelta?: number;
	/** Latest STUN round trip on the selected pair, in seconds. */
	currentRoundTripTime?: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

type TransportState = {
	lastStunResponseAt?: number;
	discrepancySince?: number;
	evidence?: BlockedTransportEvidence;
	raisedAt?: number;
};

const ISSUE_TYPE = 'blocked-transport';

/**
 * Detects the signature of a firewall — or any policy middlebox — that lets ICE and STUN through
 * while blocking the media itself: the candidate pair is `succeeded`, consent checks keep
 * passing, `iceConnectionState` reads `connected`, and the call carries nothing.
 *
 * No other detector can see this. STUN consent responses count into the candidate pair's
 * `bytesReceived`, so the pair never looks dry and `IceConnectivityDetector`'s inbound-stall
 * check never fires; the dry-track detectors watch producer-side `outbound-rtp` counters, which
 * keep advancing because the encoder is doing its job perfectly well. The gap between "STUN says
 * the path is alive" and "no media traverses it" is precisely the firewall signature.
 *
 * Three things must hold together each tick on a transport's selected pair. STUN must be alive
 * (`responsesReceived` advanced within `stunFreshnessInMs`), or this is ordinary connectivity
 * loss and the ICE detectors own it. The application must be producing (`minMediaBitrateBps` of
 * outbound RTP attributed to the transport), or a quiet transport is indistinguishable from an
 * idle one. And the media must not be traversing: the transport's send counter moving at under
 * `maxSendShare` of what the senders produce, or under `maxReturnBitrateBps` coming back, not
 * even RTCP. All three holding for `thresholdInMs` raises the issue; any leg breaking resolves it.
 *
 * The judgement is one-sided by construction: only on the sending side does the client hold both
 * halves of the proof, producing the bytes and reading the transport counters. A block in the
 * receive direction surfaces on the remote peer's own detector, or here as a dry inbound track.
 *
 * Raises `blocked-transport`. Emits `blocked-transport`. Config: `blockedTransportDetector`.
 */
export class BlockedTransportDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'blocked-transport-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.blockedTransportDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const seenIds = new Set<string>();

		for (const transport of this.peerConnection.iceTransports) {
			seenIds.add(transport.id);
			this._checkTransport(transport);
		}

		for (const id of [ ...this._states.keys() ]) {
			if (seenIds.has(id)) continue;

			this._resolve(id, 'ice transport is gone');
			this._states.delete(id);
		}
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const state = this._getState(transport.id);
		const now = Date.now();
		const pair = transport.getSelectedCandidatePair();
		const iceState = transport.iceState;

		if ((iceState !== 'connected' && iceState !== 'completed') || !pair || pair.state !== 'succeeded') {
			this._clearDiscrepancy(transport.id, state, 'ice connection is no longer verified');
			return;
		}

		if (0 < (pair.deltaResponsesReceived ?? 0)) {
			state.lastStunResponseAt = now;
		}

		const stunFresh = state.lastStunResponseAt !== undefined
			&& now - state.lastStunResponseAt <= this.config.stunFreshnessInMs;

		if (!stunFresh) {
			// no recent proof the path answers: ordinary connectivity trouble, which the ICE detectors own
			this._clearDiscrepancy(transport.id, state, 'stun is no longer confirming the path');
			return;
		}

		const outboundMediaBitrate = this._outboundMediaBitrateOf(transport);

		if (outboundMediaBitrate < this.config.minMediaBitrateBps) {
			this._clearDiscrepancy(transport.id, state, 'no significant media is being produced');
			return;
		}

		const elapsedInSec = Math.max(0.001, this.peerConnection.parent.config.collectingPeriodInMs / 1000);
		const sendingBitrate = transport.sendingBitrate
			?? (pair.deltaBytesSent !== undefined ? (pair.deltaBytesSent * 8) / elapsedInSec : undefined);
		const receivingBitrate = transport.receivingBitrate
			?? (pair.deltaBytesReceived !== undefined ? (pair.deltaBytesReceived * 8) / elapsedInSec : undefined);

		let evidence: BlockedTransportEvidence | undefined;

		if (sendingBitrate !== undefined && sendingBitrate < outboundMediaBitrate * this.config.maxSendShare) {
			evidence = 'media-not-leaving-transport';
		} else if (receivingBitrate !== undefined && receivingBitrate <= this.config.maxReturnBitrateBps) {
			evidence = 'no-return-traffic';
		}

		if (evidence === undefined) {
			this._clearDiscrepancy(transport.id, state, 'media is traversing the transport again');
			return;
		}

		if (state.discrepancySince === undefined) {
			state.discrepancySince = now;
			state.evidence = evidence;
		}

		const blockedForMs = now - state.discrepancySince;

		if (blockedForMs < this.config.thresholdInMs) return;
		if (state.raisedAt !== undefined) return;

		state.raisedAt = now;

		const clientMonitor = this.peerConnection.parent;
		const payload: BlockedTransportIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: transport.id,
			evidence: state.evidence ?? evidence,
			pathKind: pair.pathKind,
			blockedForMs,
			outboundMediaBitrate,
			transportSendingBitrate: sendingBitrate,
			transportReceivingBitrate: receivingBitrate,
			stunResponsesReceivedDelta: pair.deltaResponsesReceived,
			currentRoundTripTime: pair.currentRoundTripTime,
		};

		clientMonitor.emit('blocked-transport', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<BlockedTransportIssuePayload>(
			this._issueKey(transport.id),
			{
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload,
			}
		);
	}

	private _outboundMediaBitrateOf(transport: IceTransportMonitor): number {
		const relevant = attributeRtpToTransport(
			this.peerConnection.outboundRtps, transport.id, this.peerConnection.iceTransports.length,
		);

		return relevant.reduce((acc, outboundRtp) => acc + (outboundRtp.bitrate ?? 0), 0);
	}

	private _getState(transportId: string): TransportState {
		let state = this._states.get(transportId);

		if (!state) {
			state = {};
			this._states.set(transportId, state);
		}

		return state;
	}

	private _clearDiscrepancy(transportId: string, state: TransportState, comment: string) {
		state.discrepancySince = undefined;
		state.evidence = undefined;

		if (state.raisedAt === undefined) return;

		this._resolve(transportId, comment);
	}

	private _resolve(transportId: string, comment: string) {
		const state = this._states.get(transportId);
		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(transportId);
		const issue = clientMonitor.activeIssues.get(key);

		if (issue) {
			clientMonitor.resolveIssue(key, {
				comment,
				payload: {
					...issue.payload,
					durationInMs: state?.raisedAt !== undefined ? Date.now() - state.raisedAt : undefined,
				},
				resolvedAt: Date.now(),
			});
		}

		if (state) state.raisedAt = undefined;
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
