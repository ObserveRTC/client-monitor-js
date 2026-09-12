import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type StuckDecoderVariant = 'assembly' | 'decode' | 'unknown';

export type StuckDecoderIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	ssrc?: number;
	/** Where the chain broke: no frame reassembles, or frames assemble but none decode. */
	variant: StuckDecoderVariant;
	stuckForInMs: number;
	/** RTP bytes received while nothing decoded. */
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
	/** Floor on the wait before raising, in ms. The effective wait is `max(thresholdInMs, rttMultiplier × RTT)`. */
	thresholdInMs: number;

	/** Multiple of current RTT the condition must outlast, so high-latency paths get longer to recover. */
	rttMultiplier: number;

	/** Receive bitrate (bps) above which the stream counts as still being delivered rather than starved. */
	minBitrate: number;

	/** PLIs that must have been sent during the stuck stretch. */
	minPliCount: number;
}

/**
 * Reports an inbound video track wedged: RTP keeps arriving but nothing decodes any more, and the
 * viewer sees a permanently frozen tile until the track is recreated. Use it to tell a wedge from a
 * starved track — bytes still flowing is exactly what separates the two, and it is what makes
 * recreating the track the right mitigation rather than a network fix.
 *
 * A finding means decodable state was lost and never recovered — a keyframe that never arrived, a
 * codec or resolution switch the decoder did not survive, or a browser decoder bug. It does not
 * self-heal, which is why the event exists as a hook for recreating the track.
 *
 * It waits `max(thresholdInMs, rttMultiplier × RTT)` with at least `minPliCount` PLIs sent, since a
 * wedge never self-heals and the wait only has to outlast a legitimate PLI to keyframe recovery.
 * Only RTP deltas are read, counted in the stream's own time so the interval matches the counters
 * reported with it. `variant` names whether frames failed to assemble or failed to decode.
 *
 * It refuses to judge a paused consumer, a paused sender or a backgrounded tab, where stopped
 * decoding with bytes flowing is expected.
 *
 * Issue raised: `stuck-decoder`, resolved when frames decode again or the detector
 * stands down.
 * Monitor event: `stuck-decoder` — the hook for the application-side mitigation.
 * Config: `stuckDecoderDetector`.
 * Track attribute: `InboundTrackMonitor.stuckedDecoder`.
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
		if (this.disabled) {
			this.trackMonitor.stuckedDecoder = undefined;

			return;
		}

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') {
			this.trackMonitor.stuckedDecoder = undefined;

			return;
		}
		if (this.trackMonitor.paused) {
			this.trackMonitor.stuckedDecoder = undefined;

			return this._reset('consumer paused');
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this.trackMonitor.stuckedDecoder = undefined;

			return this._reset('remote track paused');
		}
		if (!this.peerConnection.parent.activeTab) {
			this.trackMonitor.stuckedDecoder = undefined;

			return this._reset('tab in background');
		}

		const deltaBytes = inboundRtp.deltaBytesReceived ?? 0;
		const deltaFramesDecoded = inboundRtp.deltaFramesDecoded;

		// No counter is blind; frames coming out is the decoder demonstrably working.
		if (deltaFramesDecoded === undefined) {
			this.trackMonitor.stuckedDecoder = undefined;

			return this._reset('frames decoding');
		}

		if (0 < deltaFramesDecoded) {
			this.trackMonitor.stuckedDecoder = false;

			return this._reset('frames decoding');
		}

		// Nothing decoding, but nothing arriving either: a starved track, not a wedged one.
		if (inboundRtp.bitrate === undefined || inboundRtp.bitrate < this.config.minBitrate) {
			this.trackMonitor.stuckedDecoder = undefined;

			return inboundRtp.bitrate === undefined ? undefined : this._reset('rtp not flowing');
		}

		// Bytes arriving with nothing decoding, but not yet long enough to call it wedged.
		this.trackMonitor.stuckedDecoder = false;

		this._stuckForInMs += inboundRtp.deltaTime ?? 0;
		this._deadBytes += deltaBytes;
		this._plisSinceStuck += inboundRtp.deltaPliCount ?? 0;

		if (0 < (inboundRtp.deltaFramesReceived ?? 0)) {
			this._sawAssembledFrames = true;
		}

		if (this._alertOn) return;

		const stuckForInMs = this._stuckForInMs;

		// The wait scales with RTT: a legitimate PLI -> keyframe recovery costs a round trip.
		const rttInMs = (this.peerConnection.avgRttInSec ?? 0) * 1000;
		const requiredInMs = Math.max(this.config.thresholdInMs, this.config.rttMultiplier * rttInMs);

		if (stuckForInMs < requiredInMs) return;
		if (this._plisSinceStuck < this.config.minPliCount) return;

		this._alertOn = true;
		// Wall clock, and only for the resolved finding's `durationInMs`.
		this._startedAt = Date.now();
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.trackMonitor.stuckedDecoder = true;

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

		this.trackMonitor.issues.raise({
				key: this.issueKey,
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

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: StuckDecoderIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as StuckDecoderIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
