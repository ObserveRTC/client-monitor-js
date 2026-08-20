import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { IcePathKind } from "../monitors/IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * What the detector observed that makes a firewall the best explanation.
 *
 * - `media-not-leaving-transport`: outbound RTP is producing bytes, but the
 *   ICE transport's own send counter barely moves — packets are produced by
 *   the RTP senders and never make it onto the wire (host firewall, blocked
 *   socket, or the OS dropping on send).
 * - `no-return-traffic`: media leaves at full rate and STUN keeps answering,
 *   but nothing except STUN ever comes back — not even RTCP receiver
 *   reports. A middlebox is passing the small, well-known STUN packets and
 *   eating everything else (classic DPI / UDP-throttling firewall).
 */
export type BlockedTransportEvidence = 'media-not-leaving-transport' | 'no-return-traffic';

export type BlockedTransportIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	/** Which discrepancy was observed. See `BlockedTransportEvidence`. */
	evidence: BlockedTransportEvidence;
	/** `direct`, `turn-udp`, `turn-tcp`, `turn-tls` or `turn-unknown`. */
	pathKind?: IcePathKind;
	/** How long the discrepancy had persisted when the issue was raised. */
	blockedForMs: number;
	/** Combined bitrate of the outbound RTP streams on this transport (bps). */
	outboundMediaBitrate: number;
	/** What the ICE transport reports actually going out on the wire (bps). */
	transportSendingBitrate?: number;
	/** What the ICE transport reports coming back — STUN included (bps). */
	transportReceivingBitrate?: number;
	/** STUN responses received on the selected pair in the last interval. */
	stunResponsesReceivedDelta?: number;
	/** Latest STUN round trip on the selected pair, in seconds. */
	currentRoundTripTime?: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

type TransportState = {
	/** Last time a STUN binding/consent response arrived on the selected pair. */
	lastStunResponseAt?: number;
	/** When the STUN-ok-but-media-blocked discrepancy was first observed. */
	discrepancySince?: number;
	/** The evidence observed when the discrepancy started. */
	evidence?: BlockedTransportEvidence;
	/** Set when the issue has been raised; timestamp of the raise. */
	raisedAt?: number;
};

const ISSUE_TYPE = 'blocked-transport';

/**
 * Blocked Transport Detector
 *
 * Detects the signature of a firewall (or any policy middlebox) that lets
 * ICE/STUN through but blocks the media itself. This is the failure mode
 * where every connectivity signal looks healthy — the candidate pair is
 * `succeeded`, consent checks keep passing, `iceConnectionState` is
 * `connected` — yet the call carries nothing.
 *
 * **Why the existing detectors miss it.** STUN consent responses count into
 * the candidate pair's `bytesReceived`, so the pair never looks "dry" and
 * `IceConnectivityDetector`'s inbound-stall check (which requires
 * `deltaBytesReceived === 0`) never fires. The dry-track detectors see the
 * producer-side `outbound-rtp` counters advancing, so they stay silent too.
 * The gap between "STUN says the path is alive" and "no media traverses it"
 * belongs to no existing detector — it is exactly the firewall signature.
 *
 * **What it requires, every tick, on the selected pair of a transport:**
 *
 * 1. *STUN is demonstrably alive.* `responsesReceived` advanced within
 *    `stunFreshnessInMs`. Without this the situation is an ordinary
 *    connectivity loss and the ICE detectors own it.
 * 2. *The application is demonstrably producing.* The outbound RTP streams
 *    on this transport are generating at least `minMediaBitrateBps`
 *    combined. Without this a quiet transport is indistinguishable from a
 *    paused or idle one.
 * 3. *The media is demonstrably not traversing.* Either of:
 *    - the transport's send counter moves at less than `maxSendShare` of
 *      what the RTP senders produce (`media-not-leaving-transport`), or
 *    - the transport receives less than `maxReturnBitrateBps` — i.e.
 *      nothing beyond STUN, not even RTCP, is coming back
 *      (`no-return-traffic`).
 *
 * When all three hold for `thresholdInMs`, a `blocked-transport`
 * issue is raised. It resolves as soon as any leg of the evidence breaks:
 * media starts flowing, production stops, or STUN dies (at which point the
 * ICE connectivity detectors take over).
 *
 * **Scope.** The detector judges the *sending* side, because only there does
 * the client hold both halves of the proof (it produces the bytes and it
 * sees the transport counters). A firewall blocking only the receive
 * direction shows up on the remote peer's sending-side detector, or as a
 * dry inbound track here.
 *
 * **Issues created:** `blocked-transport`.
 * **Events emitted:** `blocked-transport` (monitor event).
 *
 * @example
 * ```typescript
 * const config = {
 *   blockedTransportDetector: {
 *     thresholdInMs: 5000,
 *     minMediaBitrateBps: 10_000,
 *     maxReturnBitrateBps: 2_000,
 *     maxSendShare: 0.1,
 *     stunFreshnessInMs: 10_000,
 *   }
 * };
 *
 * monitor.on('issue', (issue) => {
 *   if (issue.type === 'blocked-transport') {
 *     console.warn('firewall suspected', issue.payload);
 *   }
 * });
 * ```
 */
export class BlockedTransportDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	/** Unique identifier for this detector type */
	public readonly name = 'blocked-transport-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<string, TransportState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	/** Gets the detector configuration from the client monitor */
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

		// Transports renegotiated away must not leave a dangling issue behind.
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

		// The claim is "the path is up and STUN-verified, yet media does not
		// traverse it" — without a succeeded selected pair on a connected
		// transport there is no such claim to make, and the ICE detectors own
		// whatever is going on instead.
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
			// No recent proof the path answers: this is ordinary connectivity
			// trouble, not the firewall signature.
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

	/**
	 * Combined bitrate of the outbound RTP streams that ride on this
	 * transport. When no outbound RTP carries a `transportId` (some browsers
	 * omit it), every stream of the peer connection is attributed to the
	 * transport — with BUNDLE (always the case for mediasoup) that is exact.
	 */
	private _outboundMediaBitrateOf(transport: IceTransportMonitor): number {
		const outboundRtps = this.peerConnection.outboundRtps;
		const attributed = outboundRtps.filter((outboundRtp) => outboundRtp.transportId === transport.id);
		const relevant = 0 < attributed.length
			? attributed
			: outboundRtps.filter((outboundRtp) => outboundRtp.transportId === undefined);

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
