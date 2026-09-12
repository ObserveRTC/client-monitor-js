/* eslint-disable @typescript-eslint/no-explicit-any */
import { DefaultScoreCalculator } from "../../src/scores/DefaultScoreCalculator";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { stubClientIssues } from "../helpers/detectorMocks";

/**
 * What each component's faults cost, at the values the calculator charges them.
 *
 * Every charge here is written the same way and this file pins that shape as much as the numbers:
 * a reason named after an issue type is charged only while that issue is open, a reason with no
 * issue behind it is a continuous reading charged on its own, and nothing is listed at `0`.
 */
const MAX = DefaultScoreCalculator.MAX_SCORE;

function inboundTrack(kind: 'audio' | 'video', fields: Record<string, unknown> = {}) {
	const inboundRtp: Record<string, unknown> = {};
	const track = {
		direction: 'inbound',
		kind,
		issues: new IssueRegistry(stubClientIssues().asSink),
		calculatedScore: { weight: 1 } as any,
		getInboundRtp: () => inboundRtp,
		isScreenShare: false,
		...fields,
	};

	return { track, inboundRtp };
}

function outboundTrack(kind: 'audio' | 'video', fields: Record<string, unknown> = {}) {
	return {
		direction: 'outbound',
		kind,
		issues: new IssueRegistry(stubClientIssues().asSink),
		calculatedScore: { weight: 1 } as any,
		isScreenShare: false,
		getOutboundRtps: () => [],
		getMediaSource: () => undefined,
		...fields,
	};
}

/** Scores one connection in isolation: no tracks, no client score, just the charge. */
function scoreOfConnection(pcMonitor: unknown) {
	const calculator = new DefaultScoreCalculator({
		config: {
			uplinkCongestionDetector: { minSeverity: 0.65 },
			downlinkCongestionDetector: { minSeverity: 0.65 },
		},
		peerConnections: [ pcMonitor ],
		mappedPeerConnections: new Map([ [ 'pc-1', pcMonitor ] ]),
		tracks: [],
		setScore() { /* not what this file is about */ },
	} as any);

	calculator.update();

	return (pcMonitor as any).calculatedStabilityScore as { value?: number, reasons?: Record<string, number> };
}

function peerConnection(fields: Record<string, unknown> = {}) {
	return {
		issues: new IssueRegistry(stubClientIssues().asSink),
		calculatedStabilityScore: { weight: 1 } as any,
		uplinkVideoCongestionSeverity: undefined as number | undefined,
		downlinkVideoCongestionSeverity: undefined as number | undefined,
		transportStability: undefined as number | undefined,
		...fields,
	};
}

/** Scores one track in isolation: no peer connection, no client score, just the charge. */
function scoreOf(track: unknown) {
	const calculator = new DefaultScoreCalculator({
		peerConnections: [],
		mappedPeerConnections: new Map(),
		tracks: [ track ],
		setScore() { /* not what this file is about */ },
	} as any);

	calculator._calculateTrackScore(track as any);

	return (track as any).calculatedScore as { value?: number, reasons?: Record<string, number> };
}

const raise = (track: any, type: string) =>
	track.issues.raise({ key: `${type}-t`, type, payload: {} } as any);

