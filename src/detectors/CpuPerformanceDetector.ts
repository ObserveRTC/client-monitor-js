import { ClientMonitor } from "..";

export type CpuPerformanceIssuePayload = {
	durationInMs?: number;
}

/**
 * Detects CPU performance limitations affecting WebRTC quality.
 *
 * This detector monitors various indicators of CPU performance issues that can
 * degrade WebRTC call quality, including quality limitation reasons, the inbound
 * decoded/received frames ratio, and stats collection duration. It uses
 * hysteresis behavior with different thresholds for alerting on and off to
 * prevent flapping.
 *
 * **Detection Criteria:**
 * - Outbound RTP quality limitation reason is 'cpu'
 * - Inbound decoded/received frames ratio falls below the configured thresholds
 *   (with hysteresis) — i.e. the decoder cannot keep up with received frames
 * - Stats collection duration exceeds thresholds (indicating processing delays)
 *
 * **Why not FPS volatility:** frame-rate volatility false-triggered on content
 * such as screen share, whose fps legitimately swings (e.g. 15 -> 1 fps when the
 * shared content goes static). The decoded/received ratio is robust to this
 * because received and decoded frames drop together when fps drops legitimately.
 *
 * **Why the burst guard:** the decoded/received ratio also false-triggered on
 * bursty frame *arrival* — a simulcast layer switch, a keyframe recovery or a
 * post-stall queue flush delivers a pile of frames inside one collect interval,
 * and the decoder trails that spike for a single tick without the CPU being the
 * problem (LIV-1595: repeated one-tick ratio dips on an idle M4 Pro, each
 * coinciding with a resolution change and recovering to ~1.0 on the next tick).
 * The detector therefore tracks a smoothed per-track arrival rate and skips the
 * ratio evaluation on any tick whose arrival spikes above
 * `frameArrivalBurstFactor` times that rate. A genuinely CPU-starved decoder
 * still alerts: its ratio stays low across ticks with *ordinary* arrival rates,
 * which the guard never skips.
 *
 * **Configuration Options:**
 * - `disabled`: Whether the detector is disabled (default: false)
 * - `incomingDecodedFramesRatioThresholds`: alertOn/alertOff ratios, a
 *   minReceivedFrames guard, and a frameArrivalBurstFactor guard for inbound
 *   decode-keep-up detection
 * - `durationOfCollectingStatsThreshold`: High/low watermarks for stats collection duration
 *
 * **Events Emitted:**
 * - `cpulimitation`: Emitted when CPU performance limitation is detected
 *
 * **Usage Example:**
 * ```typescript
 * const detector = new CpuPerformanceDetector(clientMonitor);
 *
 * clientMonitor.on('cpulimitation', (event) => {
 *   console.log('CPU performance limitation detected');
 *   // Take action to reduce CPU load
 * });
 * ```
 *
 * **Behavior:**
 * - Uses hysteresis to prevent alert flapping
 * - Monitors multiple CPU performance indicators simultaneously
 * - Only considers inbound video tracks with enough received frames in the
 *   interval (>= `minReceivedFrames`) for the decoded/received ratio analysis
 * - Skips the ratio analysis on frame-arrival bursts (see above)
 * - Automatically clears alert when conditions improve
 */
export class CpuPerformanceDetector {
	public static readonly ISSUE_TYPE = 'cpulimitation';

	/**
	 * Smoothing factor of the per-track exponentially weighted moving average
	 * of frames received per tick, which the burst guard measures spikes
	 * against. 0.3 ≈ the last ~5 ticks dominate the average, so the baseline
	 * adapts to a legitimate rate change within a few intervals while a
	 * single-tick spike barely moves it.
	 */
	private static readonly FRAME_ARRIVAL_EWMA_ALPHA = 0.3;

	public readonly name = 'cpu-performance-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	/**
	 * CPU limitation is a per-monitor singleton, so the key is a constant
	 * derived from the issue type.
	 */
	private readonly issueKey = CpuPerformanceDetector.ISSUE_TYPE;

	/** Timestamp when the current CPU-limited episode started. */
	private _startedAlertAt?: number;

	/**
	 * Smoothed frames-received-per-tick per inbound video track (keyed by
	 * ssrc). Rebuilt every update from the tracks seen on that tick, so
	 * entries of removed tracks never linger.
	 */
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
			// A background tab is throttled by the browser: stats collection runs
			// late, rendering stops and decoding slows down — every signal below
			// would read as CPU limitation without the CPU being the problem.
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

			if (isLimited) {
				gotLimited = lowWatermark < this.clientMonitor.durationOfCollectingStatsInMs;
			} else {
				if (highWatermark < this.clientMonitor.durationOfCollectingStatsInMs) {
					gotLimited = true;
				}
			}
		}

		// one pass: the outboundRtps getter allocates a fresh array per access
		for (const outboundRtp of this.clientMonitor.outboundRtps) {
			if (gotLimited) break;

			gotLimited = outboundRtp.qualityLimitationReason === 'cpu' ||
				this._checkEncoderPressure(outboundRtp);
		}

		if (alertOn !== undefined && alertOff !== undefined) {
			const minFrames = minReceivedFrames ?? 0;
			const nextAvgs = new Map<number, number>();
			const alpha = CpuPerformanceDetector.FRAME_ARRIVAL_EWMA_ALPHA;

			for (const inboundRtp of this.clientMonitor.inboundRtps) {
				// Decode CPU limitation only applies to video tracks.
				if (inboundRtp.kind !== 'video') continue;

				const receivedFrames = inboundRtp.deltaFramesReceived ?? 0;
				const decodedFrames = inboundRtp.deltaFramesDecoded ?? 0;

				// The arrival baseline is maintained for every video track on
				// every tick — including ticks where another signal already
				// flagged limitation — so the burst guard never compares
				// against a stale average.
				const avgReceivedFrames = this._avgDeltaFramesReceivedBySsrc.get(inboundRtp.ssrc);

				nextAvgs.set(inboundRtp.ssrc, avgReceivedFrames === undefined
					? receivedFrames
					: avgReceivedFrames * (1 - alpha) + receivedFrames * alpha
				);

				if (gotLimited) continue;

				// Not enough frames this interval to make a reliable judgement.
				// This is what makes the detector robust to legitimate fps swings
				// (e.g. screen share dropping from 15 to 1 fps): a low frame count
				// is simply skipped rather than treated as a problem.
				if (receivedFrames < minFrames) continue;

				if (frameArrivalBurstFactor !== undefined) {
					// First sight of this track: no arrival baseline yet, and the
					// first interval of a fresh consumer routinely carries a
					// keyframe burst — skip the ratio judgement this tick.
					if (avgReceivedFrames === undefined) continue;

					// Frame-arrival burst (layer switch, keyframe recovery,
					// post-stall queue flush): frames momentarily outpace the
					// decoder without the CPU being the problem — skip.
					if (receivedFrames > avgReceivedFrames * frameArrivalBurstFactor) continue;
				}

				// Ratio of frames the decoder kept up with. Clamp to 1.0 because
				// decoded can briefly exceed received due to counter timing
				// (frames received in a previous interval decoded in this one).
				const decodedRatio = Math.min(decodedFrames / receivedFrames, 1);

				if (isLimited) {
					// Already alerting: stay alerting until we recover above the
					// alert-off ratio (hysteresis).
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

	/**
	 * Encoder-side CPU pressure: a meaningful share of the interval spent
	 * explicitly CPU-limited, or encode time per frame past a budget derived
	 * from the stream's own frame rate. Unlike the instantaneous
	 * `qualityLimitationReason` label these are sustained by construction.
	 */
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
