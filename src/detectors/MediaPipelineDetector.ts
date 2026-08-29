import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * The pipeline stage boundary found broken.
 *
 * - `rtp-sender` (send side, encoder to RTP sender): frames encode but no packet leaves — a wedged
 *   sender or pacer, seen in the wild after `replaceTrack` races and simulcast reconfigurations.
 * - `transport-demux` (receive side, transport to RTP receiver): the ICE transport keeps receiving
 *   at a rate no RTCP or STUN traffic explains, yet no inbound RTP accounts for any of it — traffic
 *   arrives that never demuxes, after an SSRC mismatch on renegotiation or a consumer created
 *   against a dead producer.
 */
export type MediaPipelineStage = 'rtp-sender' | 'transport-demux';

/**
 * `upstreamDelta` is the progress the stage before the boundary made in the interval the issue was
 * raised on, `downstreamDelta` the progress the stage after it did not make — the flat counter that
 * is the whole finding. `ssrc` and `trackId` are set for `rtp-sender`, `transportId` and
 * `transportReceivingBitrate` for `transport-demux`, and `stalledForMs` is how long the boundary had
 * been broken at raise time.
 */
export type MediaPipelineStalledIssuePayload = {
	peerConnectionId: string;
	direction: 'send' | 'receive';
	stage: MediaPipelineStage;
	ssrc?: number;
	trackId?: string;
	transportId?: string;
	upstreamDelta?: number;
	downstreamDelta?: number;
	transportReceivingBitrate?: number;
	/** Comma-separated types of the specialist issues active at raise time. */
	suspectedIssueTypes: string;
	stalledForMs: number;
	durationInMs?: number;
};

