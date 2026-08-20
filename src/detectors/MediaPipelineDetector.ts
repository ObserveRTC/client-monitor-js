import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * The pipeline stage boundary this detector found broken.
 *
 * - `rtp-sender` (send side, encoder → RTP sender): frames encode but no
 *   packet leaves the RTP sender — a wedged sender/pacer, observed in the
 *   wild after `replaceTrack` races and simulcast reconfigurations.
 * - `transport-demux` (receive side, transport → RTP receiver): the ICE
 *   transport keeps receiving at a rate no RTCP/STUN traffic explains, yet
 *   no inbound RTP stream accounts for any of it — traffic arrives that
 *   never demuxes (SSRC mismatch after renegotiation, a consumer created
 *   against a dead producer).
 */
export type MediaPipelineStage = 'rtp-sender' | 'transport-demux';

export type MediaPipelineStalledIssuePayload = {
	peerConnectionId: string;
	direction: 'send' | 'receive';
	/** The first broken stage boundary. */
	stage: MediaPipelineStage;
	/** Set for the `rtp-sender` stage. */
	ssrc?: number;
	trackId?: string;
	/** Set for the `transport-demux` stage. */
	transportId?: string;
	/** Upstream progress observed in the interval the issue was raised on. */
	upstreamDelta?: number;
	/** Downstream progress observed in the same interval (the flat counter). */
	downstreamDelta?: number;
	/** Transport receive rate at raise time (bps), for the demux stage. */
	transportReceivingBitrate?: number;
	/**
	 * Comma-separated types of the specialist issues active on this peer
	 * connection when the verdict was made — the cross-reference from the
	 * stage verdict to the detailed evidence.
	 */
	suspectedIssueTypes: string;
	/** How long the boundary had been broken when the issue was raised. */
	stalledForMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

type BoundaryState = {
	brokenSince?: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'media-pipeline-stalled';

/**
 * Media Pipeline Detector
 *
 * Media moves through a fixed chain of components (capture → encoder → RTP
 * sender → transport → wire, mirrored on the receiving side), every stage has
 * a monotonic counter that proves it is making progress, and a disruption is
 * locatable as the first stage boundary at which the upstream counter
 * advances and the downstream one does not.
 *
 * Most boundaries are already owned by specialist detectors
 * (`SourceEncoderBottleneckDetector`, `BlockedTransportDetector`,
 * `StuckDecoderDetector`, `DecoderPerformanceDetector`,
 * `PlayoutDiscrepancyDetector`), so this detector raises only for the two
 * boundaries nothing else covers:
 *
 * 1. **`rtp-sender`** (send): `deltaFramesEncoded > 0` while
 *    `deltaPacketsSent === 0` on the same outbound RTP — an encoded frame
 *    always packetizes, so a sustained violation is a wedged sender/pacer.
 *    Evaluated per SSRC on live, unmuted tracks with the layer active.
 * 2. **`transport-demux`** (receive): the ICE transport receives at
 *    `minTransportReceiveBitrateBps` or more — well above what RTCP + STUN
 *    can explain — while every inbound RTP of that transport is flat.
 *    Requires at least one inbound RTP monitor to exist, since without
 *    consumers there is no demux expectation to violate.
 *
 * Both verdicts must persist for `thresholdInMs` before the
 * `media-pipeline-stalled` issue is raised. The payload names the broken
 * `stage` and carries `suspectedIssueTypes` — the specialist issues active on
 * this peer connection at raise time — so the server receives one entry that
 * both localizes the stage and links the detailed evidence.
 *
 * **Issues created:** `media-pipeline-stalled`.
 * **Events emitted:** `media-pipeline-stalled` (monitor event).
 *
 * @example
 * ```typescript
 * const config = {
 *   mediaPipelineDetector: {
 *     thresholdInMs: 4000,
 *     minTransportReceiveBitrateBps: 20_000,
 *   }
 * };
 *
 * monitor.on('issue', (issue) => {
 *   if (issue.type === 'media-pipeline-stalled') {
 *     console.warn('pipeline broke at', issue.payload.stage, issue.payload);
 *   }
 * });
 * ```
 */
export class MediaPipelineDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	/** Unique identifier for this detector type */
	public readonly name = 'media-pipeline-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	/** Per-SSRC state for the `rtp-sender` boundary. */
	private readonly _senderStates = new Map<number, BoundaryState>();
	/** Per-transport state for the `transport-demux` boundary. */
	private readonly _demuxStates = new Map<string, BoundaryState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.mediaPipelineDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		this._checkRtpSenderBoundary();
		this._checkTransportDemuxBoundary();
	}

	/**
	 * Send side, encoder → RTP sender: an encoded frame always packetizes, so
	 * frames encoding while no packet leaves is a wedge — not adaptation, not
	 * congestion (both of those stop the *encoder*, not the sender).
	 */
	private _checkRtpSenderBoundary() {
		const now = Date.now();
		const seenSsrcs = new Set<number>();

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			seenSsrcs.add(outboundRtp.ssrc);

			const state = this._getState(this._senderStates, outboundRtp.ssrc);
			const track = outboundRtp.getTrack()?.track;

			// A muted or dead source legitimately silences the whole send
			// chain; an explicitly deactivated layer sends nothing by design.
			const guarded = !track || track.muted || track.readyState !== 'live' || outboundRtp.active === false;
			const upstreamDelta = outboundRtp.deltaFramesEncoded;
			const downstreamDelta = outboundRtp.deltaPacketsSent;
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

	/**
	 * Receive side, transport → RTP receiver: traffic arrives at a rate only
	 * media explains, yet no inbound RTP accounts for any of it — the pipe is
	 * alive, the demux is not.
	 */
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

			// Without consumers there is no demux expectation to violate, and
			// without byte counters there is nothing to judge.
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

	/**
	 * Types of the specialist issues currently active on this peer connection
	 * or its tracks — the link from the stage verdict to the detailed evidence.
	 */
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
