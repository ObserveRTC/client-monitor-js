import { ClientMonitor } from "..";

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
 * - `createIssue`: Whether to create an issue when CPU limitation is detected
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

	public constructor(
		public readonly clientMonitor: ClientMonitor,
	) {
	}

	private get config() {
		return this.clientMonitor.config.cpuPerformanceDetector;
	}


	public update() {
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

			if (this.config.createIssue) {
				this.clientMonitor.addIssue({
					type: CpuPerformanceDetector.ISSUE_TYPE,
				});
			}

		} else {
			if (!isLimited) return;
			this.clientMonitor.cpuPerformanceAlertOn = false;
			this._resolveIssue();
		}
	}

	private _resolveIssue() {
		const clientMonitor = this.clientMonitor;

		return clientMonitor.resolveActiveIssues(CpuPerformanceDetector.ISSUE_TYPE, () => true);
	}
}