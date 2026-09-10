/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { SlicedWindow } from "../../src/utils/SlicedWindow";

/**
 * The shipped window defaults, checked at the collecting periods a deployment might actually use.
 *
 * The slices are counted in values, so a full one is readable at any cadence; what the collecting
 * period decides is the stretch those values cover. These assertions are on both halves of that:
 * that every default is a slice that can measure, and that the count still comes to roughly the
 * span it was chosen to represent.
 */
describe('the shipped window defaults', () => {
	const PERIODS = [ 1000, 2000, 3000, 5000, 8000, 10_000 ];
	const WINDOWS = [ 'outbound', 'inbound', 'peerConnection' ] as const;

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
				outbound: monitor.config.outboundTrackWindow,
				inbound: monitor.config.inboundTrackWindow,
				peerConnection: monitor.config.peerConnectionWindow,
			};
		} finally {
			monitor.close();
		}
	};

	describe.each(PERIODS)('at a %pms collecting period', (period) => {
		it.each(WINDOWS)('gives %s a slice that can be differenced for every stretch it names', (which) => {
			const config = configs(period)[which];

			for (const numberOfSamples of Object.values(config.numberOfSamples)) {
				expect(numberOfSamples).toBeGreaterThanOrEqual(SlicedWindow.MIN_SAMPLES);
			}
		});

		// A gap guard shorter than the cadence would discard every collection as a blackout.
		it('allows a gap wider than one collection everywhere', () => {
			for (const config of Object.values(configs(period))) {
				expect(config.maxAllowedGapInMs).toBeGreaterThan(period);
			}
		});

		/**
		 * Left out of the config on purpose: a window derives its capacity from the slices
		 * declared on it, so a buffer too small to fill its own slices is not something a
		 * deployment can configure into existence.
		 */
		it.each(WINDOWS)('leaves the %s capacity to be derived from the slices', (which) => {
			expect((configs(period)[which] as { capacity?: number }).capacity).toBeUndefined();
		});
	});

	/**
	 * The failing case from the captured call, stated as the property that now holds: a
	 * five-second cadence used to leave the peer connection's recovery half holding one value, so
	 * `transport-delay-degraded` could be raised and never resolved.
	 */
	it('gives the peer connection a readable recovery slice at the five-second cadence that broke it', () => {
		const { peerConnection } = configs(5000);

		expect(peerConnection.numberOfSamples.recovery).toBeGreaterThanOrEqual(2);
	});

	// The counts are chosen to preserve the spans the durations used to name, so a detector's
	// thresholds still mean what they meant when they were tuned.
	it('keeps the inbound slices near the 15s and 10s spans they were tuned for', () => {
		for (const period of PERIODS) {
			const { inbound } = configs(period);
			const detectionSpan = (inbound.numberOfSamples.detection - 1) * period;
			const recoverySpan = (inbound.numberOfSamples.recovery - 1) * period;

			expect(detectionSpan).toBeGreaterThanOrEqual(Math.min(15_000, period));
			expect(recoverySpan).toBeGreaterThanOrEqual(Math.min(10_000, period));
			expect(detectionSpan).toBeLessThanOrEqual(15_000 + period);
		}
	});
});
