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
 * **Configuration Options:**
 * - `disabled`: Whether the detector is disabled (default: false)
 * - `incomingDecodedFramesRatioThresholds`: alertOn/alertOff ratios and a
 *   minReceivedFrames guard for inbound decode-keep-up detection
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
 * - Automatically clears alert when conditions improve
 */
export class CpuPerformanceDetector {
	public static readonly ISSUE_TYPE = 'cpulimitation';

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

	public constructor(
		public readonly clientMonitor: ClientMonitor,
	) {}

	private get config() {
		return this.clientMonitor.config.cpuPerformanceDetector!;
	}


	public update() {
		if (this.disabled) return;
		const isLimited = this.clientMonitor.cpuPerformanceAlertOn;
		let gotLimited = false;
		const { alertOn, alertOff, minReceivedFrames } = this.config.incomingDecodedFramesRatioThresholds ?? {};


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

		if (!gotLimited && alertOn !== undefined && alertOff !== undefined) {
			const minFrames = minReceivedFrames ?? 0;
			for (const inboundRtp of this.clientMonitor.inboundRtps) {
				if (gotLimited) break;
				// Decode CPU limitation only applies to video tracks.
				if (inboundRtp.kind !== 'video') continue;

				const receivedFrames = inboundRtp.deltaFramesReceived ?? 0;
				const decodedFrames = inboundRtp.deltaFramesDecoded ?? 0;

				// Not enough frames this interval to make a reliable judgement.
				// This is what makes the detector robust to legitimate fps swings
				// (e.g. screen share dropping from 15 to 1 fps): a low frame count
				// is simply skipped rather than treated as a problem.
				if (receivedFrames < minFrames) continue;

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