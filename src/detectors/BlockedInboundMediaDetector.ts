import type { IcePathKind } from "../monitors/IceCandidatePairMonitor";
// Type-only: the monitor imports this detector, so a value import would close the cycle at runtime.
import type { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import type { Detector } from "./Detector";

export type BlockedInboundMediaIssuePayload = {
	peerConnectionId: string;
	/** The selected pair's path kind. Without BUNDLE, the first selected pair is reported. */
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
	 * How long the far end may claim to send while nothing arrives, in ms of stats time. Must outlast
	 * one RTCP reporting interval, or a quiet gap between reports reads as a block.
	 */
	thresholdInMs: number;
}

/**
 * The far end's media never reaches us while it is still telling us it sends: sender reports keep
 * arriving with a rising packet count, and our receivers take nothing off the wire. Use it to prove
 * an inbound block outright, rather than inferring one from a dry track.
 *
 * A finding means something on the path is discarding the far end's media specifically — a
 * middlebox or firewall passing signalling and dropping RTP — rather than the far end having
 * stopped. It is the strongest inbound evidence available, because the sender is still testifying.
 *
 * It is the one detector not registered unless you ask for it, because it only fires where RTCP
 * survives what killed the media. With `rtcp-mux` — which browsers now require — the far end's
 * sender reports die with its media, leaving the reading indistinguishable from a paused peer.
 * Setting `blockedInboundMediaDetector` opts in for endpoints where RTCP rides its own path.
 *
 * A claim counts only on the collection it arrives in: `getStats()` keeps serving the last
 * `remote-outbound-rtp` in between, so a positive `deltaTime` is what separates a live claim from a
 * frozen one still testifying for a sender that stopped. Quiet collections are expected, so the
 * window needs only some live claim across it. Every clock is the connection's own `deltaTime`.
 *
 * It stands down while `blockedTransport` is set, counts only streams with a linked remote report,
 * and sets `inputsUnavailable` where inbound streams carry no remote report at all.
 *
 * Issue raised: `blocked-inbound-media-transport`. Monitor event:
 * `blocked-inbound-media-transport`. Config: `blockedInboundMediaDetector` — unset leaves the
 * detector unregistered.
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

		// A path that answers no STUN carries nothing: the fault is the path, not the media.
		if (this.peerConnection.blockedTransport) {
			return this._blockedForInMs !== undefined ? this._clear('the transport is blocked') : undefined;
		}

		// Nothing negotiated to receive is nothing to judge — a send-only connection.
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

		// A live report claiming nothing agrees with our silence: a paused producer, not a block.
		if (claimArrived && remotePacketsSent < 1) {
			return this._blockedForInMs !== undefined ? this._clear('the far end is not sending') : undefined;
		}

		this._blockedForInMs = (this._blockedForInMs ?? 0) + deltaTime;
		this._remotePacketsSent += remotePacketsSent;

		// No live claim across the window, so nothing arriving proves nothing.
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

		this.peerConnection.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	/** Ends the window, resolving any raised issue. Call sites test `_blockedForInMs` first. */
	private _clear(comment: string) {
		this._blockedForInMs = undefined;
		this._remotePacketsSent = 0;

		if (this._raisedAt === undefined) return;

		const issue = this.peerConnection.issues.get(this._issueKey);

		if (issue) {
			this.peerConnection.issues.resolve({
				key: this._issueKey,
				comment,
				payload: { ...issue.payload, durationInMs: Date.now() - this._raisedAt } as BlockedInboundMediaIssuePayload,
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}

	private get _issueKey() {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}`;
	}
}
