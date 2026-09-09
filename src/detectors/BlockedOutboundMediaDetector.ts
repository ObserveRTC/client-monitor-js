import type { IcePathKind } from "../monitors/IceCandidatePairMonitor";
// Type-only: the monitor imports this detector, so a value import would close the cycle at runtime.
import type { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import type { Detector } from "./Detector";

export type BlockedOutboundMediaIssuePayload = {
	peerConnectionId: string;
	/** The selected pair's path kind. Without BUNDLE, the first selected pair is reported. */
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
	 * How long senders may put packets on a STUN-answering path with no receiver report, in ms of
	 * stats time. Must outlast one RTCP reporting interval, or an ordinary quiet gap reads as a block.
	 */
	thresholdInMs: number;
}

/**
 * Our media leaves and nothing ever comes back about it: senders keep putting packets on a path
 * whose STUN keeps being answered, and no receiver report arrives for `thresholdInMs`. Use it to
 * name the selective block in the send direction — a middlebox that passes STUN and drops RTP —
 * as against a total block, which takes STUN with it and belongs to `BlockedStunRequestsDetector`.
 *
 * The evidence is the far end's silence rather than its numbers: with `rtcp-mux`, whatever drops
 * our media drops the reports about it, so a zero packet count is never observed. `remote-inbound-rtp`
 * carries the three-way reading — a positive `deltaTime` means a report just arrived, `0` a frozen
 * one served again, `undefined` that none ever came — and only the first clears the window. Idle
 * senders are not evidence, STUN must have answered somewhere in the window, and every clock is the
 * connection's own `deltaTime` so a delayed collection is not counted as far-end silence.
 *
 * `inputsUnavailable` is set only where our own send counters are missing: silence is a finding.
 *
 * Issue raised: `blocked-outbound-media-transport`. Monitor event:
 * `blocked-outbound-media-transport`. Config: `blockedOutboundMediaDetector`.
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

		// A path that answers no STUN carries nothing: the fault is the path, not the media.
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

			// A report that just arrived, not the last one served again: only its own clock says which.
			if (0 < (outboundRtp.getRemoteInboundRtp()?.deltaTime ?? 0)) reportArrived = true;
		}

		// Nothing exposes a packet count, so we cannot establish we are sending. Blind, not a verdict.
		if (!sendersReporting) {
			this.inputsUnavailable = true;

			return this._blockedForInMs !== undefined ? this._clear('our own send counters are not reported') : undefined;
		}

		// Nothing going out is nothing to judge — receive-only, or paused senders.
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
		this._packetsSent = 0;
		this._stunAnswered = false;

		if (this._raisedAt === undefined) return;

		const issue = this.peerConnection.issues.get(this._issueKey);

		if (issue) {
			this.peerConnection.issues.resolve({
				key: this._issueKey,
				comment,
				payload: { ...issue.payload, durationInMs: Date.now() - this._raisedAt } as BlockedOutboundMediaIssuePayload,
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}

	private get _issueKey() {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}`;
	}
}
