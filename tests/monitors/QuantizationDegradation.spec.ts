/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

/**
 * `InboundTrackMonitor.quantizationDegradation`: the mean quantizer scaled across the band between
 * a clean picture and a fully coarse one, derived once per collection and published whether or not
 * `PixelatedVideoDetector` is enabled.
 *
 * Not to be confused with `decodingDegradation` beside it, which is the frames that arrived and
 * never came out of the decoder. This one is the sender's quantizer, observed here.
 *
 * The reading it is built from, `InboundRtpMonitor.normalizedQp`, is already a fraction of the
 * codec's own scale, so these assertions are in those fractions rather than in raw quantizers.
 */
function createTrack(normalizedQp?: number) {
	const inboundRtp = {
		normalizedQp,
		kind: 'video',
		statsClockTime: 0,
		getMediaPlayout: () => undefined,
		getPeerConnection: () => ({
			peerConnectionId: 'pc-1',
			parent: {
				config: {
					inboundTrackWindow: {
						numberOfSamples: { detection: 2, recovery: 2, flowDetection: 4, flowRecovery: 3 },
						maxAllowedGapInMs: 60_000,
					},
				},
				activeIssues: { asSink: { notify() { /* */ } } },
			},
		}),
	};

	return new InboundTrackMonitor({ id: 't-1', kind: 'video' } as any, inboundRtp as any);
}

/** `update()` drags in the detectors; the derivation is what this file is about. */
function refresh(monitor: InboundTrackMonitor) {
	(monitor as unknown as { _refreshQuantizationDegradation(): void })._refreshQuantizationDegradation();

	return monitor.quantizationDegradation;
}

describe('InboundTrackMonitor.quantizationDegradation', () => {
	const { CLEAN_QP_RATIO: clean, COARSE_QP_RATIO: coarse } = InboundTrackMonitor;

	// Not zero: a track whose browser does not report `qpSum` is not thereby a track with a clean
	// picture, and a consumer testing `=== undefined` must be able to tell the two apart.
	it('reads undefined where the quantizer could not be read', () => {
		expect(refresh(createTrack(undefined))).toBeUndefined();
	});

	it('is zero at and below the clean end of the band', () => {
		expect(refresh(createTrack(clean))).toBe(0);
		expect(refresh(createTrack(clean - 0.2))).toBe(0);
	});

	it('is one at and above the coarse end of the band', () => {
		expect(refresh(createTrack(coarse))).toBe(1);
		expect(refresh(createTrack(coarse + 0.15))).toBe(1);
	});

	it('rises linearly between the two', () => {
		const middle = (clean + coarse) / 2;

		expect(refresh(createTrack(middle))).toBeCloseTo(0.5, 10);
		expect(refresh(createTrack(clean + ((coarse - clean) * 0.25)))).toBeCloseTo(0.25, 10);
	});

	/**
	 * The polarity, pinned because it is the reverse of QP's own: a *low* quantizer is good video,
	 * so this reads low for a clean picture. It composes as a subtraction, and reading it as a
	 * quality figure would invert every score that uses it.
	 */
	it('reads higher the coarser the picture, not the other way round', () => {
		const cleaner = refresh(createTrack(clean + 0.05)) as number;
		const coarser = refresh(createTrack(coarse - 0.05)) as number;

		expect(cleaner).toBeLessThan(coarser);
	});
});
