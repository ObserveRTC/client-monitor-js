/* eslint-disable @typescript-eslint/no-explicit-any */
import { TransportDelayDetector } from "../../src/detectors/TransportDelayDetector";
import { SlicedWindow } from "../../src/utils/SlicedWindow";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	thresholdInMs: 300,
	recoveryThresholdInMs: 200,
};

/** Counted in values: four in front and three behind, at the 2s cadence the ticks below use. */
const WINDOW = {
	totals: {
		totalRtcpRoundTripTimeInMs: null,
		totalRtcpRoundTripMeasurements: null,
		totalIceRoundTripTimeInMs: null,
		totalIceResponsesReceived: null,
	} as {
		totalRtcpRoundTripTimeInMs: number | null;
		totalRtcpRoundTripMeasurements: number | null;
		totalIceRoundTripTimeInMs: number | null;
		totalIceResponsesReceived: number | null;
	},
	slices: {
		detection: { numberOfSamples: 4 },
		recovery: { numberOfSamples: 3, offset: 4 },
	},
	maxAllowedGapInMs: 60_000,
};

const ISSUE_TYPE = 'transport-delay-degraded';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/**
 * The shared peer connection mock is track-oriented. A transport quality detector never looks at a
 * track: it reads the window the real `PeerConnectionMonitor` keeps over its RTCP and ICE round
 * trip totals, on that monitor's own stats clock.
 */
class MockTransportPeerConnection extends MockPeerConnectionMonitor {
	public statsClockTime = 0;

	public readonly slicedWindow = new SlicedWindow(WINDOW);
}

function setup() {
	const peerConnection = new MockTransportPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.transportDelayDetector = { ...CONFIG };

	const detector = new TransportDelayDetector(peerConnection as any);

	// Running totals, exactly as the browser reports them: one more measurement each collection,
	// its round trip added to the accumulated time. The window differences its own endpoints.
	let rtcpTimeInMs = 0;
	let rtcpMeasurements = 0;
	let iceTimeInMs = 0;
	let iceResponses = 0;

	// Both totals are reported every collection, as a browser reports them: they are cumulative
	// and keep being served whether or not a new measurement landed. `reported: false` is the
	// other case entirely - a connection measuring no round trip at all.
	const feed = (reported: boolean) => peerConnection.slicedWindow.add({
		timestamp: peerConnection.statsClockTime,
		value: {
			totalRtcpRoundTripTimeInMs: reported ? rtcpTimeInMs : null,
			totalRtcpRoundTripMeasurements: reported ? rtcpMeasurements : null,
			totalIceRoundTripTimeInMs: reported ? iceTimeInMs : null,
			totalIceResponsesReceived: reported ? iceResponses : null,
		},
	});

	// One entry to difference the first collection against, as a real connection always has.
	feed(true);

	/**
	 * One collection: a round trip of `rttInMs` was measured, and the two reports it came from
	 * were `deltaTime` milliseconds apart. Stats time is advanced here rather than by the wall
	 * clock, which is the only thing the window is ever measured on.
	 */
	const tick = (
		rttInMs: number | undefined,
		deltaTime: number | undefined = 2000,
		source: 'rtcp' | 'ice' = 'rtcp',
	) => {
		peerConnection.statsClockTime += deltaTime ?? 0;

		if (rttInMs !== undefined) {
			if (source === 'rtcp') {
				rtcpTimeInMs += rttInMs;
				rtcpMeasurements += 1;
			} else {
				iceTimeInMs += rttInMs;
				iceResponses += 1;
			}
		}

		// A source that measured nothing this collection keeps serving its unchanged total, which
		// is what a browser with nothing new to report actually looks like.
		feed(rttInMs !== undefined);
		detector.update();
	};

	/** Fills the detection window, which needs three 2s collections behind the seed entry. */
	const fillDetectionWindow = (rttInMs: number) => {
		for (let i = 0; i < 3; ++i) tick(rttInMs);
	};

	/** And the recovery window behind it, so a resolution can be judged. */
	const fillRecoveryWindow = (rttInMs: number) => {
		for (let i = 0; i < 3; ++i) tick(rttInMs);
	};

	return { detector, peerConnection, clientMonitor, tick, fillDetectionWindow, fillRecoveryWindow };
}

