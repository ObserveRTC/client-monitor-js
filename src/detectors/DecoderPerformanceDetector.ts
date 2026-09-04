import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type DecoderPerformanceIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Wall-clock decode cost per frame in the interval, in milliseconds. */
	decodeTimePerFrameInMs?: number;
	/** The per-frame budget it was compared against (1000/fps), in milliseconds. */
	frameBudgetInMs?: number;
	/** Delta `framesDropped` over delta `framesReceived` in the interval. */
	dropRatio?: number;
	/** Delta `framesRendered` over delta `framesDecoded` in the interval. */
	renderRatio?: number;
	/** Frames that arrived in the interval — the evidence the decoder had something to do. */
	framesReceived: number;
	decoderImplementation?: string;
	powerEfficientDecoder?: boolean;
	/** Consecutive qualifying ticks behind the alert, at least `minConsecutiveTicks`. */
	consecutiveTicks: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type DecoderPerformanceDetectorConfig = {
	/**
	 * Fraction of the per-frame time budget decoding may consume before the
	 * decoder counts as overloaded. The budget comes from the stream's own
	 * frame rate.
	 */
	decodeTimeBudgetRatio: number;

	/** Δ`framesDropped` / Δ`framesReceived` above which frames are being dropped after arrival. */
	dropRatioThreshold: number;

	/** Frames that must have been received in the interval before judging. */
	minFramesReceived: number;

	/**
	 * Loss fraction above which the network is the better explanation and
	 * the detector stays silent — the whole point of this detector is to
	 * only blame the client when the frames actually arrived.
	 */
	quietLossThreshold: number;

	/** Consecutive collections the condition must hold before raising. */
	minConsecutiveTicks: number;
}

/**
 * Watches inbound video for the client failing to decode what it was sent. It exists to make
 * network-versus-client attribution possible at all: frames missing because they never arrived
 * and frames missing because the machine could not decode them look identical in a frame-rate
 * chart, and the two have opposite fixes.
 *
 * So the decoder is only accused once the frames demonstrably arrived. Enough of them must have
 * come in during the interval, and the network must have been quiet — loss below
 * `quietLossThreshold` — before either symptom counts: decode time per frame exceeding the
 * budget the stream's own frame rate implies (1000/fps: 33ms at 30fps, 66ms at 15fps), or frames
 * being dropped after they had already arrived. Rising loss alongside PLI is the other story
 * entirely, `InboundVideoFlowStateDetector` owns it, and both detectors firing at once is the honest
 * answer when both things are true. A symptom must also persist for `minConsecutiveTicks`, so
 * one slow interval never becomes an issue.
 *
 * It stands down, resolving any open issue, whenever it cannot clear the network or the machine:
 * in a backgrounded tab, where throttled decoding says nothing about real capability; with too
 * few frames in the interval to judge, as with a static screen share; and when the loss reading
 * is missing altogether, because an absent measurement cannot exonerate the network and the
 * decoder must not be blamed in its place.
 *
 * Raises `video-decoder-overloaded`. Emits `video-decoder-overloaded`.
 * Config: `decoderPerformanceDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — frames to decoder
 *
 */
export class DecoderPerformanceDetector implements Detector {
	public static readonly ISSUE_TYPE = 'video-decoder-overloaded';
	public readonly name = 'decoder-performance-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;
	private _consecutiveTicks = 0;
	private _alertOn = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${DecoderPerformanceDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.decoderPerformanceDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') return;

		if (!this.peerConnection.parent.activeTab) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('tab in background') : undefined;
		}

		const framesReceived = inboundRtp.deltaFramesReceived ?? 0;

		if (framesReceived < this.config.minFramesReceived) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('not enough frames to evaluate') : undefined;
		}

		const fractionLost = inboundRtp.deltaFractionLost;

		if (fractionLost === undefined) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('no loss reading; cannot clear the network') : undefined;
		}

		// loss dominating means the network owns the frame loss, not the decoder (`InboundVideoFlowStateDetector` covers that)
		if (this.config.quietLossThreshold < fractionLost) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('loss dominates; not a decoder problem') : undefined;
		}

		// per-frame budget from the stream's own frame rate: 33ms at 30fps, 66ms at 15fps
		const fps = inboundRtp.framesPerSecond ?? inboundRtp.avgFramesPerSec;
		const frameBudgetInMs = fps && 0 < fps ? 1000 / fps : undefined;
		const decodeTimePerFrameInMs = inboundRtp.decodeTimePerFrameInMs;

		const decodeTooSlow = frameBudgetInMs !== undefined &&
			decodeTimePerFrameInMs !== undefined &&
			frameBudgetInMs * this.config.decodeTimeBudgetRatio < decodeTimePerFrameInMs;

		const droppingAfterArrival = inboundRtp.dropRatio !== undefined &&
			this.config.dropRatioThreshold < inboundRtp.dropRatio;

		if (!decodeTooSlow && !droppingAfterArrival) {
			this._consecutiveTicks = 0;

			if (this._alertOn) {
				this._clear('decoder keeping up again');
			}

			return;
		}

		this._consecutiveTicks += 1;

		if (this._alertOn) return;
		if (this._consecutiveTicks < this.config.minConsecutiveTicks) return;

		this._alertOn = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('video-decoder-overloaded', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			decodeTimePerFrameInMs,
			frameBudgetInMs,
		});

		clientMonitor.raiseIssue<DecoderPerformanceIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: DecoderPerformanceDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				decodeTimePerFrameInMs,
				frameBudgetInMs,
				dropRatio: inboundRtp.dropRatio,
				renderRatio: inboundRtp.renderRatio,
				framesReceived,
				decoderImplementation: inboundRtp.decoderImplementation,
				powerEfficientDecoder: inboundRtp.powerEfficientDecoder,
				consecutiveTicks: this._consecutiveTicks,
			},
		});
	}

	private _clear(comment: string) {
		this._alertOn = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: DecoderPerformanceIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DecoderPerformanceIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<DecoderPerformanceIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
