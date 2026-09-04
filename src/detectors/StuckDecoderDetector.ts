import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type StuckDecoderVariant = 'assembly' | 'decode' | 'unknown';

export type StuckDecoderIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	ssrc?: number;
	/**
	 * `assembly`: packets arrive but no frame is ever reassembled (`framesReceived`
	 * flat). `decode`: frames assemble but none decode (`framesReceived` rising,
	 * `framesDecoded` flat). `unknown`: the browser reports no `framesReceived`.
	 */
	variant: StuckDecoderVariant;
	stuckForInMs: number;
	/** RTP bytes received while nothing decoded — the "dead traffic". */
	deadBytesReceived: number;
	/** PLIs sent since the wedge began, not over the track's lifetime. */
	pliCountSinceStuck: number;
	frameWidth?: number;
	frameHeight?: number;
	decoderImplementation?: string;
	/** How long the issue stayed active; filled in on resolution. */
	durationInMs?: number;
}

export type StuckDecoderDetectorConfig = {
	/**
	 * Floor (in milliseconds) on how long nothing may decode, with RTP
	 * flowing, before raising. The effective wait is
	 * `max(thresholdInMs, rttMultiplier × RTT)` — a wedge never self-heals,
	 * so the wait only needs to outlast a legitimate PLI → keyframe
	 * recovery round trip, and that cost scales with RTT rather than
	 * being a fixed number of seconds.
	 */
	thresholdInMs: number;

	/**
	 * Multiple of the connection's current RTT the condition must outlast.
	 * Extends the wait on high-latency paths where recovery legitimately
	 * takes longer; on a low-RTT path `thresholdInMs` dominates.
	 */
	rttMultiplier: number;

	/**
	 * Receive bitrate (bps) above which the stream counts as "still being
	 * delivered" — separates the wedge from a dry/starved track. A rate,
	 * not a per-tick byte count, so it means the same thing at every
	 * collecting period.
	 */
	minBitrate: number;

	/** PLIs that must have been sent during the stuck stretch. */
	minPliCount: number;
}

/**
 * Watches an inbound video track for the wedge where RTP keeps arriving but no frame
 * ever decodes again: a corrupt or incomplete frame breaks the decode chain, PLIs go
 * out and keyframes may even be produced upstream, yet this consumer never assembles
 * a usable frame — until the track is recreated. The viewer sees a permanently frozen
 * tile. It is a per-consumer fault, so another consumer of the same producer keeps
 * playing normally and only the client can see it.
 *
 * Bytes still arriving is exactly what separates a wedge from a dry track. A starving
 * track has no bytes at all and belongs to `DryInboundTrackDetector`, while
 * `video-recovery-failed` reports an unanswered repair request without saying whether
 * the pipe is dead or the decoder is. The claim here is specific — the network is
 * delivering and the output is still zero — and that is precisely the condition under
 * which recreating the track is the right mitigation. Only RTP deltas are read, so
 * nothing depends on browser freeze statistics.
 *
 * The wait is `max(thresholdInMs, rttMultiplier × RTT)`: a wedge never self-heals, so
 * the wait only has to outlast a legitimate PLI → keyframe recovery, whose cost scales
 * with round trip time rather than being a fixed number of seconds. At least
 * `minPliCount` PLIs must have gone out in that stretch as well — the browser asking
 * for repair confirms it considers itself stuck.
 *
 * That wait is counted in the stream's own time, by accumulating the inbound RTP's
 * `deltaTime`, rather than in wall-clock elapsed. The dead bytes and the PLIs already
 * come from the stats deltas, so the stretch they are attributed to has to be measured
 * the same way or the three no longer describe the same interval: a collection that
 * ran late would report a wedge as having lasted longer than the counters it is
 * reported alongside can account for.
 *
 * It refuses to judge a paused consumer, a paused remote sender or a backgrounded tab,
 * where suspended decoding with bytes still flowing is expected rather than broken,
 * and it stands down below `minBitrate`, since a dead pipe is starvation and not a
 * wedge. An unreported `bitrate` is evidence of neither, so such a tick holds the
 * accumulated state instead of resetting it.
 *
 * Issue raised: `stuck-decoder`, resolved when frames decode again or the detector
 * stands down.
 * Monitor event: `stuck-decoder` — the hook for the application-side mitigation.
 * Config: `stuckDecoderDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — frames to decoder
 *
 */
export class StuckDecoderDetector implements Detector {
	public static readonly ISSUE_TYPE = 'stuck-decoder';

	public readonly name = 'stuck-decoder-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;

	/** Stats time accumulated over the current wedge; `0` outside one. */
	private _stuckForInMs = 0;
	private _deadBytes = 0;
	private _plisSinceStuck = 0;
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
		if (this.trackMonitor.paused) return this._reset('consumer paused');
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._reset('remote track paused');
		if (!this.peerConnection.parent.activeTab) return this._reset('tab in background');

		const deltaBytes = inboundRtp.deltaBytesReceived ?? 0;
		const deltaFramesDecoded = inboundRtp.deltaFramesDecoded;

		if (deltaFramesDecoded === undefined || 0 < deltaFramesDecoded) {
			return this._reset('frames decoding');
		}

		if (inboundRtp.bitrate === undefined) return;
		if (inboundRtp.bitrate < this.config.minBitrate) {
			return this._reset('rtp not flowing');
		}

		this._stuckForInMs += inboundRtp.deltaTime ?? 0;
		this._deadBytes += deltaBytes;
		this._plisSinceStuck += inboundRtp.deltaPliCount ?? 0;

		if (0 < (inboundRtp.deltaFramesReceived ?? 0)) {
			this._sawAssembledFrames = true;
		}

		if (this._alertOn) return;

		const stuckForInMs = this._stuckForInMs;

		// A wedge never self-heals, so the wait only has to outlast a legitimate PLI -> keyframe recovery, which scales with RTT.
		const rttInMs = (this.peerConnection.avgRttInSec ?? 0) * 1000;
		const requiredInMs = Math.max(this.config.thresholdInMs, this.config.rttMultiplier * rttInMs);

		if (stuckForInMs < requiredInMs) return;
		if (this._plisSinceStuck < this.config.minPliCount) return;

		this._alertOn = true;
		// wall clock, deliberately: read only to report how long the issue stood
		this._startedAt = Date.now();

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
				includeInSample: this.includeIssueInSample,
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
		this._stuckForInMs = 0;
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
