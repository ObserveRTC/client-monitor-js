import { Detector } from "./Detector";
import { maxTickGapInMs } from "../utils/common";
import type { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import type { ClientIssuePayload } from "../ClientMonitorEvents";
import type { FrameSupplyIssuePayload } from "../ClientMonitorIssues";

export type DecoderBottleneckIssuePayload = FrameSupplyIssuePayload;

export type InboundFrameSupplyDetectorConfig = {
	/**
	 * How long the decoder is averaged over before it is judged. A duration
	 * rather than a tick count, so the same configuration means the same thing
	 * at every collecting period.
	 */
	durationInMs: number;
	/** Fraction of the arriving frames the decoder must turn into pictures. */
	decodeFpsRatioThreshold: number;
	/**
	 * Arriving frames per second below which the stream is too thin to judge.
	 *
	 * This is not a substituted baseline — the baseline here is *measured*, it is
	 * the arrival rate itself. This only refuses to compute a ratio over a
	 * handful of frames, where one dropped frame swings it wildly.
	 */
	minReceivedFps: number;
}

/**
 * Inbound Frame Supply Detector
 *
 * The receive-side counterpart of `capture-bottleneck`: frames arrived and the
 * decoder did not turn enough of them into pictures.
 *
 * **The rule, in full.** Add up the frames that arrived and the frames that were
 * decoded. Once `durationInMs` of time has been collected, compare them: decoded
 * below `decodeFpsRatioThreshold` of arrived, raise; at or above, resolve. Then start
 * a new window. Two running totals, no history.
 *
 * Averaging is what catches a decoder that *stumbles* rather than one uniformly
 * overloaded — it drops frames on some intervals and recovers on others, so a
 * per-tick threshold sees mostly healthy ticks. It also weights how far the
 * decoder fell short, not merely how often.
 *
 * **The bar is the arrival rate, never the sender's.** Frames that never arrived
 * are the network's story — `FreezedVideoTrackDetector` and the peer
 * connection's loss reasons tell it — so a stream throttled to 5fps that decodes
 * cleanly is silent. This is also what separates it from
 * `DecoderPerformanceDetector`, which asks whether decoding *cost* too much:
 * that one is about the price of decoding, this one about frames going missing.
 *
 * **What it refuses to judge**, because a low decode rate there is legitimate: a
 * backgrounded tab, a paused consumer, a paused remote sender, a track that is
 * not live and unmuted, and a stream thinner than `minReceivedFps`. The window
 * restarts after a collection gap.
 *
 * **Issues created:** `decoder-bottleneck`.
 */
export class InboundFrameSupplyDetector implements Detector {
	public static readonly ISSUE_TYPE = 'decoder-bottleneck';

	public readonly name = 'inbound-frame-supply-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	// The whole state: what arrived, what was decoded, over how long.
	private _receivedInWindow = 0;
	private _decodedInWindow = 0;
	private _windowSeconds = 0;
	/** Previous inbound-rtp timestamp, to measure each interval and spot gaps. */
	private _lastTimestamp?: number;

	private _on = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this._issueKey = `${InboundFrameSupplyDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config(): InboundFrameSupplyDetectorConfig {
		return this.peerConnection.parent.config.inboundFrameSupplyDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const track = this.trackMonitor.track;

		if (!this.peerConnection.parent.activeTab) return this._reset('tab in background');
		if (this.trackMonitor.paused) return this._reset('consumer paused');
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._reset('remote sender paused');
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._reset('track not playing');

		const inboundRtp = this.trackMonitor.getInboundRtp();
		const timestamp = inboundRtp?.timestamp;

		if (timestamp === undefined) return;

		const previousTimestamp = this._lastTimestamp;

		this._lastTimestamp = timestamp;

		// Nothing to difference against yet; this tick is the baseline.
		if (previousTimestamp === undefined) return;

		const elapsedInMs = timestamp - previousTimestamp;

		if (elapsedInMs <= 0) return;
		// The ticks themselves stopped, which says nothing about the decoder.
		if (maxTickGapInMs(this.peerConnection.parent.config.collectingPeriodInMs) < elapsedInMs) {
			return this._reset('collection gap');
		}

		const received = inboundRtp?.deltaFramesReceived;
		const decoded = inboundRtp?.deltaFramesDecoded;

		if (received === undefined || decoded === undefined) return this._reset('no comparable frame count');

		this._receivedInWindow += received;
		this._decodedInWindow += decoded;
		this._windowSeconds += elapsedInMs / 1000;

		if (this._windowSeconds * 1000 < this.config.durationInMs) return;

		const receivedFps = this._receivedInWindow / this._windowSeconds;
		const decodedFps = this._decodedInWindow / this._windowSeconds;

		this._receivedInWindow = 0;
		this._decodedInWindow = 0;
		this._windowSeconds = 0;

		// Too thin a stream to judge a decoder on: a trickle says nothing.
		if (receivedFps < this.config.minReceivedFps) return this._clear('stream too thin to judge');
		if (receivedFps * this.config.decodeFpsRatioThreshold <= decodedFps) return this._clear('decoder keeping up again');
		if (this._on) return;

		this._on = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('decoder-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			decodedFps,
			receivedFps,
		});

		clientMonitor.raiseIssue<DecoderBottleneckIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: InboundFrameSupplyDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				sourceFps: decodedFps,
				expectedFps: receivedFps,
				averagedOverInMs: this.config.durationInMs,
				sourceWidth: inboundRtp?.frameWidth,
				sourceHeight: inboundRtp?.frameHeight,
				trackReadyState: track.readyState,
				trackMuted: track.muted,
			},
		});
	}

	private _reset(comment: string) {
		this._lastTimestamp = undefined;

		this._clear(comment);
	}

	private _clear(comment: string) {
		this._receivedInWindow = 0;
		this._decodedInWindow = 0;
		this._windowSeconds = 0;

		if (!this._on) return;

		this._on = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		clientMonitor.resolveIssue(this._issueKey, {
			comment,
			payload: issue
				? { ...issue.payload, durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined } as ClientIssuePayload
				: undefined,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
