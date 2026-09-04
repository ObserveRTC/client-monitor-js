import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * `transportReceivingBitrate` is what the ICE transport says is arriving, and `demuxedBytesDelta` how
 * much of it reached an inbound RTP stream over the interval the issue was raised on — zero, which is
 * the whole finding. `stalledForMs` is how long the boundary had been broken at raise time, measured
 * in stats time.
 */
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
	/**
	 * How long (in milliseconds) the broken stage boundary must persist
	 * before the issue is raised.
	 */
	thresholdInMs: number;

	/**
	 * Transport receive bitrate (bps) at or above which incoming traffic
	 * counts as media that must demux into some inbound RTP — set well
	 * above what RTCP + STUN alone can explain.
	 */
	minTransportReceiveBitrateBps: number;
}

/**
 * Watches one stage boundary on the receive side: bytes arrive on the ICE transport, and the receiver
 * demuxes them into inbound RTP streams. The boundary is broken when the upstream counter advances
 * and the downstream one stays flat — the transport receiving at a media-level rate while every
 * inbound RTP attributed to it reports zero bytes. Packets are arriving that never reach a stream,
 * which is what an SSRC mismatch after renegotiation looks like from inside the browser, or a
 * consumer created against a producer that is already gone. It is a boundary worth naming: everything
 * else about the call looks healthy, the transport counters keep climbing, and the picture is simply
 * never there.
 *
 * Two guards make the verdict honest. `minTransportReceiveBitrateBps` is the floor that rules out
 * RTCP and STUN consent explaining the arriving bytes — a transport receiving a few hundred bps is
 * receiving housekeeping, not media. And without at least one inbound RTP attributed to the
 * transport there is no demux expectation to violate at all: a send-only transport, the ordinary
 * shape of an SFU publish transport, has nothing to demux into by design. A closed peer connection is
 * not judged either.
 *
 * The stall clock accumulates each tick's `deltaTime` from the transport rather than wall-clock
 * elapsed, so only media time actually observed counts towards `thresholdInMs`; a throttled page
 * cannot age a boundary into an issue. State is kept per transport id, and a transport that
 * disappears resolves its issue rather than leaving it open.
 *
 * `inputsUnavailable` covers the one blind spot in that arrangement. The upstream half of the
 * comparison is `transport.receivingBitrate`, which is derived solely from
 * `RTCTransportStats.bytesReceived` — and **Firefox still does not populate it as of 153**. There
 * the detector is permanently and silently inert: it cannot tell an SSRC mismatch from a perfectly
 * demuxing call, because it never learns whether anything arrived. The flag is set on a tick where
 * a transport that has inbound RTP attributed to it demuxed nothing and no receiving bitrate was
 * reported — the tick the detector would otherwise have judged — and cleared otherwise. It changes
 * nothing about the verdict: with no evidence that bytes arrived, the boundary is not called broken.
 *
 * This detector deliberately reads no issue but its own. Its predecessor annotated every payload with
 * the other issues active on the peer connection, which made one detector's output a function of
 * every other detector's verdicts and of the order they ran in; that field is gone, and correlating
 * issues is the server's job, where the whole session is visible.
 *
 * Issue raised: `transport-demux-stalled`. Monitor event: `transport-demux-stalled`.
 * Config: `transportDemuxStalledDetector`.
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
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const seenTransports = new Set<string>();
		// Aggregated over the transports judged this tick: if any one of them went unjudged for
		// want of a receiving bitrate, this tick's silence is not evidence of health.
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

			// Nothing was demuxed and the browser did not say whether anything arrived: the
			// question this detector asks cannot be answered on this transport this tick.
			if (0 < inboundRtps.length && demuxedBytesDelta === 0 && receivingBitrate === undefined) {
				inputsUnavailable = true;
			}

			// The bitrate floor is what rules out RTCP and STUN traffic explaining the arriving bytes; without at
			// least one inbound RTP there is no demux expectation to violate at all.
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
				// stats time, not wall-clock: only intervals actually observed count towards the threshold
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

			clientMonitor.raiseIssue<TransportDemuxStalledIssuePayload>(this._issueKey(transport.id), {
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

		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(transportId);
		const issue = clientMonitor.activeIssues.get(key);

		if (issue) {
			clientMonitor.resolveIssue(key, {
				comment,
				payload: {
					...issue.payload,
					durationInMs: Date.now() - state.raisedAt,
				},
				resolvedAt: Date.now(),
			});
		}

		state.raisedAt = undefined;
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
