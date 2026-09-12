import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** What the transport says arrived against how much of it reached an inbound RTP stream — zero, which is the finding. */
export type TransportDemuxStalledIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	demuxedBytesDelta?: number;
	transportReceivingBitrate?: number;
	stalledForMs: number;
	durationInMs?: number;
};

type DemuxState = {
	/** Stats time the boundary has been broken for; `undefined` while it is not broken. */
	stalledForMs?: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'transport-demux-stalled';

export type TransportDemuxStalledDetectorConfig = {
	/** How long the broken boundary must persist before raising, in ms. */
	thresholdInMs: number;

	/** Receive bitrate (bps) above which arriving traffic counts as media — set well above RTCP plus STUN. */
	minTransportReceiveBitrateBps: number;
}

/**
 * Reports media arriving on an ICE transport that never reaches any inbound RTP stream — the
 * transport counters climb while every stream attributed to it stays at zero bytes. Use it to
 * explain a tile that never appears while the call otherwise looks healthy: an SSRC mismatch after
 * renegotiation, or a consumer created against a producer that is already gone.
 *
 * `minTransportReceiveBitrateBps` rules out RTCP and STUN explaining the arriving bytes, and a
 * transport with no inbound RTP attributed to it is not judged at all, since a send-only transport
 * has nothing to demux into by design. The stall clock is stats time, kept per transport id, and a
 * transport that disappears resolves its issue.
 *
 * Where the browser reports no transport receiving bitrate it sets `inputsUnavailable` rather than
 * reading as healthy — with no evidence bytes arrived, the boundary is never called broken.
 *
 * Issue raised: `transport-demux-stalled`. Monitor event: `transport-demux-stalled`.
 * Config: `transportDemuxStalledDetector`.
 * Connection attribute: `PeerConnectionMonitor.stalledTransportDemux`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — transport to RTP streams
 *
 */
export class TransportDemuxStalledDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'transport-demux-stalled-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly _states = new Map<string, DemuxState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.transportDemuxStalledDetector!;
	}

	public update(): void {
		if (this.disabled) {
			this.peerConnection.stalledTransportDemux = undefined;

			return;
		}
		if (this.peerConnection.closed) {
			this.peerConnection.stalledTransportDemux = undefined;

			return;
		}

		const seenTransports = new Set<string>();
		// A transport with no inbound RTP has no demux expectation to violate, so it neither
		// proves nor disproves anything; the flag needs at least one that does.
		let anyJudged = false;
		// One unjudgeable transport makes this tick's silence unusable as evidence of health.
		let inputsUnavailable = false;

		for (const transport of this.peerConnection.iceTransports) {
			seenTransports.add(transport.id);

			const state = this._getState(transport.id);
			const inboundRtps = transport.getInboundRtps();
			const receivingBitrate = transport.receivingBitrate;
			let demuxedBytesDelta: number | undefined;

			for (const inboundRtp of inboundRtps) {
				if (inboundRtp.deltaBytesReceived === undefined) continue;
				demuxedBytesDelta = (demuxedBytesDelta ?? 0) + inboundRtp.deltaBytesReceived;
			}

			// Nothing demuxed and no word on whether anything arrived — unanswerable this tick.
			if (0 < inboundRtps.length && demuxedBytesDelta === 0 && receivingBitrate === undefined) {
				inputsUnavailable = true;
			}

			// No inbound RTP means no demux expectation to violate; the floor rules out RTCP and STUN.
			if (0 < inboundRtps.length && receivingBitrate !== undefined) anyJudged = true;

			const broken = 0 < inboundRtps.length
				&& demuxedBytesDelta === 0
				&& receivingBitrate !== undefined
				&& this.config.minTransportReceiveBitrateBps <= receivingBitrate;

			if (!broken) {
				this._clear(transport.id, 'inbound rtp is receiving again');
				continue;
			}

			if (state.stalledForMs === undefined) {
				state.stalledForMs = 0;
			} else {
				// Stats time: only observed intervals count towards the threshold.
				state.stalledForMs += transport.deltaTime ?? 0;
			}

			if (state.stalledForMs < this.config.thresholdInMs) continue;
			if (state.raisedAt !== undefined) continue;

			state.raisedAt = Date.now();

			const clientMonitor = this.peerConnection.parent;
			const payload: TransportDemuxStalledIssuePayload = {
				peerConnectionId: this.peerConnection.peerConnectionId,
				transportId: transport.id,
				demuxedBytesDelta,
				transportReceivingBitrate: receivingBitrate,
				stalledForMs: state.stalledForMs,
			};

			clientMonitor.emit('transport-demux-stalled', {
				clientMonitor,
				peerConnectionMonitor: this.peerConnection,
				...payload,
			});

			this.peerConnection.issues.raise({
				key: this._issueKey(transport.id),
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload,
			});
		}

		this.inputsUnavailable = inputsUnavailable;

		for (const transportId of [ ...this._states.keys() ]) {
			if (seenTransports.has(transportId)) continue;

			this._clear(transportId, 'ice transport is gone');
			this._states.delete(transportId);
		}

		const anyStalled = [ ...this._states.values() ].some((state) => state.raisedAt !== undefined);

		this.peerConnection.stalledTransportDemux = anyStalled
			? true
			: anyJudged && !inputsUnavailable ? false : undefined;
	}

	private _getState(transportId: string): DemuxState {
		let state = this._states.get(transportId);

		if (!state) {
			state = {};
			this._states.set(transportId, state);
		}

		return state;
	}

	private _clear(transportId: string, comment: string) {
		const state = this._states.get(transportId);

		if (!state) return;

		state.stalledForMs = undefined;

		if (state.raisedAt === undefined) return;

		const key = this._issueKey(transportId);
		const issue = this.peerConnection.issues.get(key);

		if (issue) {
			this.peerConnection.issues.resolve({
				key: key,
				comment,
				payload: {
					...issue.payload,
					durationInMs: Date.now() - state.raisedAt,
				} as TransportDemuxStalledIssuePayload,
				resolvedAt: Date.now(),
			});
		}

		state.raisedAt = undefined;
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
