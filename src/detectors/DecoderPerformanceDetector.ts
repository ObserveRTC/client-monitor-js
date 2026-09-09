import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type DecoderPerformanceIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Wall-clock decode cost per frame in the interval, in milliseconds. */
	decodeTimePerFrameInMs?: number;
	/** The per-frame budget it was compared against (1000/fps), in milliseconds. */
	frameBudgetInMs?: number;
	/**
	 * Delta `framesDropped` over delta `framesReceived` in the interval. Context only — frames
	 * lost after arrival are `DecoderBottleneckDetector`'s finding, never this one's trigger.
	 */
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
	/** Fraction of the per-frame budget (1000/fps) decoding may consume before counting as overloaded. */
	decodeTimeBudgetRatio: number;

	/** Frames that must have been received in the interval before judging. */
	minFramesReceived: number;

	/** Loss fraction above which the network is the better explanation and the detector stays silent. */
	quietLossThreshold: number;

	/** Consecutive collections the condition must hold before raising. */
	minConsecutiveTicks: number;
}

/**
 * Reports decoding costing more time than the stream leaves for it — how *expensive* each frame was
 * to decode, not how many frames came out. One measurement:
 *
 * ```
 * frameBudgetInMs = 1000 / framesPerSecond          // 33ms at 30fps, 66ms at 15fps
 *
 * raise when  decodeTimePerFrameInMs  >  frameBudgetInMs × decodeTimeBudgetRatio
 * ```
 *
 * With the default `0.8`, a 30fps stream raises once a frame takes more than 26ms to decode. The
 * budget comes from the stream's own frame rate, so a 15fps stream is not accused for costs a 30fps
 * one could not afford, and the condition must hold for `minConsecutiveTicks` collections.
 *
 * A finding means this machine is the constraint: too many streams for it, a thermal throttle, or a
 * software codec on hardware that cannot run it at this resolution. Decoding this close to the
 * budget is the warning *before* frames start being lost — once they are, the shortfall is
 * `DecoderBottleneckDetector`'s finding. This detector owns cost, that one owns loss, and neither
 * reads the other.
 *
 * It stands down and resolves whenever it cannot clear the network or the machine: a backgrounded
 * tab, too few frames to judge, or a missing loss reading.
 *
 * Raises `video-decoder-overloaded`. Emits `video-decoder-overloaded`.
 * Config: `decoderPerformanceDetector`.
 * Track attribute: `InboundTrackMonitor.overloadedDecoder`.
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
		if (this.disabled) {
			this.trackMonitor.overloadedDecoder = undefined;
			this.trackMonitor.decodeBudgetUtilization = undefined;

			return;
		}

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') {
			this.trackMonitor.overloadedDecoder = undefined;
			this.trackMonitor.decodeBudgetUtilization = undefined;

			return;
		}

		// Every stand-down below is a reason the decoder could not be judged, so the flag goes
		// blind rather than false: a backgrounded tab is not a decoder that kept up.
		if (!this.peerConnection.parent.activeTab) {
			this._consecutiveTicks = 0;
			this.trackMonitor.overloadedDecoder = undefined;
			this.trackMonitor.decodeBudgetUtilization = undefined;

			return this._alertOn ? this._clear('tab in background') : undefined;
		}

		const framesReceived = inboundRtp.deltaFramesReceived ?? 0;

		if (framesReceived < this.config.minFramesReceived) {
			this._consecutiveTicks = 0;
			this.trackMonitor.overloadedDecoder = undefined;
			this.trackMonitor.decodeBudgetUtilization = undefined;

			return this._alertOn ? this._clear('not enough frames to evaluate') : undefined;
		}

		const fractionLost = inboundRtp.deltaFractionLost;

		if (fractionLost === undefined) {
			this._consecutiveTicks = 0;
			this.trackMonitor.overloadedDecoder = undefined;
			this.trackMonitor.decodeBudgetUtilization = undefined;

			return this._alertOn ? this._clear('no loss reading; cannot clear the network') : undefined;
		}

		// Loss dominating means the network owns the frame loss, not the decoder.
		if (this.config.quietLossThreshold < fractionLost) {
			this._consecutiveTicks = 0;
			this.trackMonitor.overloadedDecoder = undefined;
			this.trackMonitor.decodeBudgetUtilization = undefined;

			return this._alertOn ? this._clear('loss dominates; not a decoder problem') : undefined;
		}

		// Per-frame budget from the stream's own frame rate: 33ms at 30fps, 66ms at 15fps.
		const fps = inboundRtp.framesPerSecond ?? inboundRtp.avgFramesPerSec;
		const frameBudgetInMs = fps && 0 < fps ? 1000 / fps : undefined;
		const decodeTimePerFrameInMs = inboundRtp.decodeTimePerFrameInMs;

		// Beside the flag: how much of the budget decoding used, on every collection it could be
		// measured, so a decoder at 0.7 of its budget is distinguishable from one nobody measured.
		this.trackMonitor.decodeBudgetUtilization = frameBudgetInMs !== undefined
			&& decodeTimePerFrameInMs !== undefined
			&& 0 < frameBudgetInMs
			? decodeTimePerFrameInMs / frameBudgetInMs
			: undefined;

		const decodeTooSlow = frameBudgetInMs !== undefined &&
			decodeTimePerFrameInMs !== undefined &&
			frameBudgetInMs * this.config.decodeTimeBudgetRatio < decodeTimePerFrameInMs;

		if (!decodeTooSlow) {
			this._consecutiveTicks = 0;
			this.trackMonitor.overloadedDecoder = false;

			if (this._alertOn) {
				this._clear('decoder keeping up again');
			}

			return;
		}

		this._consecutiveTicks += 1;

		if (this._alertOn) return;

		// Over the budget, but not yet for long enough to be reportable.
		if (this._consecutiveTicks < this.config.minConsecutiveTicks) {
			this.trackMonitor.overloadedDecoder = false;

			return;
		}

		this._alertOn = true;
		this._startedAt = Date.now();
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.trackMonitor.overloadedDecoder = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('video-decoder-overloaded', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			decodeTimePerFrameInMs,
			frameBudgetInMs,
		});

		this.trackMonitor.issues.raise({
				key: this.issueKey,
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

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: DecoderPerformanceIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DecoderPerformanceIssuePayload),
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
