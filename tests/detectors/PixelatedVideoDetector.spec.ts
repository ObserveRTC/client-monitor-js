/* eslint-disable @typescript-eslint/no-explicit-any */
import { PixelatedVideoDetector } from "../../src/detectors/PixelatedVideoDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

/**
 * Fractions of the codec's own quantizer scale, which is what the detector thresholds. Coarse is
 * *high* here: the reading is the quantizer, and a high quantizer is what a blocky picture is made
 * of. That is the reverse of `bitPerPixel`, which this detector used to read.
 */
const CONFIG = {
	threshold: 0.62,
	recoveryThreshold: 0.52,
	durationInMs: 8000,
};

/** A quantizer well past the bar, and one comfortably under it. */
const COARSE = 0.8;
const CLEAN = 0.2;
/** Between the two thresholds: neither coarse enough to raise nor clean enough to clear. */
const IN_BAND = 0.57;

const ISSUE_TYPE = 'pixelated-video';
const ISSUE_KEY = `${ISSUE_TYPE}-track-video-track-1`;

/**
 * `InboundTrackMonitor` only knows a received track is a screen share if the application declared
 * it, so a spec just says which it is.
 */
class MockVideoTrackMonitor extends MockInboundTrackMonitor {
	public isScreenShare = false;
}

function setup(kind = 'video') {
	const trackMonitor = new MockVideoTrackMonitor(kind);
	const clientMonitor: MockClientMonitor = trackMonitor.getPeerConnection().parent;

	clientMonitor.config.pixelatedVideoDetector = { ...CONFIG };

	const inboundRtp: Record<string, unknown> = {
		kind,
		frameWidth: 1280,
		frameHeight: 720,
		framesPerSecond: 30,
		normalizedQp: undefined,
		avgQpPerFrame: undefined,
		deltaTime: undefined,
		getCodec: () => ({ mimeType: 'video/VP8' }),
	};

	trackMonitor.setInboundRtp(inboundRtp);

	const detector = new PixelatedVideoDetector(trackMonitor as any);

	/**
	 * One collection. `normalizedQp` is what `InboundRtpMonitor` derives from `qpSum` and the
	 * codec's scale; `undefined` is a browser that reported no `qpSum`, or a codec whose scale is
	 * not known. The duration comes off the RTP monitor's clock and never off the wall clock.
	 */
	const tick = (normalizedQp: number | undefined, deltaTime = 2000) => {
		inboundRtp.normalizedQp = normalizedQp;
		// VP8's scale, so the payload's raw figure and its fraction agree with each other.
		inboundRtp.avgQpPerFrame = normalizedQp === undefined ? undefined : normalizedQp * 127;
		inboundRtp.deltaTime = deltaTime;
		detector.update();
	};

	/** Four collections of 2s each is exactly the 8s the config asks for. */
	const raise = () => {
		for (let i = 0; i < 4; ++i) tick(COARSE);
	};

	return { detector, trackMonitor, clientMonitor, inboundRtp, tick, raise };
}

