import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type StuckDecoderVariant = 'assembly' | 'decode' | 'unknown';

export type StuckDecoderIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	ssrc?: number;
	/**
	 * `assembly`: packets arrive but no frame is ever reassembled
	 * (`framesReceived` flat). `decode`: frames assemble but none decode
	 * (`framesReceived` rising, `framesDecoded` flat).
	 */
	variant: StuckDecoderVariant;
	stuckForInMs: number;
	/** RTP bytes received while nothing decoded — the "dead traffic". */
	deadBytesReceived: number;
	pliCountSinceStuck: number;
	frameWidth?: number;
	frameHeight?: number;
	decoderImplementation?: string;
	durationInMs?: number;
}

/**
 * Stuck Decoder Detector
 *
 * Detects the wedge where RTP keeps arriving but no frame ever decodes again:
 * a corrupt or incomplete frame breaks the decode chain, PLIs go out and
 * keyframes may even be generated upstream, yet this consumer never assembles
 * a usable frame — until the consumer is recreated. Observed per consumer
 * (another consumer of the same producer recovers), typically cross-SFU.
 *
 * Fingerprint: `bytesReceived` rising + `framesReceived` flat + `pliCount`
 * rising + `keyFramesDecoded` flat for at least N seconds.
 *
 * The "bytes still flowing" condition is what separates this from everything
 * nearby: a dry track (`DryInboundTrackDetector`) has no bytes, and
 * `video-recovery-failed` reports an unanswered repair request without saying
 * whether the pipe is dead or the decoder is. This detector's claim is
 * specific — the network is delivering and the output is still zero — which is
 * exactly the condition under which recreating the track is the right
 * mitigation. It deliberately reads only RTP deltas, so it does not depend on
 * browser freeze statistics.
 *
 * **Issues created:** `stuck-decoder`, resolved when frames decode again. The
 * payload carries the accumulated dead bytes and a `variant` separating an
 * assembly wedge from a decode wedge.
 *
 * **Events emitted:** `stuck-decoder` — the hook for the application-side
 * mitigation (recreate the track).
 */
export class StuckDecoderDetector implements Detector {
	public static readonly ISSUE_TYPE = 'stuck-decoder';

	public readonly name = 'stuck-decoder-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;

	private readonly issueKey: string;

	private _stuckSince?: number;
	private _stuckTicks = 0;
	private _deadBytes = 0;
	private _plisSinceStuck = 0;
	/** True while any tick of the current stretch had `framesReceived` moving. */
	private _sawAssembledFrames = false;
	private _alertOn = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${StuckDecoderDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.stuckDecoderDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') return;
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._reset('remote track paused');

		const deltaBytes = inboundRtp.deltaBytesReceived ?? 0;
		const deltaFramesDecoded = inboundRtp.deltaFramesDecoded;

		// frames decoded — whatever was stuck is not stuck now
		if (deltaFramesDecoded === undefined || 0 < deltaFramesDecoded) {
			return this._reset('frames decoding');
		}

		// no meaningful bitrate: the pipe is dead or paused, which is a
		// starvation problem (dry track), not a wedge — the wedge's defining
		// property is that the network IS delivering
		if ((inboundRtp.bitrate ?? 0) < this.config.minBitrate) {
			return this._reset('rtp not flowing');
		}

		const now = Date.now();

		this._stuckSince ??= now;
		this._stuckTicks += 1;
		this._deadBytes += deltaBytes;
		this._plisSinceStuck += inboundRtp.deltaPliCount ?? 0;

		if (0 < (inboundRtp.deltaFramesReceived ?? 0)) {
			this._sawAssembledFrames = true;
		}

		if (this._alertOn) return;

		const stuckForInMs = now - this._stuckSince;

		// a wedge never self-heals, so the wait only needs to outlast a
		// legitimate PLI -> keyframe recovery — which scales with RTT
		const rttInMs = (this.peerConnection.avgRttInSec ?? 0) * 1000;
		const requiredInMs = Math.max(this.config.thresholdInMs, this.config.rttMultiplier * rttInMs);

		if (stuckForInMs < requiredInMs) return;
		if (this._stuckTicks < this.config.minStuckTicks) return;
		// the browser asking for repair confirms it considers itself stuck
		if (this._plisSinceStuck < this.config.minPliCount) return;

		this._alertOn = true;
		this._startedAt = now;

		const variant: StuckDecoderVariant = inboundRtp.deltaFramesReceived === undefined
			? 'unknown'
			: this._sawAssembledFrames ? 'decode' : 'assembly';

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('stuck-decoder', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			variant,
			stuckForInMs,
			deadBytesReceived: this._deadBytes,
			pliCountSinceStuck: this._plisSinceStuck,
		});

		clientMonitor.raiseIssue<StuckDecoderIssuePayload>(this.issueKey, {
			type: StuckDecoderDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				ssrc: inboundRtp.ssrc,
				variant,
				stuckForInMs,
				deadBytesReceived: this._deadBytes,
				pliCountSinceStuck: this._plisSinceStuck,
				frameWidth: inboundRtp.frameWidth,
				frameHeight: inboundRtp.frameHeight,
				decoderImplementation: inboundRtp.decoderImplementation,
			},
		});
	}

	private _reset(comment: string) {
		this._stuckSince = undefined;
		this._stuckTicks = 0;
		this._deadBytes = 0;
		this._plisSinceStuck = 0;
		this._sawAssembledFrames = false;

		if (!this._alertOn) return;

		this._alertOn = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: StuckDecoderIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as StuckDecoderIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<StuckDecoderIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