describe('inbound video charges', () => {
	/**
	 * Packets arriving with no complete frame coming out: nothing reaches the screen, so it costs
	 * the whole scale — the same statement `stuck-decoder` and `dry-inbound-track` already make
	 * one stage away.
	 */
	it('takes the score to zero on frame-assembly-stalled', () => {
		const { track } = inboundTrack('video');

		raise(track, 'frame-assembly-stalled');

		const score = scoreOf(track);

		expect(score.value).toBe(DefaultScoreCalculator.MIN_SCORE);
		expect(score.reasons?.['frame-assembly-stalled']).toBe(MAX);
	});

	/**
	 * The receiving mirror of `encoder-bottleneck`, and priced the same way: the published reading
	 * rather than the payload, at `* 2`, so half the frames not getting through costs one point.
	 */
	it('charges decoder-bottleneck twice the share of frames the decoder missed', () => {
		const { track } = inboundTrack('video', { decodingDegradation: 0.5 });

		raise(track, 'decoder-bottleneck');

		expect(scoreOf(track).reasons?.['decoder-bottleneck']).toBeCloseTo(1, 6);
	});

	it('charges nothing for a decoder bottleneck no detector raised', () => {
		const { track } = inboundTrack('video', { decodingDegradation: 0.9 });

		const score = scoreOf(track);

		expect(score.value).toBe(MAX);
		expect(score.reasons).toBeUndefined();
	});

	/** One point rather than two: frames are still getting through, so it is the softer fault. */
	it('ramps video-decoder-overloaded across the decode budget', () => {
		const { track } = inboundTrack('video', { decodeBudgetUtilization: 1.0 });

		raise(track, 'video-decoder-overloaded');

		expect(scoreOf(track).reasons?.['video-decoder-overloaded']).toBeCloseTo(1, 6);
	});

	it('charges a decoder inside its budget nothing, even with the finding open', () => {
		const { track } = inboundTrack('video', { decodeBudgetUtilization: 0.8 });

		raise(track, 'video-decoder-overloaded');

		// The finding still publishes its reasons, but this reading contributed nothing to them.
		expect(scoreOf(track).reasons?.['video-decoder-overloaded']).toBeUndefined();
	});

	it('charges the playout discrepancy what was thrown away', () => {
		const { track } = inboundTrack('video', { videoPlayoutSkew: 0.4 });

		raise(track, 'inbound-video-playout-discrepancy');

		expect(scoreOf(track).reasons?.['inbound-video-playout-discrepancy']).toBeCloseTo(0.4, 6);
	});
});

/**
 * The detector's verdict and the quantizer reading behind it used to be independent — the detector
 * raised `pixelated-video` and the score charged `blocky-video` from the same number without either
 * knowing about the other. They are one charge in two tiers now.
 */
describe('pixelated video', () => {
	it('charges the sub-threshold ramp while no finding is open', () => {
		const { track } = inboundTrack('video', {
			quantizationDegradation: 0.4,
			displayMagnification: 1,
		});

		const score = scoreOf(track);

		expect(score.value).toBeCloseTo(MAX - 0.4, 6);
		// Under a point and with no finding open, so the score carries it and `reasons` does not:
		// a charge that did not move the score by a point is not something to act on.
		expect(score.reasons).toBeUndefined();
	});

	it('charges the finding instead, and by more, once the detector speaks', () => {
		const { track } = inboundTrack('video', {
			quantizationDegradation: 0.4,
			displayMagnification: 1,
		});

		raise(track, 'pixelated-video');

		const reasons = scoreOf(track).reasons;

		expect(reasons?.['pixelated-video']).toBeCloseTo(0.4 * (MAX / 2), 6);
		expect(reasons?.['blocky-video']).toBeUndefined();
	});

	/** Blown up it costs more, in a thumbnail far less. The weight saturates rather than uncapping. */
	it('weights the charge by how large the picture is shown', () => {
		const large = inboundTrack('video', { quantizationDegradation: 0.4, displayMagnification: 2 });
		const small = inboundTrack('video', { quantizationDegradation: 0.4, displayMagnification: 0.5 });

		expect(scoreOf(large.track).value).toBeCloseTo(MAX - 0.6, 6);
		expect(scoreOf(small.track).value).toBeCloseTo(MAX - 0.1, 6);
	});

	/** The weight saturates rather than uncapping: nothing is worse than unwatchable. */
	it('does not let the large-picture weight exceed the ramp it scales', () => {
		const { track } = inboundTrack('video', {
			quantizationDegradation: 0.9,
			displayMagnification: 2,
		});

		expect(scoreOf(track).value).toBeCloseTo(MAX - 1, 6);
	});

	it('leaves pixelation out entirely where the quantizer was never reported', () => {
		const { track } = inboundTrack('video');

		const score = scoreOf(track);

		expect(score.value).toBe(MAX);
		expect(score.reasons).toBeUndefined();
	});
});