describe('PixelatedVideoDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('pixelated-video-detector');
	});

	it('raises once the picture has stayed coarse for the whole duration', () => {
		const { clientMonitor, raise } = setup();

		raise();

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			trackId: 'video-track-1',
			normalizedQp: COARSE,
			avgQpPerFrame: COARSE * 127,
			mimeType: 'video/VP8',
			frameWidth: 1280,
			frameHeight: 720,
			framesPerSecond: 30,
			sustainedForInMs: 8000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)[0]?.payload.normalizedQp).toBe(COARSE);
	});

	// The payload carries both the fraction and the codec's own units, because neither is
	// interpretable without the other.
	it('reports the quantizer in the codec units it was measured in', () => {
		const { clientMonitor, inboundRtp, tick } = setup();

		inboundRtp.getCodec = () => ({ mimeType: 'video/H264' });
		for (let i = 0; i < 4; ++i) tick(0.7);

		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.mimeType).toBe('video/H264');
	});

	it('does not raise one tick short of the duration', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 3; ++i) tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('holds the current state while the quantizer sits between the two thresholds', () => {
		const { clientMonitor, tick, raise } = setup();

		// Above recovery, below the bar: nothing accumulates, so a picture parked in the band
		// never raises however long it sits there.
		for (let i = 0; i < 10; ++i) tick(IN_BAND);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		raise();
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// Back into the band with the issue open: it must stay open.
		for (let i = 0; i < 5; ++i) tick(IN_BAND);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// Only a quantizer genuinely below the recovery threshold clears it.
		tick(CONFIG.recoveryThreshold - 0.001);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
	});

	it('counts a picture sitting exactly on the threshold as coarse', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 4; ++i) tick(CONFIG.threshold);

		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('resolves once the picture gets its quality back, saying how long it lasted', () => {
		const { clientMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		tick(CLEAN);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('picture quality recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			trackId: 'video-track-1',
			normalizedQp: COARSE,
			avgQpPerFrame: COARSE * 127,
			mimeType: 'video/VP8',
			frameWidth: 1280,
			frameHeight: 720,
			framesPerSecond: 30,
			sustainedForInMs: 8000,
			durationInMs: expect.any(Number),
		});
	});

	it('raises the issue only once while the picture stays coarse', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(COARSE);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	/**
	 * Screen content is coded coarsely on purpose wherever nothing is moving, and looks perfect.
	 * Only the application can say a *received* track is a screen share.
	 */
	it('never judges a screen share', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		trackMonitor.isScreenShare = true;
		for (let i = 0; i < 10; ++i) tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resolves an open issue when the track turns out to be a screen share', () => {
		const { clientMonitor, trackMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		trackMonitor.isScreenShare = true;
		tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('screen share');
	});

	it('stands down while this leg\'s consumer is paused', () => {
		const { clientMonitor, trackMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		(trackMonitor as any).paused = true;
		tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('track paused');
	});

	it('stands down while the remote sender is paused', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		(trackMonitor as any).remoteOutboundTrackPaused = true;
		for (let i = 0; i < 10; ++i) tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('says nothing about an audio track', () => {
		const { clientMonitor, tick } = setup('audio');

		for (let i = 0; i < 10; ++i) tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(COARSE, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(COARSE, 8000);
		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('treats an absent deltaTime as no stats time at all', () => {
		const { detector, inboundRtp, clientMonitor } = setup();

		// Driven without `tick`: a default parameter would swallow an explicitly-passed
		// `undefined` and hand the detector 2000ms anyway.
		inboundRtp.normalizedQp = COARSE;
		inboundRtp.avgQpPerFrame = COARSE * 127;
		inboundRtp.deltaTime = undefined;
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	/**
	 * The capability boundary, stated as behaviour. This detector reads the quantizer and has
	 * nothing else to fall back on: a browser that does not report `qpSum`, or a codec whose scale
	 * is not known, means no verdict at all rather than a verdict from a weaker proxy.
	 */
	describe('without a quantizer to read', () => {
		it('reports its inputs unavailable and judges nothing', () => {
			const { detector, clientMonitor, tick } = setup();

			for (let i = 0; i < 10; ++i) tick(undefined);

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		// Losing sight of the quantizer is not the same as the picture recovering, but a claim the
		// detector can no longer support must not stand for the rest of the call.
		it('resolves an open finding rather than holding it on evidence it no longer has', () => {
			const { clientMonitor, tick, raise } = setup();

			raise();
			expect(clientMonitor.getIssues()).toHaveLength(1);

			tick(undefined);

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment).toBe('no quantizer reported');
		});

		it('clears inputsUnavailable as soon as a quantizer is reported again', () => {
			const { detector, tick } = setup();

			tick(undefined);
			expect(detector.inputsUnavailable).toBe(true);

			tick(CLEAN);

			expect(detector.inputsUnavailable).toBe(false);
		});

		// The duration starts again: a stretch the detector could not see is not a stretch of
		// coarse picture it can count towards a finding.
		it('does not count the unseen collections towards the duration', () => {
			const { clientMonitor, tick } = setup();

			for (let i = 0; i < 3; ++i) tick(COARSE);
			tick(undefined);
			for (let i = 0; i < 3; ++i) tick(COARSE);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 10; ++i) tick(COARSE);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
