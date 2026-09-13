import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export type RtpSenderStalledIssuePayload = {
	peerConnectionId: string;
	ssrc: number;
	trackId?: string;
	/** Encoder progress over the interval the issue was raised on. */
	framesEncodedDelta?: number;
	/** Sender progress over that same interval — the flat counter that is the whole finding. */
	packetsSentDelta?: number;
	/** How long the boundary had been broken at raise time, in stats time. */
	stalledForMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

type SenderState = {
	/** Stats time the boundary has been broken for; `undefined` while it is not broken. */
	stalledForMs?: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'rtp-sender-stalled';

export type RtpSenderStalledDetectorConfig = {
	/** How long the broken stage boundary must persist before the issue is raised, in ms. */
	thresholdInMs: number;
}

/**
 * Reports a wedged RTP sender or pacer: the encoder keeps producing frames while packets stop
 * leaving. Use it to name the stage rather than the symptom — the difference between "the call
 * broke" and a sender that will never transmit again, as seen after `replaceTrack` races and
 * simulcast reconfigurations.
 *
 * The boundary is broken when `deltaFramesEncoded > 0` while `deltaPacketsSent === 0` on the same
 * outbound RTP, held past `thresholdInMs` of accumulated stats time. The innocent explanations for
 * silence on the wire — congestion, adaptation, a paused sender — would have stopped the *encoder*,
 * so they cannot produce this signature; a track that is missing, muted, not live or on an inactive
 * simulcast layer is refused outright. State is per ssrc, since layers wedge one at a time.
 *
 * Issue raised: `rtp-sender-stalled`. Monitor event: `rtp-sender-stalled`.
 * Config: `rtpSenderStalledDetector`.
 * Connection attribute: `PeerConnectionMonitor.stalledRtpSender`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — encoder to RTP sender
 *
 */
export class RtpSenderStalledDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'rtp-sender-stalled-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _states = new Map<number, SenderState>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.rtpSenderStalledDetector!;
	}

	public update(): void {
		if (this.disabled) {
			this.peerConnection.stalledRtpSender = undefined;

			return;
		}
		if (this.peerConnection.closed) {
			this.peerConnection.stalledRtpSender = undefined;

			return;
		}

		const seenSsrcs = new Set<number>();
		// The connection's flag is the worst of its senders: any one wedged is a wedged connection,
		// and it takes at least one judgeable sender before silence can be called health.
		let anyJudged = false;

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			seenSsrcs.add(outboundRtp.ssrc);

			const state = this._getState(outboundRtp.ssrc);
			const track = outboundRtp.getTrack()?.track;

			const guarded = !track || track.muted || track.readyState !== 'live' || outboundRtp.active === false;
			const framesEncodedDelta = outboundRtp.deltaFramesEncoded;
			const packetsSentDelta = outboundRtp.deltaPacketsSent;

			if (!guarded && framesEncodedDelta !== undefined && packetsSentDelta !== undefined) {
				anyJudged = true;
			}
			// An encoded frame always packetizes, so a sustained violation is a wedged sender or pacer.
			const broken = !guarded
				&& framesEncodedDelta !== undefined && 0 < framesEncodedDelta
				&& packetsSentDelta !== undefined && packetsSentDelta === 0;

			if (!broken) {
				this._clear(outboundRtp.ssrc, 'packets are leaving the rtp sender again');
				continue;
			}

			if (state.stalledForMs === undefined) {
				state.stalledForMs = 0;
			} else {
				// Stats time, not wall-clock: only observed intervals count towards the threshold.
				state.stalledForMs += outboundRtp.deltaTime ?? 0;
			}

			if (state.stalledForMs < this.config.thresholdInMs) continue;
			if (state.raisedAt !== undefined) continue;

			state.raisedAt = Date.now();

			const clientMonitor = this.peerConnection.parent;
			const payload: RtpSenderStalledIssuePayload = {
				peerConnectionId: this.peerConnection.peerConnectionId,
				ssrc: outboundRtp.ssrc,
				trackId: track?.id,
				framesEncodedDelta,
				packetsSentDelta,
				stalledForMs: state.stalledForMs,
			};

			clientMonitor.emit('rtp-sender-stalled', {
				clientMonitor,
				peerConnectionMonitor: this.peerConnection,
				...payload,
			});

			this.peerConnection.issues.raise({
				key: this._issueKey(outboundRtp.ssrc),
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload,
			});
		}

		for (const ssrc of [ ...this._states.keys() ]) {
			if (seenSsrcs.has(ssrc)) continue;

			this._clear(ssrc, 'outbound rtp is gone');
			this._states.delete(ssrc);
		}

		const anyStalled = [ ...this._states.values() ].some((state) => state.raisedAt !== undefined);

		this.peerConnection.stalledRtpSender = anyStalled ? true : anyJudged ? false : undefined;
	}

	private _getState(ssrc: number): SenderState {
		let state = this._states.get(ssrc);

		if (!state) {
			state = {};
			this._states.set(ssrc, state);
		}

		return state;
	}

	private _clear(ssrc: number, comment: string) {
		const state = this._states.get(ssrc);

		if (!state) return;

		state.stalledForMs = undefined;

		if (state.raisedAt === undefined) return;

		const key = this._issueKey(ssrc);
		const issue = this.peerConnection.issues.get(key);

		if (issue) {
			this.peerConnection.issues.resolve({
				key: key,
				comment,
				payload: {
					...issue.payload,
					durationInMs: Date.now() - state.raisedAt,
				} as RtpSenderStalledIssuePayload,
				resolvedAt: Date.now(),
			});
		}

		state.raisedAt = undefined;
	}

	private _issueKey(ssrc: number) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-send-${ssrc}`;
	}
}
