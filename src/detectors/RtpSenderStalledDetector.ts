import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * `framesEncodedDelta` is the progress the encoder made over the interval the issue was raised on,
 * `packetsSentDelta` the progress the sender did not make — the flat counter that is the whole
 * finding. `stalledForMs` is how long the boundary had been broken at raise time, measured in stats
 * time.
 */
export type RtpSenderStalledIssuePayload = {
	peerConnectionId: string;
	ssrc: number;
	trackId?: string;
	framesEncodedDelta?: number;
	packetsSentDelta?: number;
	stalledForMs: number;
	durationInMs?: number;
};

type SenderState = {
	/** Stats time the boundary has been broken for; `undefined` while it is not broken. */
	stalledForMs?: number;
	raisedAt?: number;
};

const ISSUE_TYPE = 'rtp-sender-stalled';

export type RtpSenderStalledDetectorConfig = {
	/**
	 * How long (in milliseconds) the broken stage boundary must persist
	 * before the issue is raised.
	 */
	thresholdInMs: number;
}

/**
 * Watches one stage boundary on the send side: the encoder hands frames to the RTP sender, and the
 * sender puts packets on the wire. Every stage in the chain carries a monotonic counter, which makes
 * a break *locatable* rather than merely detectable — the boundary is broken when the upstream
 * counter advances and the downstream one stays flat. Here that is `deltaFramesEncoded > 0` while
 * `deltaPacketsSent === 0` on the same outbound RTP. An encoded frame always packetizes, so a
 * sustained violation is a wedged sender or pacer; it has been seen in the wild after `replaceTrack`
 * races and simulcast reconfigurations, where the encoder happily keeps running against a sender that
 * will never transmit again. The value of the issue is that it names the stage: the difference
 * between "the call broke" and something a support engineer can act on.
 *
 * The innocent explanations for silence on the wire — congestion, resolution adaptation, a paused
 * sender — would have stopped the *encoder*, so they cannot produce this signature. What is refused
 * outright: a closed peer connection, and an outbound RTP whose track is missing, muted or not live,
 * or whose simulcast layer is inactive, since a deliberately silenced sender is not a wedged one.
 *
 * The stall clock accumulates each tick's `deltaTime` rather than wall-clock elapsed, so the
 * threshold is crossed by media time actually observed: a page that was throttled or a collection
 * that was skipped cannot age a boundary into an issue nobody watched break. State is kept per ssrc —
 * simulcast layers wedge one at a time — and an ssrc that disappears resolves its issue rather than
 * leaving it open forever.
 *
 * Issue raised: `rtp-sender-stalled`. Monitor event: `rtp-sender-stalled`.
 * Config: `rtpSenderStalledDetector`.
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
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const seenSsrcs = new Set<number>();

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			seenSsrcs.add(outboundRtp.ssrc);

			const state = this._getState(outboundRtp.ssrc);
			const track = outboundRtp.getTrack()?.track;

			const guarded = !track || track.muted || track.readyState !== 'live' || outboundRtp.active === false;
			const framesEncodedDelta = outboundRtp.deltaFramesEncoded;
			const packetsSentDelta = outboundRtp.deltaPacketsSent;
			// An encoded frame always packetizes, so a sustained violation is a wedged sender/pacer;
			// adaptation and congestion would stop the *encoder* instead, which is what `guarded` filters out.
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
				// stats time, not wall-clock: only intervals actually observed count towards the threshold
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

			clientMonitor.raiseIssue<RtpSenderStalledIssuePayload>(this._issueKey(outboundRtp.ssrc), {
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

		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(ssrc);
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

	private _issueKey(ssrc: number) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-send-${ssrc}`;
	}
}
