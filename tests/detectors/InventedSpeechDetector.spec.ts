/* eslint-disable @typescript-eslint/no-explicit-any */
import { InventedSpeechDetector } from "../../src/detectors/InventedSpeechDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	allowedInventedRatio: 0.05,
	raiseAfterInventedMs: 400,
};

function setup(kind: 'audio' | 'video' = 'audio') {
	const trackMonitor = new MockInboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.inventedSpeechDetector = { ...CONFIG };

	const detector = new InventedSpeechDetector(trackMonitor as any);

	/**
	 * One collection tick: `ratio` of this interval's audio was invented rather
	 * than transmitted, over `deltaTime` milliseconds of the stream's own clock.
	 * The accumulator integrates the rate over that clock and never over the wall
	 * clock, so a spec that wants time to pass says so here.
	 */
	const tick = (ratio: number | undefined, deltaTime = 2000) => {
		trackMonitor.setInboundRtp({
			kind,
			deltaTime,
			inventedSpeechRatio: ratio,
		});
		detector.update();
	};

	/**
	 * At the defaults a 2000ms tick at 20% invented contributes 400 − 100 = 300ms,
	 * so two of them fill the 400ms accumulator and raise.
	 */
	const raise = () => {
		tick(0.2);
		tick(0.2);
	};

	return { detector, trackMonitor, clientMonitor, tick, raise };
}

/**
 * The ratio `InboundRtpMonitor` would derive from these sample counts — concealed
 * samples with the silent ones subtracted, over the samples that arrived. Mirrored
 * here so a spec can state its case in samples where that is what it is about; the
 * derivation itself belongs to the monitor and is covered in DerivedFields.spec.
 */
const inventedRatioOf = (total: number, concealed: number, silent = 0) =>
	Math.max(0, concealed - silent) / total;

describe('InventedSpeechDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('invented-speech-detector');
	});

	it('stays silent on a stream inventing less than the allowance', () => {
		const { clientMonitor, tick } = setup();

		// NetEQ always fabricates a little; 1% of the audio is under the 5% the
		// allowance grants and drains as fast as it arrives.
		for (let i = 0; i < 10; ++i) tick(0.01);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises once the invention beyond the allowance fills the accumulator', () => {
		const { clientMonitor, tick } = setup();

		// 2000ms at 20% invented is 400ms of invention against 100ms of allowance:
		// +300, which is not yet the 400 the config asks for.
		tick(0.2);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.2);

		const issue = clientMonitor.issueOfType('invented-speech');

		expect(issue).toBeDefined();
		expect(issue?.payload.inventedSpeechRatio).toBeCloseTo(0.2);
		expect(issue?.payload.excessInventedMs).toBeCloseTo(400);
		expect(clientMonitor.emittedOf('invented-speech')).toHaveLength(1);
	});

	// The whole point of the metric: `concealedSamples` rises during ordinary
	// silence, so without subtracting the silent part every quiet call would look
	// broken. Half this interval was concealed and none of it was audible.
	it('does not count concealment the listener could not hear', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(inventedRatioOf(10000, 5000, 5000));

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('does not accumulate through silence, however long it lasts', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 30; ++i) tick(0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// The property the redesign exists for. Someone who breaks up, pauses for
	// breath and breaks up again is one episode, not two: a clean tick drains only
	// the allowance, so a couple of seconds of good audio costs a quarter of a full
	// accumulator rather than resetting it.
	it('keeps an episode open across a brief patch of clean audio', () => {
		const { clientMonitor, tick, raise } = setup();

		raise();
		expect(clientMonitor.activeIssues.size).toBe(1);

		// 400 → 300 → 200: draining, but nowhere near empty.
		tick(0);
		tick(0);

		expect(clientMonitor.activeIssues.size).toBe(1);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// ...and the next bad patch refills it rather than starting over.
		tick(0.2);

		expect(clientMonitor.activeIssues.size).toBe(1);
		expect(clientMonitor.raisedIssues).toHaveLength(1);
	});

	it('resolves only after the accumulator has drained all the way', () => {
		const { clientMonitor, tick, raise } = setup();

		raise();

		// A clean 2000ms tick drains the allowance and nothing more: 100ms a tick,
		// so a full accumulator needs four of them.
		for (let i = 0; i < 3; ++i) {
			tick(0);
			expect(clientMonitor.activeIssues.size).toBe(1);
		}

		tick(0);

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('audio recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBeDefined();
	});

	// Integrating a rate over elapsed time has no tick-length artefact: the same
	// audio moves the accumulator the same distance whether the collector reports
	// it in one piece or in two. The earlier design classified each tick against a
	// threshold and added its whole duration, so its sensitivity moved with
	// `collectingPeriodInMs`.
	it('reaches the same accumulator however the same audio is split across ticks', () => {
		// 4000ms at 12.5% invented: 500ms of invention against 200ms of allowance,
		// so +300 either way — short of the 400 that raises.
		const asOneTick = setup();

		asOneTick.tick(0.125, 4000);

		const asTwoTicks = setup();

		asTwoTicks.tick(0.125, 2000);
		asTwoTicks.tick(0.125, 2000);

		expect(asOneTick.clientMonitor.getIssues()).toHaveLength(0);
		expect(asTwoTicks.clientMonitor.getIssues()).toHaveLength(0);

		// The same finishing tick — 1000ms at 15%, worth exactly the missing 100 —
		// tips both over at the same moment and by the same amount, which it could
		// only do if both accumulators stood at 300.
		asOneTick.tick(0.15, 1000);
		asTwoTicks.tick(0.15, 1000);

		expect(asOneTick.clientMonitor.issueOfType('invented-speech')?.payload.excessInventedMs)
			.toBeCloseTo(400);
		expect(asTwoTicks.clientMonitor.issueOfType('invented-speech')?.payload.excessInventedMs)
			.toBeCloseTo(400);
	});

	// The browser reported no concealment counters, or no samples arrived at all.
	// Nothing was observed about how this sounded, which is not the same as it
	// having sounded fine — so the detector says so rather than reading it as zero.
	it('reports its inputs unavailable while the ratio is missing, and again once it returns', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.01);

		expect(detector.inputsUnavailable).toBe(false);
	});

	// Invention is judged over the stream's own time. A collector that was away for
	// ten minutes did not listen to ten minutes of fabricated audio.
	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(0.5, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.5, 2000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('stays silent while the consumer has the track paused', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		trackMonitor.paused = true;
		for (let i = 0; i < 5; ++i) tick(0.9);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// A pause is not clean audio, so the accumulator is thrown away rather than
	// drained: nothing invented before the pause counts towards the next episode.
	it('closes an open episode when the consumer pauses, and starts the next one from empty', () => {
		const { clientMonitor, trackMonitor, tick, raise } = setup();

		raise();

		trackMonitor.paused = true;
		tick(0.9);

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('consumer paused');

		trackMonitor.paused = false;
		tick(0.2);

		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	it('stays silent while the remote track is paused', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		for (let i = 0; i < 5; ++i) tick(0.9);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('does nothing while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 5; ++i) tick(0.9);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('ignores video tracks', () => {
		const { clientMonitor, tick } = setup('video');

		for (let i = 0; i < 5; ++i) tick(0.9);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
