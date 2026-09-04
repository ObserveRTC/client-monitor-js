import { Detector } from "./Detector";
import { maxTickGapInMs } from "../utils/common";
import type { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import type { ClientIssuePayload } from "../ClientMonitorEvents";
import type { FrameSupplyIssuePayload } from "../ClientMonitorIssues";

export type DecoderBottleneckIssuePayload = FrameSupplyIssuePayload;

export type DecoderBottleneckDetectorConfig = {
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
 * "Measured time" is `inboundRtp.deltaTime`: the interval between the two stats reports the frame
 * deltas were themselves differenced from. Both halves of the ratio therefore come from the same
 * clock, and a collection that ran late neither shortens the window it should have filled nor
 * credits the decoder with seconds nobody was watching.
 *
 * Averaging over a duration, rather than thresholding each tick, is what catches a decoder that
 * *stumbles* instead of one uniformly overloaded: it drops frames on some intervals and recovers on
 * others, so a per-tick test sees mostly healthy ticks. The average also weights how far short it
 * fell, not merely how often. That choice is the axis this detector shares with
 * `SourceCaptureBottleneckDetector` and that separates both from `DecoderPerformanceDetector` and
 * `EncoderPerformanceDetector`, which count consecutive ticks instead: a duration is a persistence
 * bar, a tick count is a confidence floor. The other axis is what is being asked. This one is about
 * frames going missing; `DecoderPerformanceDetector` is about what decoding *cost*.
 *
 * The bar is the measured arrival rate, never the sender's intent. Frames that never arrived are the
 * network's story — `InboundVideoFlowStateDetector` and the peer connection's loss reasons tell it — so
 * a stream throttled to 5fps that decodes cleanly is silent here. What it refuses to judge, because
 * a low decode rate there is legitimate: a backgrounded tab, a paused consumer, a paused remote
 * sender, a track that is not live/unmuted/enabled, and a stream thinner than `minReceivedFps`. The
 * window also restarts after a collection gap.
 *
 * Issue raised: `decoder-bottleneck`. Monitor event: `decoder-bottleneck`.
 * Config: `decoderBottleneckDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — frames to decoder
 *
 */
export class DecoderBottleneckDetector implements Detector {
	public static readonly ISSUE_TYPE = 'decoder-bottleneck';

	public readonly name = 'decoder-bottleneck-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	private _receivedInWindow = 0;
	private _decodedInWindow = 0;
	/** Stats time gathered into the current window, accumulated from `inboundRtp.deltaTime`. */
	private _windowInMs = 0;
	/**
	 * False until a tick has been seen since the last stand-down. The first tick back only
	 * opens the window: its counters and its `deltaTime` span the stretch that was deliberately
	 * not judged, so counting it would fold the paused or backgrounded time into the average.
	 */
	private _windowOpen = false;

	private _on = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this._issueKey = `${DecoderBottleneckDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config(): DecoderBottleneckDetectorConfig {
		return this.peerConnection.parent.config.decoderBottleneckDetector!;
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
		// The measured gap between the two stats reports these frame counts were differenced from,
		// so the window's seconds and its frames always describe the same stretch of the stream.
		const elapsedInMs = inboundRtp?.deltaTime;

		if (elapsedInMs === undefined) return;

		if (!this._windowOpen) {
			this._windowOpen = true;

			return;
		}

		if (elapsedInMs <= 0) return;
		if (maxTickGapInMs(this.peerConnection.parent.config.collectingPeriodInMs) < elapsedInMs) {
			return this._reset('collection gap');
		}

		const received = inboundRtp?.deltaFramesReceived;
		const decoded = inboundRtp?.deltaFramesDecoded;

		if (received === undefined || decoded === undefined) return this._reset('no comparable frame count');

		this._receivedInWindow += received;
		this._decodedInWindow += decoded;
		this._windowInMs += elapsedInMs;

		if (this._windowInMs < this.config.durationInMs) return;

		// Averaged over the window rather than thresholded per tick: a decoder degrading in bursts recovers on
		// enough individual ticks to look healthy, and the average also weights how far short it fell, not just how often.
		const windowSeconds = this._windowInMs / 1000;
		const receivedFps = this._receivedInWindow / windowSeconds;
		const decodedFps = this._decodedInWindow / windowSeconds;

		this._receivedInWindow = 0;
		this._decodedInWindow = 0;
		this._windowInMs = 0;

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
			type: DecoderBottleneckDetector.ISSUE_TYPE,
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
		this._windowOpen = false;

		this._clear(comment);
	}

	private _clear(comment: string) {
		this._receivedInWindow = 0;
		this._decodedInWindow = 0;
		this._windowInMs = 0;

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
