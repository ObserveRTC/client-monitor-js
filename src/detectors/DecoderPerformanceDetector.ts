import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type DecoderPerformanceIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Wall-clock decode cost per frame in the interval, in milliseconds. */
	decodeTimePerFrameInMs?: number;
	/** The per-frame budget this was compared against, in milliseconds. */
	frameBudgetInMs?: number;
	/** Δ`framesDropped` / Δ`framesReceived` in the interval. */
	dropRatio?: number;
	/** Δ`framesRendered` / Δ`framesDecoded` in the interval. */
	renderRatio?: number;
	framesReceived: number;
	decoderImplementation?: string;
	powerEfficientDecoder?: boolean;
	consecutiveTicks: number;
	durationInMs?: number;
}

/**
 * Decoder Performance Detector
 *
 * The receive-side sibling of CPU limitation, and the piece that makes
 * network-versus-client attribution possible at all.
 *
 * **The distinction this exists for:** frames dropped because they never
 * arrived and frames dropped because the client could not decode them look
 * identical in a frame-rate chart, and the fixes are opposite. So this detector
 * fires only when the frames demonstrably *did* arrive:
 *
 * - frames arrived at a healthy rate (`framesReceived` above the minimum), and
 * - the network was quiet (loss below `quietLossThreshold`), and
 * - decode time per frame exceeded the frame budget, or frames were dropped
 *   after arriving.
 *
 * Rising loss with rising PLI is the *other* story — that is the network, and
 * `FreezedVideoTrackDetector` covers it. Both firing at once is the honest answer
 * when both are true.
 *
 * **Issues created:**
 * - Type: `video-decoder-overloaded`
 */
export class DecoderPerformanceDetector implements Detector {
	public static readonly ISSUE_TYPE = 'video-decoder-overloaded';
	public readonly name = 'decoder-performance-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
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

		const framesReceived = inboundRtp.deltaFramesReceived ?? 0;

		// too few frames to judge (e.g. a static screen share)
		if (framesReceived < this.config.minFramesReceived) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('not enough frames to evaluate') : undefined;
		}

		// do not blame the decoder for frames that never made it
		const fractionLost = inboundRtp.deltaFractionLost ?? 0;

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
