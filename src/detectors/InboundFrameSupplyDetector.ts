import { Detector } from "./Detector";
import { maxTickGapInMs } from "../utils/common";
import type { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import type { ClientIssuePayload } from "../ClientMonitorEvents";
import type { FrameSupplyIssuePayload } from "../ClientMonitorIssues";

export type DecoderBottleneckIssuePayload = FrameSupplyIssuePayload;

export type InboundFrameSupplyDetectorConfig = {
	durationInMs: number;
	decodeFpsRatioThreshold: number;
	/** Not a substituted baseline — the baseline stays the measured arrival rate; this only refuses a ratio taken over a handful of frames. */
	minReceivedFps: number;
}

/**
 * The receive-side counterpart of `capture-bottleneck`: frames arrived and the decoder did not turn
 * enough of them into pictures. The user sees video that judders or runs behind the audio while the
 * network is delivering perfectly well.
 *
 * The rule, in full: accumulate the frames that arrived and the frames that were decoded; once
 * `durationInMs` of measured time has been collected, compare them — decoded below
 * `decodeFpsRatioThreshold` of arrived raises, at or above resolves — then start a fresh window. Two
 * running totals and no history.
 *
 * Averaging over a duration, rather than thresholding each tick, is what catches a decoder that
 * *stumbles* instead of one uniformly overloaded: it drops frames on some intervals and recovers on
 * others, so a per-tick test sees mostly healthy ticks. The average also weights how far short it
 * fell, not merely how often. That choice is the axis this detector shares with
 * `OutboundFrameSupplyDetector` and that separates both from `DecoderPerformanceDetector` and
 * `EncoderPerformanceDetector`, which count consecutive ticks instead: a duration is a persistence
 * bar, a tick count is a confidence floor. The other axis is what is being asked. This one is about
 * frames going missing; `DecoderPerformanceDetector` is about what decoding *cost*.
 *
 * The bar is the measured arrival rate, never the sender's intent. Frames that never arrived are the
 * network's story — `FreezedVideoTrackDetector` and the peer connection's loss reasons tell it — so
 * a stream throttled to 5fps that decodes cleanly is silent here. What it refuses to judge, because
 * a low decode rate there is legitimate: a backgrounded tab, a paused consumer, a paused remote
 * sender, a track that is not live/unmuted/enabled, and a stream thinner than `minReceivedFps`. The
 * window also restarts after a collection gap.
 *
 * Issue raised: `decoder-bottleneck`. Monitor event: `decoder-bottleneck`.
 * Config: `inboundFrameSupplyDetector`.
 */
export class InboundFrameSupplyDetector implements Detector {
	public static readonly ISSUE_TYPE = 'decoder-bottleneck';

	public readonly name = 'inbound-frame-supply-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	private _receivedInWindow = 0;
	private _decodedInWindow = 0;
	private _windowSeconds = 0;
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

		if (previousTimestamp === undefined) return;

		const elapsedInMs = timestamp - previousTimestamp;

		if (elapsedInMs <= 0) return;
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

		// Averaged over the window rather than thresholded per tick: a decoder degrading in bursts recovers on
		// enough individual ticks to look healthy, and the average also weights how far short it fell, not just how often.
		const receivedFps = this._receivedInWindow / this._windowSeconds;
		const decodedFps = this._decodedInWindow / this._windowSeconds;

		this._receivedInWindow = 0;
		this._decodedInWindow = 0;
		this._windowSeconds = 0;

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
