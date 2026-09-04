import type { IcePathKind } from "../monitors/IceCandidatePairMonitor";
// Type-only: the monitor imports this detector, so a value import would close that
// cycle at runtime.
import type { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import type { Detector } from "./Detector";

export type BlockedOutboundMediaIssuePayload = {
	peerConnectionId: string;
	/**
	 * The path kind of the connection's selected pair — `direct`, `turn-udp`,
	 * `turn-tcp`, `turn-tls` or `turn-unknown`. With BUNDLE there is one, which is
	 * the ordinary case; without it, the first selected pair is reported.
	 */
	pathKind?: IcePathKind;
	/** How long no receiver report had come back when the issue was raised, in stats time. */
	blockedForMs: number;
	/** Packets our senders put on the wire during that window, none of them ever acknowledged. */
	packetsSent: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'blocked-outbound-media-transport';

export type BlockedOutboundMediaDetectorConfig = {
	/**
	 * How long our senders may put packets on a path that STUN says is fine with no
	 * receiver report coming back, in milliseconds of stats time, before the issue is
	 * raised. It has to comfortably outlast one RTCP reporting interval — receiver
	 * reports arrive every few seconds, and browsers space them out further on low
	 * bitrates — or an ordinary quiet gap between reports reads as a block.
	 */
	thresholdInMs: number;
}

/**
 * Our media leaves and nothing ever comes back about it: senders keep putting packets on a path
 * whose STUN keeps being answered, and no receiver report arrives for `thresholdInMs`.
 *
 * This is the selective block in the send direction — a middlebox that passes the small,
 * well-known STUN packets and drops RTP. A *total* block takes STUN with it, and
 * `BlockedStunRequestsDetector` owns that; this detector stands down while
 * `PeerConnectionMonitor.blockedTransport` is set, since a path that answers nothing carries
 * nothing and the finding belongs there.
 *
 * **The evidence is the far end's silence, not the far end's numbers.** The obvious test —
 * `remote-inbound-rtp` reporting zero packets received — cannot be observed in practice.
 * `rtcp-mux` is on for every WebRTC connection worth monitoring, so RTCP shares the RTP
 * five-tuple: whatever drops our media drops the reports about our media with it. What a blocked
 * sender actually sees is the receiver reports stopping, or never starting at all. Testing the
 * counter instead would be the same class of mistake as gating on media having flowed before — a
 * condition that switches the detector off in exactly the case it exists for.
 *
 * That makes the reading a three-way one, and the monitors carry it: `remote-inbound-rtp` advances
 * only when a report arrives, so its `deltaTime` is positive on a collection where the far end just
 * spoke, `0` where `getStats()` served the same frozen report again, and `undefined` before a
 * second report has ever been seen. Only a positive value clears the window. A sender whose report
 * has never appeared counts as silent rather than unreadable — a path blocked from its first packet
 * never produces one, and that is the case worth catching.
 *
 * **Only senders that are actually sending are considered.** A sender idle this interval says
 * nothing about the path, and its missing report is not evidence; nor does its report, arriving or
 * not, vouch for the senders that are sending.
 *
 * STUN must have answered at least once during the window, on any of the connection's selected
 * pairs — otherwise this is the path going away rather than a media block, and the ICE detectors
 * own it. "During the window" rather than "this tick": consent runs every 4–6 s against a shorter
 * collecting period, so most ticks carry no response at all.
 *
 * Every clock is the connection's own `deltaTime`, never wall clock: a saturated main thread delays
 * collections, and that delay must not be counted as time the far end spent silent.
 *
 * One instance judges one peer connection. Media flow is a property of the connection rather than
 * of a transport: the far end's reports are per stream, the streams are the connection's, and under
 * BUNDLE every one of them rides the same transport anyway.
 *
 * `inputsUnavailable` is set only where the browser reports no send counters of our own, so we
 * cannot even establish that we are sending. The far end's silence is a finding, never a blindness.
 *
 * Category: Transport Quality
 * Layer: Delivery reliability
 *
 */
export class BlockedOutboundMediaDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'blocked-outbound-media-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	/** Stats time no receiver report has come back, or `undefined` while they arrive. */
	private _blockedForInMs?: number;
	/** Packets we put on the wire during that window. */
	private _packetsSent = 0;
	/** Whether STUN answered at any point during the window. */
	private _stunAnswered = false;
	/** Wall clock, and only for the resolved issue's `durationInMs`. */
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.blockedOutboundMediaDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const pairs = this.peerConnection.selectedIceCandidatePairs.filter((pair) => pair.state === 'succeeded');
		const deltaTime = this.peerConnection.deltaTime ?? 0;

		this.inputsUnavailable = false;

		if (pairs.length === 0) {
			return this._blockedForInMs !== undefined ? this._clear('ice has not verified any path') : undefined;
		}

		// A path that has stopped answering STUN is not carrying anything, and the reason
		// is the path rather than the media.
		if (this.peerConnection.blockedTransport) {
			return this._blockedForInMs !== undefined ? this._clear('the transport is blocked') : undefined;
		}

		let packetsSent = 0;
		let sendersReporting = false;
		let reportArrived = false;

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			if (outboundRtp.deltaPacketsSent !== undefined) sendersReporting = true;

			const sent = outboundRtp.deltaPacketsSent ?? 0;

			// An idle sender is not evidence either way, and neither is its report.
			if (sent < 1) continue;

			packetsSent += sent;

			// A report that just arrived, rather than the last one served again: the
			// entry's own clock is what separates the two.
			if (0 < (outboundRtp.getRemoteInboundRtp()?.deltaTime ?? 0)) reportArrived = true;
		}

		// Not one sender exposes a packet count, so we cannot establish that we are
		// sending at all. That is blindness, not a verdict.
		if (!sendersReporting) {
			this.inputsUnavailable = true;

			return this._blockedForInMs !== undefined ? this._clear('our own send counters are not reported') : undefined;
		}

		// Nothing going out is nothing to judge — a receive-only connection, or senders
		// that are paused. Not applicable, so the flag stays false.
		if (packetsSent < 1) {
			return this._blockedForInMs !== undefined ? this._clear('no media is going out') : undefined;
		}

		if (reportArrived) {
			return this._blockedForInMs !== undefined ? this._clear('the far end is reporting again') : undefined;
		}

		this._blockedForInMs = (this._blockedForInMs ?? 0) + deltaTime;
		this._packetsSent += packetsSent;
		this._stunAnswered = this._stunAnswered || pairs.some((pair) => 0 < (pair.deltaResponsesReceived ?? 0));

		if (!this._stunAnswered) return;
		if (this._blockedForInMs < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		this._raisedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;
		const payload: BlockedOutboundMediaIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			pathKind: pairs[0]?.pathKind,
			blockedForMs: this._blockedForInMs,
			packetsSent: this._packetsSent,
		};

		clientMonitor.emit('blocked-outbound-media-transport', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<BlockedOutboundMediaIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	/**
	 * Ends the window, resolving the issue if one was raised. Every call site tests
	 * `_blockedForInMs` first: most ticks on a healthy connection have no window open,
	 * and there is nothing to end.
	 */
	private _clear(comment: string) {
		this._blockedForInMs = undefined;
		this._packetsSent = 0;
		this._stunAnswered = false;

		if (this._raisedAt === undefined) return;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		if (issue) {
			clientMonitor.resolveIssue(this._issueKey, {
				comment,
				payload: { ...issue.payload, durationInMs: Date.now() - this._raisedAt },
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}

	private get _issueKey() {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}`;
	}
}