type BoundaryState = {
	brokenSince?: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'media-pipeline-stalled';

/**
 * Media moves through a fixed chain — capture, encoder, RTP sender, transport, wire, mirrored on the
 * receiving side — and every stage carries a monotonic counter that proves it is making progress.
 * That makes a disruption *locatable* rather than merely detectable: the break is the FIRST stage
 * boundary at which the upstream counter advances and the downstream one stays flat. A symptom
 * detector says media stopped; this says where it stopped, which is the difference between "the call
 * broke" and a stage name to hand a support engineer.
 *
 * Most boundaries already have a specialist owner (`OutboundFrameSupplyDetector`,
 * `BlockedTransportDetector`, `StuckDecoderDetector`, `DecoderPerformanceDetector`,
 * `PlayoutDiscrepancyDetector`), so this detector raises only for the two nothing else covers.
 * `rtp-sender`: `deltaFramesEncoded > 0` while `deltaPacketsSent === 0` on the same outbound RTP —
 * an encoded frame always packetizes, so a sustained violation is a wedged sender, and the innocent
 * explanations (adaptation, congestion) would have stopped the *encoder* instead. `transport-demux`:
 * an ICE transport receiving at `minTransportReceiveBitrateBps` or more — the floor that rules out
 * RTCP and STUN explaining the arriving bytes — while every inbound RTP of that transport is flat.
 *
 * What it refuses to judge: a closed peer connection; an outbound RTP whose track is missing, muted
 * or not live, or whose layer is inactive, since a deliberately silenced sender is not a wedged one;
 * and a transport with no inbound RTP at all, because without a consumer there is no demux
 * expectation to violate. Both verdicts must also persist for `thresholdInMs`, and boundaries that
 * disappear resolve rather than linger. The payload carries `suspectedIssueTypes`, the specialist
 * issues active on this peer connection at raise time, so one entry both localizes the stage and
 * links the detailed evidence.
 *
 * Issue raised: `media-pipeline-stalled`. Monitor event: `media-pipeline-stalled`.
 * Config: `mediaPipelineDetector`.
 */
export class MediaPipelineDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'media-pipeline-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _senderStates = new Map<number, BoundaryState>();
	private readonly _demuxStates = new Map<string, BoundaryState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.mediaPipelineDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		this._checkRtpSenderBoundary();
		this._checkTransportDemuxBoundary();
	}

	private _checkRtpSenderBoundary() {
		const now = Date.now();
		const seenSsrcs = new Set<number>();

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			seenSsrcs.add(outboundRtp.ssrc);

			const state = this._getState(this._senderStates, outboundRtp.ssrc);
			const track = outboundRtp.getTrack()?.track;

			const guarded = !track || track.muted || track.readyState !== 'live' || outboundRtp.active === false;
			const upstreamDelta = outboundRtp.deltaFramesEncoded;
			const downstreamDelta = outboundRtp.deltaPacketsSent;
			// An encoded frame always packetizes, so a sustained violation is a wedged sender/pacer;
			// adaptation and congestion would stop the *encoder* instead, which is what `guarded` filters out.
			const broken = !guarded
				&& upstreamDelta !== undefined && 0 < upstreamDelta
				&& downstreamDelta !== undefined && downstreamDelta === 0;

			if (!broken) {
				this._clear(this._senderStates, outboundRtp.ssrc, this._senderKey(outboundRtp.ssrc), 'packets are leaving the rtp sender again');
				continue;
			}

			if (state.brokenSince === undefined) state.brokenSince = now;

			const stalledForMs = now - state.brokenSince;

			if (stalledForMs < this.config.thresholdInMs) continue;
			if (state.raisedAt !== undefined) continue;

			state.raisedAt = now;

			this._raise(this._senderKey(outboundRtp.ssrc), {
				peerConnectionId: this.peerConnection.peerConnectionId,
				direction: 'send',
				stage: 'rtp-sender',
				ssrc: outboundRtp.ssrc,
				trackId: track?.id,
				upstreamDelta,
				downstreamDelta,
				suspectedIssueTypes: this._activeIssueTypes(),
				stalledForMs,
			});
		}

		for (const ssrc of [ ...this._senderStates.keys() ]) {
			if (seenSsrcs.has(ssrc)) continue;

			this._clear(this._senderStates, ssrc, this._senderKey(ssrc), 'outbound rtp is gone');
			this._senderStates.delete(ssrc);
		}
	}

	private _checkTransportDemuxBoundary() {
		const now = Date.now();
		const seenTransports = new Set<string>();

		for (const transport of this.peerConnection.iceTransports) {
			seenTransports.add(transport.id);

			const state = this._getState(this._demuxStates, transport.id);
			const inboundRtps = this.peerConnection.inboundRtps.filter(
				(inboundRtp) => inboundRtp.transportId === undefined || inboundRtp.transportId === transport.id
			);
			const receivingBitrate = transport.receivingBitrate;
			let demuxedDelta: number | undefined;

			for (const inboundRtp of inboundRtps) {
				if (inboundRtp.deltaBytesReceived === undefined) continue;
				demuxedDelta = (demuxedDelta ?? 0) + inboundRtp.deltaBytesReceived;
			}

			// The bitrate floor is what rules out RTCP and STUN traffic explaining the arriving bytes; without at
			// least one inbound RTP there is no demux expectation to violate at all.
			const broken = 0 < inboundRtps.length
				&& demuxedDelta === 0
				&& receivingBitrate !== undefined
				&& this.config.minTransportReceiveBitrateBps <= receivingBitrate;

			if (!broken) {
				this._clear(this._demuxStates, transport.id, this._demuxKey(transport.id), 'inbound rtp is receiving again');
				continue;
			}

			if (state.brokenSince === undefined) state.brokenSince = now;

			const stalledForMs = now - state.brokenSince;

			if (stalledForMs < this.config.thresholdInMs) continue;
			if (state.raisedAt !== undefined) continue;

			state.raisedAt = now;

			this._raise(this._demuxKey(transport.id), {
				peerConnectionId: this.peerConnection.peerConnectionId,
				direction: 'receive',
				stage: 'transport-demux',
				transportId: transport.id,
				downstreamDelta: demuxedDelta,
				transportReceivingBitrate: receivingBitrate,
				suspectedIssueTypes: this._activeIssueTypes(),
				stalledForMs,
			});
		}

		for (const transportId of [ ...this._demuxStates.keys() ]) {
			if (seenTransports.has(transportId)) continue;

			this._clear(this._demuxStates, transportId, this._demuxKey(transportId), 'ice transport is gone');
			this._demuxStates.delete(transportId);
		}
	}

	private _activeIssueTypes(): string {
		const clientMonitor = this.peerConnection.parent;
		const types = new Set<string>();

		for (const issue of clientMonitor.activeIssues.values()) {
			if (issue.type === ISSUE_TYPE) continue;

			const payload = issue.payload;

			if (!payload || typeof payload !== 'object') continue;

			const trackId = typeof payload.trackId === 'string' ? payload.trackId : undefined;
			const belongsToPc = payload.peerConnectionId === this.peerConnection.peerConnectionId
				|| (trackId !== undefined && (
					this.peerConnection.mappedInboundTracks.has(trackId) ||
					this.peerConnection.mappedOutboundTracks.has(trackId)
				));

			if (belongsToPc) types.add(issue.type);
		}

		return [ ...types ].join(',');
	}

	private _getState<K>(states: Map<K, BoundaryState>, key: K): BoundaryState {
		let state = states.get(key);

		if (!state) {
			state = {};
			states.set(key, state);
		}

		return state;
	}

	private _raise(key: string, payload: MediaPipelineStalledIssuePayload) {
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('media-pipeline-stalled', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<MediaPipelineStalledIssuePayload>(key, {
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	private _clear<K>(states: Map<K, BoundaryState>, stateKey: K, issueKey: string, comment: string) {
		const state = states.get(stateKey);

		if (!state) return;

		state.brokenSince = undefined;

		if (state.raisedAt === undefined) return;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(issueKey);

		if (issue) {
			clientMonitor.resolveIssue(issueKey, {
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

	private _senderKey(ssrc: number) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-send-${ssrc}`;
	}

	private _demuxKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-receive-transport-${transportId}`;
	}
}
