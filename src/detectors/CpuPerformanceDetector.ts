import { ClientMonitor } from "..";

export class CpuPerformanceDetector {

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
	}
}