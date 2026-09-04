import type { IcePathKind } from "../monitors/IceCandidatePairMonitor";
// Type-only: the monitor imports this detector, so a value import would close that
// cycle at runtime.
import type { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import type { Detector } from "./Detector";

export type BlockedInboundMediaIssuePayload = {
	peerConnectionId: string;
	/**
	 * The path kind of the connection's selected pair — `direct`, `turn-udp`,
	 * `turn-tcp`, `turn-tls` or `turn-unknown`. With BUNDLE there is one, which is
	 * the ordinary case; without it, the first selected pair is reported.
	 */
	pathKind?: IcePathKind;
	/** How long the far end's media had been failing to arrive when the issue was raised, in stats time. */
	blockedForMs: number;
	/** Packets the far end reported sending during that window, in reports that actually arrived. */
	remotePacketsSent: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'blocked-inbound-media-transport';

export type BlockedInboundMediaDetectorConfig = {
	/**
	 * How long the far end may keep reporting that it sends while nothing reaches our
	 * receivers, in milliseconds of stats time, before the issue is raised. It has to
	 * outlast one RTCP reporting interval — sender reports arrive every few seconds —
	 * or a quiet gap between reports reads as a block.
	 */
	thresholdInMs: number;
}

/**
 * The far end's media never reaches us while it is still telling us it sends: sender reports keep
 * arriving with a rising packet count, and our receivers take nothing off the wire.
 *
 * **It is the one detector that is not registered unless you ask for it, and this is why.** It only
 * fires where RTCP survives what killed the media. With `rtcp-mux` RTCP shares the RTP five-tuple,
 * so a middlebox dropping inbound media drops the far end's sender reports with it, and the reading
 * becomes indistinguishable from a peer that simply paused. Browsers leave no way out: Chrome has
 * defaulted `rtcpMuxPolicy` to `"require"` since Chrome 57 and removed `"negotiate"`, and Firefox
 * never allowed the option to be set — so on ordinary browser WebRTC there is nothing here to
 * reach. Setting `blockedInboundMediaDetector` opts in, for the endpoints where RTCP genuinely
 * rides its own path: a non-browser or patched client, an SDP negotiation that leaves `a=rtcp-mux`
 * out, or a middlebox known to pass RTCP while dropping RTP. The finding is unambiguous when it
 * does happen, which is why the class is kept rather than deleted.
 *
 * The receive direction has no other client-side proof: a dry inbound track with no live remote
 * claim is `DryInboundTrackDetector`'s finding, and the send direction — where the client holds
 * both halves of the proof — is `BlockedOutboundMediaDetector`'s.
 *
 * **A claim only counts on the collection it arrives in.** `remote-outbound-rtp` advances only when
 * a sender report arrives and `getStats()` keeps serving the last one in between, so the monitor
 * reports `deltaTime` positive on a collection where the far end just spoke, `0` where the same
 * frozen report came back, and `undefined` before a second report has been seen. Reading the packet
 * delta without that check is how a paused sender's last report keeps testifying that it is still
 * sending — a false positive raised against a peer that stopped talking.
 *
 * Quiet collections are expected either way: sender reports arrive every few seconds against a
 * shorter collecting period. So the window accumulates while nothing arrives and needs only *some*
 * live claim during it, rather than one per tick.
 *
 * Every clock is the connection's own `deltaTime`, never wall clock: a saturated main thread delays
 * collections, and that delay must not be counted as time the media spent missing.
 *
 * It also stands down while `PeerConnectionMonitor.blockedTransport` is set — a path that answers
 * no STUN carries nothing, and `BlockedStunRequestsDetector` owns that finding.
 *
 * One instance judges one peer connection, and counts only streams with a linked remote report:
 * both halves of the comparison have to describe the same streams, or a stream of ours that is
 * receiving fine would vouch for one the far end reports on and we never saw.
 *
 * `inputsUnavailable` is set where the connection has inbound streams and none of them carries a
 * remote report at all — the browser exposes nothing to compare against.
 *
 * Category: Transport Quality
 * Layer: Delivery reliability
 *
 */
export class BlockedInboundMediaDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'blocked-inbound-media-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	/** Stats time the far end's media has been failing to arrive, or `undefined` while it arrives. */
	private _blockedForInMs?: number;
	/** Packets the far end claimed, in reports that actually arrived during that window. */
	private _remotePacketsSent = 0;
	/** Wall clock, and only for the resolved issue's `durationInMs`. */
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.blockedInboundMediaDetector!;
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

		// Nothing negotiated to receive is nothing to judge — a send-only connection.
		// Not applicable, so the flag stays false.
		if (this.peerConnection.inboundRtps.length === 0) {
			return this._blockedForInMs !== undefined ? this._clear('nothing is being received on this connection') : undefined;
		}

		let packetsReceived = 0;
		let remotePacketsSent = 0;
		let reportsExist = false;
		let claimArrived = false;

		for (const inboundRtp of this.peerConnection.inboundRtps) {
			const remote = inboundRtp.getRemoteOutboundRtp();

			if (!remote) continue;

			reportsExist = true;
			packetsReceived += inboundRtp.deltaPacketsReceived ?? 0;

			// Only a report that arrived on this collection says anything about now.
			if ((remote.deltaTime ?? 0) < 1 || remote.deltaPacketsSent === undefined) continue;

			claimArrived = true;
			remotePacketsSent += remote.deltaPacketsSent;
		}

		if (!reportsExist) {
			this.inputsUnavailable = true;

			return this._blockedForInMs !== undefined ? this._clear('the far end reports nothing it sent') : undefined;
		}

		if (0 < packetsReceived) {
			return this._blockedForInMs !== undefined ? this._clear('media is arriving again') : undefined;
		}

		// A live report saying it sent nothing agrees with our silence — a paused
		// producer, not a block. A tick with no report at all decides nothing and lets
		// the window run on.
		if (claimArrived && remotePacketsSent < 1) {
			return this._blockedForInMs !== undefined ? this._clear('the far end is not sending') : undefined;
		}

		this._blockedForInMs = (this._blockedForInMs ?? 0) + deltaTime;
		this._remotePacketsSent += remotePacketsSent;

		// Nothing live has claimed to send during this window, so nothing arriving says
		// nothing. With rtcp-mux this is where a blocked receive path ends up, which is
		// why the finding belongs to the send side and to the dry-track detectors.
		if (this._remotePacketsSent < 1) return;

		if (this._blockedForInMs < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		this._raisedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;
		const payload: BlockedInboundMediaIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			pathKind: pairs[0]?.pathKind,
			blockedForMs: this._blockedForInMs,
			remotePacketsSent: this._remotePacketsSent,
		};

		clientMonitor.emit('blocked-inbound-media-transport', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<BlockedInboundMediaIssuePayload>(this._issueKey, {
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
		this._remotePacketsSent = 0;

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
