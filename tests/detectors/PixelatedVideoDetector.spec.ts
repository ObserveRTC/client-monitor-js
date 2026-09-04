/* eslint-disable @typescript-eslint/no-explicit-any */
import { PixelatedVideoDetector } from "../../src/detectors/PixelatedVideoDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	threshold: 0.03,
	recoveryThreshold: 0.05,
	durationInMs: 8000,
};

const ISSUE_TYPE = 'pixelated-video';
const ISSUE_KEY = `${ISSUE_TYPE}-track-video-track-1`;

/**
 * `InboundTrackMonitor` derives `isScreenShare` from the track's settings; a
 * spec has no settings to derive it from and just says which it is.
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
		bitPerPixel: undefined,
		deltaTime: undefined,
	};

	trackMonitor.setInboundRtp(inboundRtp);

	const detector = new PixelatedVideoDetector(trackMonitor as any);

	/**
	 * One collection: the picture is being drawn with `bitPerPixel` bits per
	 * pixel per second, over `deltaTime` milliseconds of stats time. The
	 * duration comes off the RTP monitor's clock and never off the wall clock.
	 */
	const tick = (bitPerPixel: number | undefined, deltaTime = 2000) => {
		inboundRtp.bitPerPixel = bitPerPixel;
		inboundRtp.deltaTime = deltaTime;
		detector.update();
	};

	/** Four collections of 2s each is exactly the 8s the config asks for. */
	const raise = () => {
		for (let i = 0; i < 4; ++i) tick(0.012);
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
			bitPerPixel: 0.012,
			frameWidth: 1280,
			frameHeight: 720,
			framesPerSecond: 30,
			sustainedForInMs: 8000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)[0]?.payload.bitPerPixel).toBe(0.012);
	});

	it('does not raise one tick short of the duration', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 3; ++i) tick(0.012);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// Bits per pixel is judged the other way round from the transport measures —
	// low is bad — so the band runs from `threshold` up to `recoveryThreshold`,
	// and a stream sitting inside it keeps whatever state it already has.
	it('holds the current state while bits per pixel sit between the two thresholds', () => {
		const { clientMonitor, tick, raise } = setup();

		for (let i = 0; i < 10; ++i) tick(0.04);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		raise();
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		for (let i = 0; i < 5; ++i) tick(0.04);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// Exactly on the recovery threshold is still inside the band...
		tick(0.05);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// ...and only a picture genuinely richer than it clears the issue.
		tick(0.051);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
	});

	// The other end of the band: exactly on the raise threshold counts as coarse.
	it('counts a picture sitting exactly on the threshold as coarse', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 4; ++i) tick(0.03);

		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('resolves once the picture gets its bits back, saying how long it lasted', () => {
		const { clientMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		tick(0.14);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('picture quality recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			trackId: 'video-track-1',
			bitPerPixel: 0.012,
			frameWidth: 1280,
			frameHeight: 720,
			framesPerSecond: 30,
			sustainedForInMs: 8000,
			durationInMs: expect.any(Number),
		});
	});

	it('raises the issue only once while the picture stays coarse', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 12; ++i) tick(0.012);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	// A slide deck legitimately spends almost nothing per pixel and looks
	// perfect; judging one by this measure would report every screen share.
	it('never judges a screen share', () => {
		const { trackMonitor, clientMonitor, tick } = setup();

		trackMonitor.isScreenShare = true;
		for (let i = 0; i < 12; ++i) tick(0.001);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resolves an open issue when the track turns out to be a screen share', () => {
		const { trackMonitor, clientMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		trackMonitor.isScreenShare = true;
		tick(0.012);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('screen share');
	});

	it('stands down while this leg\'s consumer is paused', () => {
		const { trackMonitor, clientMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		trackMonitor.paused = true;
		tick(0.012);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('track paused');

		// Resuming starts a fresh episode that must earn the duration again.
		trackMonitor.paused = false;
		for (let i = 0; i < 3; ++i) tick(0.012);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.012);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('stands down while the remote sender is paused', () => {
		const { trackMonitor, clientMonitor, tick } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		for (let i = 0; i < 12; ++i) tick(0.012);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('says nothing about an audio track', () => {
		const { detector, clientMonitor, tick } = setup('audio');

		for (let i = 0; i < 12; ++i) tick(0.012);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});

	// The picture is judged over the stream's own time. A collector that was
	// away for a minute did not watch a minute of blocky video.
	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(0.012, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.012, 8000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('treats an absent deltaTime as no stats time at all', () => {
		const { detector, clientMonitor, inboundRtp } = setup();

		// Driven without `tick`: a default parameter would swallow an
		// explicitly-passed `undefined` and hand the detector 2000ms anyway.
		inboundRtp.bitPerPixel = 0.012;
		inboundRtp.deltaTime = undefined;
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// No bitrate, no frame size or no frame rate this tick means nothing was
	// observed about picture quality, which is not the same as it being fine.
	it('reports its inputs unavailable while bits per pixel cannot be computed', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('clears inputsUnavailable as soon as bits per pixel come back', () => {
		const { detector, tick } = setup();

		tick(undefined);
		expect(detector.inputsUnavailable).toBe(true);

		tick(0.14);

		expect(detector.inputsUnavailable).toBe(false);
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 12; ++i) tick(0.012);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});
});