/**
 * Inbound audio was a flat 5.0 right up to the collection its detector spoke on, where inbound
 * video has had continuous ramps all along.
 */
describe('inbound audio charges', () => {
	it('ramps on a filling invented-speech bucket before any finding', () => {
		const { track } = inboundTrack('audio', { inventedSpeechSeverity: 0.625 });

		// Halfway between the activation and the raise point, so half a point off a flat 5.0.
		expect(scoreOf(track).value).toBeCloseTo(MAX - 0.5, 6);
	});

	it('charges nothing for a bucket below the activation', () => {
		const { track } = inboundTrack('audio', { inventedSpeechSeverity: 0.1 });

		const score = scoreOf(track);

		expect(score.value).toBe(MAX);
		expect(score.reasons).toBeUndefined();
	});

	it('hands over to the finding once the detector raises', () => {
		const { track, inboundRtp } = inboundTrack('audio', { inventedSpeechSeverity: 1 });

		inboundRtp.inventedSpeechRatio = 0.3;
		raise(track, 'invented-speech');

		const reasons = scoreOf(track).reasons;

		expect(reasons?.['invented-speech']).toBeCloseTo(0.3, 6);
		expect(reasons?.['unstable-audio-playout']).toBeUndefined();
	});
});

/**
 * The two outbound quality ramps are the same statement about the same track — the encoder did not
 * deliver what the content needed — and only one of them can apply, so the branch a track happens
 * to take must not decide how much its quality is allowed to cost.
 */
describe('outbound video quality ramps', () => {
	it('charges a saturated screenshare downscale the same as a saturated bitrate shortfall', () => {
		const camera = outboundTrack('video', {
			highestLayer: { targetBitrate: 1000 },
			getOutboundRtps: () => [ { payloadBitrate: 800 } ],
		});
		const screenShare = outboundTrack('video', {
			isScreenShare: true,
			highestLayer: { frameWidth: 100, frameHeight: 100 },
			getMediaSource: () => ({ width: 1000, height: 1000 }),
		});

		// Both ramps saturated: a fifth under target, and nine tenths of the area gone.
		expect(scoreOf(camera).value).toBeCloseTo(MAX - 1, 6);
		expect(scoreOf(screenShare).value).toBeCloseTo(MAX - 1, 6);
	});
});

/**
 * A congestion episode opens at `minSeverity` and closes on the browser's bandwidth verdict, never
 * on severity — so the published reading spends most of an open episode under the bar that opened
 * it. It is right to sag; the charge is not, because the verdict has not changed.
 */
describe('congestion charges', () => {
	const HALF = MAX / 2;

	it('scales with severity up to half the scale', () => {
		const pc = peerConnection({ uplinkVideoCongestionSeverity: 1 });

		pc.issues.raise({ key: 'uplink-congestion-pc-1', type: 'uplink-congestion', payload: {} } as any);

		expect(scoreOfConnection(pc).reasons?.['uplink-congestion']).toBeCloseTo(HALF, 6);
	});

	it('never charges an open episode less than the severity that opened it', () => {
		const sagged = peerConnection({ uplinkVideoCongestionSeverity: 0.2 });

		sagged.issues.raise({ key: 'uplink-congestion-pc-1', type: 'uplink-congestion', payload: {} } as any);

		expect(scoreOfConnection(sagged).reasons?.['uplink-congestion']).toBeCloseTo(0.65 * HALF, 6);
	});

	it('floors the downlink side the same way', () => {
		const pc = peerConnection({ downlinkVideoCongestionSeverity: 0 });

		pc.issues.raise({ key: 'downlink-congestion-pc-1', type: 'downlink-congestion', payload: {} } as any);

		expect(scoreOfConnection(pc).reasons?.['downlink-congestion']).toBeCloseTo(0.65 * HALF, 6);
	});

	it('charges nothing at all while no episode is open', () => {
		const pc = peerConnection({ uplinkVideoCongestionSeverity: 0.9 });

		const score = scoreOfConnection(pc);

		expect(score.value).toBe(MAX);
		expect(score.reasons).toBeUndefined();
	});
});