describe('TransportDelayDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('transport-delay-detector');
	});

	it('raises once the mean round trip over the detection window is above the threshold', () => {
		const { clientMonitor, fillDetectionWindow } = setup();

		fillDetectionWindow(400);

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			rttInMs: 400,
			rttSource: 'rtcp',
			sustainedForInMs: 6000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)[0]?.payload.rttInMs).toBe(400);
	});

	// The window is the sustain: an unfilled one is not a short verdict, it is no verdict.
	it('does not raise one collection short of the detection window', () => {
		const { clientMonitor, tick } = setup();

		tick(400);
		tick(400);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	/**
	 * The mean is what is thresholded, not the newest sample, which is the whole reason for
	 * reading a window: one bad collection in an otherwise fine stretch is not a slow path.
	 */
	it('does not raise on a single spike that the window averages away', () => {
		const { clientMonitor, tick } = setup();

		tick(100);
		tick(100);
		tick(600);

		// (100 + 100 + 600) / 3 is under the 300ms bar, though the last sample is twice it.
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// A round trip sitting between the thresholds is the case the two of them exist for: without
	// the gap the issue would open and shut on every collection.
	it('holds the current state while the round trip sits between the two thresholds', () => {
		const { clientMonitor, tick, fillDetectionWindow } = setup();

		// Above recovery, below the bar: a call parked in the band never raises, however long it
		// sits there.
		for (let i = 0; i < 10; ++i) tick(250);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		fillDetectionWindow(400);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// Back into the band with the issue open: it must stay open, however long for.
		for (let i = 0; i < 10; ++i) tick(250);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// Exactly on the recovery threshold is still inside the band.
		for (let i = 0; i < 10; ++i) tick(200);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
	});

	/**
	 * Both windows have to agree before a finding closes, so the path must have been good for the
	 * stretch behind the current one too — not merely for the most recent collection.
	 */
	it('resolves only once the recovery window agrees, saying how long it lasted', () => {
		const { clientMonitor, fillDetectionWindow } = setup();

		fillDetectionWindow(400);
		expect(clientMonitor.getIssues()).toHaveLength(1);

		// The detection window is clean again, but the stretch behind it still holds the episode.
		fillDetectionWindow(120);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// Now the recovery window has aged onto the good stretch as well.
		fillDetectionWindow(120);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('round trip recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			rttInMs: expect.any(Number),
			rttSource: 'rtcp',
			sustainedForInMs: 6000,
			durationInMs: expect.any(Number),
		});
	});

	it('raises the issue only once while the delay persists', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(400);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	// Raising once does not mean reporting once: an operator reading the payload should see the
	// round trip as it is now, not the one that happened to open the episode.
	it('refreshes the measurement on the open issue as the round trip moves', () => {
		const { clientMonitor, tick, fillDetectionWindow } = setup();

		fillDetectionWindow(400);
		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.rttInMs).toBe(400);

		for (let i = 0; i < 6; ++i) tick(800);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.rttInMs).toBe(800);
	});

	/**
	 * The window is the path's own time, not the library's. A blocked main thread or a sleeping
	 * device is time nobody was looking, and only the stats timestamps can tell that apart from a
	 * genuinely slow minute.
	 */
	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(400, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		// The very next collection that carries real stats time fills the window and raises.
		tick(400, 6000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	/**
	 * The preference is decided from this window's deltas every time, not latched the first time
	 * RTCP is seen. An RTCP total that stops advancing yields no reading at all, and the detector
	 * falls back rather than thresholding a number that stopped moving.
	 */
	it('prefers the RTCP round trip while RTCP is still being measured', () => {
		const { clientMonitor, tick } = setup();

		// ICE says the path is slow, RTCP says it is fine. RTCP wins, so nothing is raised.
		for (let i = 0; i < 6; ++i) {
			tick(100, 2000, 'rtcp');
			tick(900, 0, 'ice');
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('falls back to the ICE round trip once RTCP stops being measured', () => {
		const { clientMonitor, tick } = setup();

		// A stretch of healthy RTCP, so a latched preference would have something stale to hold.
		for (let i = 0; i < 4; ++i) tick(100, 2000, 'rtcp');
		expect(clientMonitor.getIssues()).toHaveLength(0);

		// RTCP stops: its totals stay put, so its delta across the window is zero measurements.
		for (let i = 0; i < 4; ++i) tick(900, 2000, 'ice');

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.payload.rttSource).toBe('ice');
		expect(issue?.payload.rttInMs).toBe(900);
	});

	it('reports its inputs unavailable while the peer connection measures no round trip at all', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 4; ++i) tick(undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('clears inputsUnavailable as soon as a round trip is measured again', () => {
		const { detector, tick } = setup();

		for (let i = 0; i < 4; ++i) tick(undefined);
		expect(detector.inputsUnavailable).toBe(true);

		for (let i = 0; i < 4; ++i) tick(100);

		expect(detector.inputsUnavailable).toBe(false);
	});

	/**
	 * The regression this detector actually shipped with. At a five-second collecting period the
	 * 6000ms recovery window held exactly one value — ages 0 and 5000 sit in the detection
	 * half, 10000 is the only one left inside `detection + recovery` — and one value cannot be
	 * differenced, so `recoveryDelta` was `null` on every collection and the finding could never
	 * close. It stayed open for the remaining forty minutes of the call while the round trip sat
	 * at 3ms.
	 *
	 * `SlicedWindow` now keeps at least two values in every slice whatever its durations come to,
	 * so that shape is gone at the source. This pins the detector's own half of the rule, for the
	 * cases a retention floor cannot reach: a window configured with no recovery half at all, or
	 * one whose endpoints never carried the total. A detector that can raise can always clear.
	 */
	it('clears the finding when the recovery window has nothing to say', () => {
		const { clientMonitor, peerConnection, tick } = setup();

		// A recovery slice that never becomes readable — the shape a full window cannot rescue.
		// `numberOfRecoverySamples: 0` used to express this; a slice is always declared now, so
		// the case is staged directly on the slice the detector reads.
		Object.defineProperty(peerConnection.slicedWindow.slices.recovery, 'isReady', {
			get: () => false,
		});

		for (let i = 0; i < 4; ++i) tick(900);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		for (let i = 0; i < 4; ++i) tick(3);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
	});

	/**
	 * The last way a finding could have been raised and never cleared. Losing the measurement is
	 * not the same as recovering, but it does mean the detector can no longer support what it
	 * reported, and a claim it cannot see must not stand for the rest of the call.
	 */
	it('clears the finding when the round trip stops being measurable at all', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 4; ++i) tick(900);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// Neither source reports anything, for longer than the window spans.
		for (let i = 0; i < 4; ++i) tick(undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
		expect(clientMonitor.resolvedIssues.at(-1)?.comment).toBe('round trip no longer measurable');
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 10; ++i) tick(400);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
