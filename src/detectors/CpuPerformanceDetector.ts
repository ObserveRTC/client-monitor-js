import { ClientMonitor } from "..";

export type CpuPerformanceIssuePayload = {
	durationInMs?: number;
}

/**
 * Detects CPU performance limitations affecting WebRTC quality.
 * 
 * This detector monitors various indicators of CPU performance issues that can
 * degrade WebRTC call quality, including quality limitation reasons, FPS volatility,
 * and stats collection duration. It uses hysteresis behavior with different
 * thresholds for alerting on and off to prevent flapping.
 * 
 * **Detection Criteria:**
 * - Outbound RTP quality limitation reason is 'cpu'
 * - FPS volatility exceeds configured thresholds (with hysteresis)
 * - Stats collection duration exceeds thresholds (indicating processing delays)
 * 
 * **Configuration Options:**
 * - `disabled`: Whether the detector is disabled (default: false)
 * - `fpsVolatilityThresholds`: High/low watermarks for FPS volatility detection
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
 * - Only considers inbound tracks with sufficient FPS (>= 10) for volatility analysis
 * - Automatically clears alert when conditions improve
 */
export class CpuPerformanceDetector {
	public static readonly ISSUE_TYPE = 'cpulimitation';

	public readonly name = 'cpu-performance-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;

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
		const { lowWatermark: lowFpsVolatility, highWatermark: highFpsVolatility } = this.config.fpsVolatilityThresholds ?? {};
		
		
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

		for (const outboundRtp of this.clientMonitor.outboundRtps) {
			gotLimited ||= outboundRtp.qualityLimitationReason === 'cpu';
		}

		if (lowFpsVolatility && highFpsVolatility) {
			for (const inboundRtp of this.clientMonitor.inboundRtps) {
				if (gotLimited) continue;
				if (!inboundRtp.fpsVolatility) continue;
				if (!inboundRtp.avgFramesPerSec || inboundRtp.avgFramesPerSec < 10) continue;
				if (isLimited) {
					gotLimited = lowFpsVolatility < inboundRtp.fpsVolatility;
				} else {
					if (highFpsVolatility < inboundRtp.fpsVolatility) {
						gotLimited = true;
					}
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

	private _raise() {
		this._startedAlertAt = Date.now();

		this.clientMonitor.raiseIssue<CpuPerformanceIssuePayload>(this.issueKey, {
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