/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";

/**
 * The shipped window defaults, checked at the collecting periods a deployment might actually use.
 *
 * The windows are counted in values, so a full one is readable at any cadence; what the collecting
 * period decides is the stretch those values cover. These assertions are on both halves of that:
 * that every default is a window that can measure, and that the count still comes to roughly the
 * span it was chosen to represent.
 */
describe('the shipped detection/recovery window defaults', () => {
	const PERIODS = [ 1000, 2000, 3000, 5000, 8000, 10_000 ];

	const configs = (collectingPeriodInMs: number) => {
		const monitor = new ClientMonitor({
			collectingPeriodInMs,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);

		try {
			return {
				outbound: monitor.config.outboundTrackDetectionRecoveryWindow,
				inbound: monitor.config.inboundTrackDetectionRecoveryWindow,
				peerConnection: monitor.config.peerConnectionDetectionRecoveryWindow,
			};
		} finally {
			monitor.close();
		}
	};

	describe.each(PERIODS)('at a %pms collecting period', (period) => {
		it.each([ 'outbound', 'inbound', 'peerConnection' ] as const)(
			'gives %s a window that can be differenced in both halves',
			(which) => {
				const config = configs(period)[which];

				expect(config.numberOfDetectionSamples)
					.toBeGreaterThanOrEqual(DetectionRecoveryWindow.MIN_SAMPLES);
				expect(config.numberOfRecoverySamples)
					.toBeGreaterThanOrEqual(DetectionRecoveryWindow.MIN_SAMPLES);
				// Every default is a real window, and the class refuses anything that is not.
				expect(() => new DetectionRecoveryWindow(config)).not.toThrow();
			},
		);

		// A gap guard shorter than the cadence would discard every collection as a blackout.
		it('allows a gap wider than one collection everywhere', () => {
			for (const config of Object.values(configs(period))) {
				expect(config.maxAllowedGapInMs).toBeGreaterThan(period);
			}
		});
	});

	/**
	 * The failing case from the captured call, stated as the property that now holds: a
	 * five-second cadence used to leave the peer connection's recovery half holding one value, so
	 * `transport-delay-degraded` could be raised and never resolved.
	 */
	it('gives the peer connection a readable recovery half at the five-second cadence that broke it', () => {
		const { peerConnection } = configs(5000);

		expect(peerConnection.numberOfRecoverySamples).toBeGreaterThanOrEqual(2);
	});

	// The counts are chosen to preserve the spans the durations used to name, so a detector's
	// thresholds still mean what they meant when they were tuned.
	it('keeps the inbound window near the 15s and 10s spans it was tuned for', () => {
		for (const period of PERIODS) {
			const { inbound } = configs(period);
			const detectionSpan = (inbound.numberOfDetectionSamples - 1) * period;
			const recoverySpan = (inbound.numberOfRecoverySamples - 1) * period;

			expect(detectionSpan).toBeGreaterThanOrEqual(Math.min(15_000, period));
			expect(recoverySpan).toBeGreaterThanOrEqual(Math.min(10_000, period));
			expect(detectionSpan).toBeLessThanOrEqual(15_000 + period);
		}
	});
});
