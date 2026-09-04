import { ClientMonitor } from "..";
import { Detector } from "./Detector";

export type CpuPerformanceIssuePayload = {
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type CpuPerformanceDetectorConfig = {
	/**
	 * Thresholds for the ratio of decoded to received frames on inbound
	 * video tracks. When the decoder cannot keep up with the incoming
	 * stream (a classic sign of CPU limitation) frames are received but
	 * never decoded, so the decoded/received ratio drops.
	 *
	 * This replaces FPS-volatility based detection, which false-triggered
	 * on content such as screen share whose frame rate legitimately swings
	 * (e.g. 15 -> 1 fps when the shared content goes static). When fps
	 * drops legitimately, received and decoded frames drop together so the
	 * ratio stays close to 1.0 and no alert fires.
	 *
	 * - `alertOn`: ratio at or below which the alert turns ON (e.g. 0.7).
	 * - `alertOff`: ratio at or above which the alert turns OFF (e.g. 0.85);
	 *   should be higher than `alertOn` to provide hysteresis.
	 * - `minReceivedFrames`: the minimum number of frames that must have
	 *   been received in an interval before the ratio is evaluated, guarding
	 *   against noise at low frame rates (e.g. 1 received, 0 decoded).
	 * - `frameArrivalBurstFactor`: burst guard against bursty frame
	 *   *arrival* being read as CPU limitation. The detector keeps a
	 *   smoothed (EWMA) frames-received-per-interval baseline per track;
	 *   an interval whose received count exceeds
	 *   `frameArrivalBurstFactor * baseline` is a burst — a simulcast
	 *   layer switch, keyframe recovery or post-stall queue flush
	 *   momentarily outpaces the decoder without the CPU being the
	 *   problem — and its ratio is skipped rather than judged. A track's
	 *   first interval (no baseline yet) is also skipped, since a fresh
	 *   consumer routinely starts with a keyframe burst. Sustained decoder
	 *   starvation still alerts because its low ratio persists across
	 *   ordinary-arrival intervals. Set to `undefined` to disable the
	 *   guard and judge every interval.
	 */
	incomingDecodedFramesRatioThresholds: {
		alertOn: number;
		alertOff: number;
		minReceivedFrames: number;
		frameArrivalBurstFactor?: number;
	};

	/**
	 * Thresholds for the duration of collecting performance stats.
	 * - `lowWatermark`: The minimum duration threshold (in milliseconds).
	 * - `highWatermark`: The maximum duration threshold (in milliseconds).
	 */
	durationOfCollectingStatsThreshold: {
		lowWatermark: number;
		highWatermark: number;
	};

	/**
	 * Share of an interval (`0..1`) an outbound video stream must spend
	 * explicitly CPU-limited, per `qualityLimitationDurations.cpu`, before
	 * that counts as CPU limitation. Corroborates the instantaneous
	 * `qualityLimitationReason`, which flickers.
	 *
	 * Set to `undefined` to skip this check.
	 */
	encoderCpuLimitationShareThreshold?: number;

	/**
	 * Fraction of the per-frame time budget that encoding one frame may
	 * consume before the encoder counts as CPU-pressured. The budget is
	 * derived from the stream's own frame rate (33ms at 30fps), so this is
	 * portable across frame rates in a way a fixed millisecond value is not.
	 *
	 * Set to `undefined` to skip this check.
	 */
	encodeTimeBudgetRatio?: number;
}

/**
 * Watches for the client machine, rather than the network, being why a call looks bad: the
 * encoder shedding resolution, the decoder falling behind, the stats loop running late. A
 * per-monitor singleton with separate on and off conditions, so the alert cannot flap.
 *
 * Four signals feed it. The browser's own `qualityLimitationReason === 'cpu'` is the most direct.
 * Encoder pressure is measured two further ways: the share of the interval the encoder spent
 * CPU-limited, and encode time per frame against the budget the stream's frame rate implies
 * (1000/fps — 33ms at 30fps). A long stats collection is a saturated main thread delaying the
 * collector, and decoded-over-received frames says whether the receive side is keeping up.
 *
 * That last is a ratio rather than frame-rate volatility, which false-triggered on screen share
 * whose fps legitimately swings 15 to 1 when content goes static — received and decoded frames
 * fall together there. Its own failure mode is a bursty *arrival*: a layer switch, a keyframe
 * recovery or a post-stall flush dumps frames into one interval and the decoder trails the spike
 * for a single tick on an idle machine. So a smoothed per-ssrc arrival rate is kept
 * and ticks exceeding `frameArrivalBurstFactor` times it are skipped — a starved decoder still
 * alerts, its ratio staying low across ticks with ordinary arrival rates.
 *
 * It refuses to judge a backgrounded tab at all, resolving any open alert — throttled timers and
 * halted rendering would read as CPU limitation on a wholly idle CPU. Tracks with too few frames,
 * or with no arrival baseline yet, are skipped rather than counted either way.
 *
 * Raises `cpulimitation`. Emits `cpulimitation`. Config: `cpuPerformanceDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Across both chains — the machine
 *
 */
export class CpuPerformanceDetector implements Detector {
	public static readonly ISSUE_TYPE = 'cpulimitation';

	/** 0.3 ≈ the last ~5 ticks dominate: the baseline follows a legitimate rate change within a few intervals, while a single-tick spike barely moves it. */
	private static readonly FRAME_ARRIVAL_EWMA_ALPHA = 0.3;

	public readonly name = 'cpu-performance-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey = CpuPerformanceDetector.ISSUE_TYPE;

	private _startedAlertAt?: number;

	private _avgDeltaFramesReceivedBySsrc = new Map<number, number>();

	public constructor(
		public readonly clientMonitor: ClientMonitor,
	) {}

	private get config() {
		return this.clientMonitor.config.cpuPerformanceDetector!;
	}


	public update() {
		if (this.disabled) return;

		if (!this.clientMonitor.activeTab) {
			if (this.clientMonitor.cpuPerformanceAlertOn) {
				this.clientMonitor.cpuPerformanceAlertOn = false;
				this._resolve('tab in background');
			}

			return;
		}

		const isLimited = this.clientMonitor.cpuPerformanceAlertOn;
		let gotLimited = false;
		const { alertOn, alertOff, minReceivedFrames, frameArrivalBurstFactor } = this.config.incomingDecodedFramesRatioThresholds ?? {};


		if (this.config.durationOfCollectingStatsThreshold) {
			const { lowWatermark, highWatermark } = this.config.durationOfCollectingStatsThreshold;

			gotLimited = (isLimited ? lowWatermark : highWatermark) < this.clientMonitor.durationOfCollectingStatsInMs;
		}

		for (const outboundRtp of this.clientMonitor.outboundRtps) {
			if (gotLimited) break;

			gotLimited ||= outboundRtp.qualityLimitationReason === 'cpu' ||
				this._checkEncoderPressure(outboundRtp);
		}

		if (alertOn !== undefined && alertOff !== undefined) {
			const minFrames = minReceivedFrames ?? 0;
			const nextAvgs = new Map<number, number>();
			const alpha = CpuPerformanceDetector.FRAME_ARRIVAL_EWMA_ALPHA;

			for (const inboundRtp of this.clientMonitor.inboundRtps) {
				if (inboundRtp.kind !== 'video') continue;

				const receivedFrames = inboundRtp.deltaFramesReceived ?? 0;
				const decodedFrames = inboundRtp.deltaFramesDecoded ?? 0;

				// updated on every tick, even ones another signal already flagged, so the guard never compares against a stale average
				const avgReceivedFrames = this._avgDeltaFramesReceivedBySsrc.get(inboundRtp.ssrc);

				nextAvgs.set(inboundRtp.ssrc, avgReceivedFrames === undefined
					? receivedFrames
					: avgReceivedFrames * (1 - alpha) + receivedFrames * alpha
				);

				if (gotLimited) continue;

				// too few frames to judge: this is what keeps legitimate fps swings (screen share 15 -> 1 fps) from alerting
				if (receivedFrames < minFrames) continue;

				if (frameArrivalBurstFactor !== undefined) {
					if (avgReceivedFrames === undefined) continue;

					// An arrival burst (layer switch, keyframe recovery, post-stall flush) outpaces the decoder
					// for a single tick without the CPU being the problem, observed on an otherwise idle machine.
					if (receivedFrames > avgReceivedFrames * frameArrivalBurstFactor) continue;
				}

				// clamp to 1: frames received in a previous interval can be decoded in this one
				const decodedRatio = Math.min(decodedFrames / receivedFrames, 1);

				if (isLimited) {
					gotLimited = decodedRatio < alertOff;
				} else if (decodedRatio <= alertOn) {
					gotLimited = true;
				}
			}

			this._avgDeltaFramesReceivedBySsrc = nextAvgs;
		}

		if (gotLimited) {
			if (isLimited) return;
			this.clientMonitor.cpuPerformanceAlertOn = true;

			this.clientMonitor.emit('cpulimitation', {
				clientMonitor: this.clientMonitor,
			});

			this._raise();

		} else {
			if (!isLimited) return;
			this.clientMonitor.cpuPerformanceAlertOn = false;
			this._resolve('cpu limitation ended');
		}
	}

	/** The encode budget per frame comes from the stream's own frame rate: 1000/fps is 33ms at 30fps. */
	private _checkEncoderPressure(outboundRtp: { kind: string, framesPerSecond?: number, encodeTimePerFrameInMs?: number, qualityLimitationDurationShares?: { cpu: number } }): boolean {
		if (outboundRtp.kind !== 'video') return false;

		const cpuShareThreshold = this.config.encoderCpuLimitationShareThreshold;
		const encodeBudgetRatio = this.config.encodeTimeBudgetRatio;

		if (cpuShareThreshold !== undefined) {
			const cpuShare = outboundRtp.qualityLimitationDurationShares?.cpu;

			if (cpuShare !== undefined && cpuShareThreshold < cpuShare) return true;
		}

		if (encodeBudgetRatio !== undefined) {
			const fps = outboundRtp.framesPerSecond;
			const encodeTimePerFrameInMs = outboundRtp.encodeTimePerFrameInMs;

			if (!fps || fps < 1 || encodeTimePerFrameInMs === undefined) return false;
			if ((1000 / fps) * encodeBudgetRatio < encodeTimePerFrameInMs) return true;
		}

		return false;
	}

	private _raise() {
		this._startedAlertAt = Date.now();

		this.clientMonitor.raiseIssue<CpuPerformanceIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: CpuPerformanceDetector.ISSUE_TYPE,
			payload: {},
		});
	}

	private _resolve(comment?: string) {
		const issue = this.clientMonitor.activeIssues.get(this.issueKey);
		let payload: CpuPerformanceIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as CpuPerformanceIssuePayload),
				durationInMs: this._startedAlertAt ? Date.now() - this._startedAlertAt : undefined,
			};
		}

		this.clientMonitor.resolveIssue<CpuPerformanceIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAlertAt = undefined;
	}
}
