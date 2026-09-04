/* eslint-disable @typescript-eslint/no-explicit-any */
import { UplinkCongestionDetector } from "../../src/detectors/UplinkCongestionDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	minConfidence: 0.65,
};

/** `1 - available / recentMax`, the half of the confidence the estimate contributes. */
const narrowingOf = (available: number, recentMax: number) => Math.max(0, 1 - (available / recentMax));
/** `1 - baseline / pacer`, the half the pacer contributes. */
const queueingOf = (pacer: number, baseline: number) =>
	(pacer < 1 ? 0 : Math.max(0, 1 - (Math.max(baseline, 1) / pacer)));
const confidenceOf = (narrowing: number, queueing: number) => Math.sqrt(narrowing * queueing);

const ISSUE_TYPE = 'uplink-congestion';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/**
 * The throttled run the detector was built against: a loopback peer connection on
 * Chromium 141 behind `tbf rate 500kbit`. Healthy, the estimate sat at 1161 kbps
 * with the encoder sending around a megabit — 161 kbps of room. At the moment the
 * throttle bit, the estimate fell to ~400 while the encoder was still sending a
 * megabit, so the room went to −600 kbps for a collection before the encoder
 * followed it down. That inversion is what this detector is looking for.
 */
/**
 * The detector's memory of what this path recently carried fades at this rate per
 * second of stats time. Every expectation below that involves the recent maximum is
 * written in terms of it rather than as a number, because the arithmetic *is* the
 * behaviour: a peak observed one second ago is worth this much less already.
 */
const DECAY_PER_SECOND = 0.996;

const HEALTHY_ESTIMATE = 1_161_000;
const HEALTHY_SENDING = 1_000_000;
const THROTTLED_ESTIMATE = 400_000;

class MockCapacityPeerConnection extends MockPeerConnectionMonitor {
	public availableOutgoingBitrate: number | undefined = undefined;
	public sendingBitrate = 0;

	/** The gap between the two stats reports this collection came from. */
	public deltaTime: number | undefined = 1000;

	/**
	 * The connection's accumulated stats time, which the real monitor advances by
	 * `deltaTime` on every collection. The detector's window ages on this.
	 */
	public statsClockTime = 0;

	/** `availableOutgoingBitrate - sendingBitrate`, and its EWMA. */
	public outgoingBitrateHeadroom: number | undefined = undefined;
	public ewmaOutgoingBitrateHeadroom: number | undefined = undefined;

	public avgPacketSendDelayInMs: number | undefined = undefined;
	public estimatedMedianPacketSendDelayInMs: number | undefined = undefined;
	public ewmaRttInSec: number | undefined = undefined;
	public uplinkCongested = false;

	/** The browser's own limitation verdict, folded across the streams that sent. */
	public qualityLimitationReason: string | undefined = undefined;
}

type TickInput = {
	available?: number;
	sending?: number;
	deltaTime?: number;
	/** The average room this call had been running with. */
	baselineHeadroom?: number;
	sendDelay?: number;
	baselineSendDelay?: number;
	qualityLimitationReason?: string;
};

function setup() {
	const peerConnection = new MockCapacityPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.uplinkCongestionDetector = { ...CONFIG };

	const detector = new UplinkCongestionDetector(peerConnection as any);

	/** One collection. The headroom is derived here exactly as the monitor derives it. */
	const tick = (input: TickInput = {}) => {
		const available = 'available' in input ? input.available : HEALTHY_ESTIMATE;
		const sending = input.sending ?? HEALTHY_SENDING;

		peerConnection.deltaTime = input.deltaTime ?? 1000;
		peerConnection.statsClockTime += peerConnection.deltaTime;
		peerConnection.availableOutgoingBitrate = available;
		peerConnection.sendingBitrate = sending;
		peerConnection.outgoingBitrateHeadroom = available === undefined ? undefined : available - sending;
		peerConnection.ewmaOutgoingBitrateHeadroom = 'baselineHeadroom' in input
			? input.baselineHeadroom
			: HEALTHY_ESTIMATE - HEALTHY_SENDING;
		peerConnection.avgPacketSendDelayInMs = 'sendDelay' in input ? input.sendDelay : 2;
		peerConnection.estimatedMedianPacketSendDelayInMs = 'baselineSendDelay' in input ? input.baselineSendDelay : 2;
		peerConnection.qualityLimitationReason = 'qualityLimitationReason' in input
			? input.qualityLimitationReason
			: 'none';
		detector.update();
	};

	/**
	 * A healthy collection. Two of these are what give the detector's own rolling
	 * window a maximum to measure a drop against — one sample is not a maximum.
	 */
	const healthyTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) tick(input);
	};

	/**
	 * The onset of a throttle: the estimate has collapsed well below its recent
	 * maximum, the browser says bandwidth, and both witnesses are rising.
	 */
	const throttledTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) {
			tick({
				available: THROTTLED_ESTIMATE,
				sending: HEALTHY_SENDING,
				sendDelay: 240,
				baselineSendDelay: 30,
				qualityLimitationReason: 'bandwidth',
				...input,
			});
		}
	};

	return { detector, peerConnection, clientMonitor, tick, healthyTicks, throttledTicks };
}

describe('UplinkCongestionDetector', () => {
	it('is named after the fault and the direction it reports', () => {
		const { detector, healthyTicks } = setup();

		expect(detector.name).toBe('uplink-congestion-detector');
	});

	it('raises when the verdict, the narrowed path and the pacer queue all hold', () => {
		const { clientMonitor, peerConnection, throttledTicks, healthyTicks } = setup();

		peerConnection.ewmaRttInSec = 0.18;
		healthyTicks(1);
		throttledTicks(1);

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			availableOutgoingBitrate: THROTTLED_ESTIMATE,
			sendingBitrate: HEALTHY_SENDING,
			// The encoder had not followed the estimate down yet.
			headroomInBps: THROTTLED_ESTIMATE - HEALTHY_SENDING,
			baselineHeadroomInBps: HEALTHY_ESTIMATE - HEALTHY_SENDING,
			// One second of stats time after the peak was observed, so it has faded
			// by exactly one second's worth.
			maxAvailableOutgoingBitrate: HEALTHY_ESTIMATE * DECAY_PER_SECOND,
			narrowing: narrowingOf(THROTTLED_ESTIMATE, HEALTHY_ESTIMATE * DECAY_PER_SECOND),
			queueing: queueingOf(240, 30),
			confidence: confidenceOf(
				narrowingOf(THROTTLED_ESTIMATE, HEALTHY_ESTIMATE * DECAY_PER_SECOND),
				queueingOf(240, 30),
			),
			packetSendDelayInMs: 240,
			baselinePacketSendDelayInMs: 30,
			rttInMs: 180,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	it('raises once per episode however long it lasts', () => {
		const { clientMonitor, throttledTicks, healthyTicks } = setup();

		healthyTicks(1);
		throttledTicks(8);

		expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	describe('what must hold together', () => {
		it('says nothing without the browser calling the encoder bandwidth limited', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			// Everything else about these collections says congestion. The verdict is
			// far too eager to raise on by itself — precision 0.53 over a throttled run
			// — but as a gate it is what rules out a drop the path did not cause.
			healthyTicks(1);
			throttledTicks(4, { qualityLimitationReason: 'none' });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('says nothing while the path is as wide as it has been all call', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			// Bandwidth limited, pacer filling, and the estimate exactly where it was —
			// which is most of a screen share's life. `narrowing` is zero, so however
			// deep the queue gets the geometric mean stays there with it.
			healthyTicks(1);
			throttledTicks(4, { available: HEALTHY_ESTIMATE, sendDelay: 10_000 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('says nothing when the path narrowed and the pacer did not move', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			// The mirror of the test above: `queueing` is zero, so the estimate may
			// collapse as far as it likes and the confidence stays at zero.
			healthyTicks(1);
			throttledTicks(4, { available: 1, sendDelay: 2, baselineSendDelay: 2 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		/**
		 * The case the whole rewrite exists for. Over two captured sessions the pacer
		 * stayed empty through genuine congestion — an estimator that lowers the
		 * encoder target queues nothing, because less was produced rather than held —
		 * and requiring it cost four of the ten episodes in one of them.
		 */
		it('says nothing about a pacer queue that is deep but has not grown', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			// Well over the noise floor, and only a third above the level this call has
			// been running at all along: a pacer that was always this busy is not a queue
			// building now, so `queueing` is 0.25 and the pair cannot clear the bar.
			healthyTicks(1);
			throttledTicks(4, { sendDelay: 40, baselineSendDelay: 30 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		/**
		 * A moderate reading on both beats an extreme reading on either. That is the
		 * property the geometric mean exists for, and the one thing two independent
		 * thresholds could not express however they were tuned.
		 */
		it('takes two moderate signals over one extreme one', () => {
			const moderate = setup();
			const lopsided = setup();

			// Both halves around 0.7.
			moderate.healthyTicks(1);
			moderate.throttledTicks(1, { available: 300_000, sendDelay: 100, baselineSendDelay: 30 });

			// A queue a thousand times deeper, against an estimate that has barely moved.
			lopsided.healthyTicks(1);
			lopsided.throttledTicks(1, { available: 1_100_000, sendDelay: 100_000, baselineSendDelay: 30 });

			expect(moderate.clientMonitor.getIssues()).toHaveLength(1);
			expect(lopsided.clientMonitor.getIssues()).toHaveLength(0);
		});

		/**
		 * A path that just got wider is its own recent maximum, so `narrowing` is zero
		 * rather than negative and the confidence goes to zero with it. Worth a test
		 * because the alternative is a negative under a square root.
		 */
		it('scores a path that just got wider as no narrowing at all', () => {
			const { clientMonitor, detector, healthyTicks, throttledTicks } = setup();

			healthyTicks(2);
			// The estimate doubles while the pacer runs away.
			throttledTicks(4, { available: HEALTHY_ESTIMATE * 2, sendDelay: 10_000 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
			expect(detector.inputsUnavailable).toBe(false);
		});

		/**
		 * Without the floor, a pacer at 0.4ms against a baseline of 0.05ms scores
		 * `queueing` = 0.875 on arithmetic that is entirely noise, and a mild narrowing
		 * is then enough to clear the bar.
		 */
		it('scores a pacer under the noise floor as no queue at all', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(4, { available: 1, sendDelay: 0.4, baselineSendDelay: 0.05 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('reports how sure it was, and the two halves it came from', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1, { available: 300_000, sendDelay: 100, baselineSendDelay: 30 });

			const payload = clientMonitor.issueOfType(ISSUE_TYPE)?.payload as any;

			expect(payload.narrowing).toBeCloseTo(0.741, 2);
			expect(payload.queueing).toBeCloseTo(0.7, 2);
			expect(payload.confidence).toBeCloseTo(Math.sqrt(payload.narrowing * payload.queueing), 6);
			expect(payload.confidence).toBeGreaterThanOrEqual(CONFIG.minConfidence);
		});

		it('says nothing about a pacer queue that tripled from nothing to nothing', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			// Doubled and still under the floor: 0.4ms at 0.8ms is noise, and a ratio
			// alone cannot say so, so `queueing` is forced to zero.
			healthyTicks(1);
			throttledTicks(4, { sendDelay: 0.8, baselineSendDelay: 0.4 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});
	});

	describe('the look-alike this shape rules out by construction', () => {
		it('says nothing about a sender that stopped asking for bandwidth', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			// A muted camera, a replaced track, a screen share of a still slide. The
			// encoder asks for less, so nothing queues behind it — `queueing` is zero and
			// the confidence with it, however far the estimate follows the demand down.
			healthyTicks(1);
			throttledTicks(4, {
				available: 300_000, sending: 100_000,
				sendDelay: 2, baselineSendDelay: 2,
			});

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});
	});

	describe('the conditions it refuses to judge on', () => {
		it('says nothing about a connection sending nothing at all', () => {
			const { clientMonitor, detector, throttledTicks, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(4, { sending: 0 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
			// Nothing to judge is not the same as being unable to see.
			expect(detector.inputsUnavailable).toBe(false);
		});

		it('reports being blind rather than healthy where the browser computed no estimate', () => {
			const { clientMonitor, detector, throttledTicks, healthyTicks } = setup();

			// Firefox, and anything else whose congestion control produced neither a
			// send-side nor a receive-side estimate.
			healthyTicks(1);
			throttledTicks(2, { available: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('reports being blind where there is no verdict to read', () => {
			const { clientMonitor, detector, throttledTicks, healthyTicks } = setup();

			// An audio-only sender: the field "must not exist for audio".
			healthyTicks(1);
			throttledTicks(2, { qualityLimitationReason: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		/**
		 * The ramp-up at the start of every call is exactly where a detector inventing a
		 * baseline out of one sample would fire. Nothing guards it: the maximum folds in
		 * the newest sample, so on the first collection the estimate is its own maximum
		 * and `narrowing` scores zero however low the estimate happens to be.
		 */
		it('says nothing on the first collection, having nothing to compare against', () => {
			const { clientMonitor, throttledTicks } = setup();

			throttledTicks(1);

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('scores the first collection at zero confidence, whatever the estimate is', () => {
			const { clientMonitor, tick } = setup();

			// A tiny estimate and a pacer running away, on the very first collection.
			tick({
				available: 1, sending: HEALTHY_SENDING, sendDelay: 10_000, baselineSendDelay: 1,
				qualityLimitationReason: 'bandwidth',
			});

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('forgets a peak that has faded', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(2);

			// Five minutes of quiet collections on the narrowed path — the browser is
			// not calling it bandwidth limited, so nothing is raised, but the memory of
			// the wide path keeps fading while the narrow one keeps being observed. Well
			// past the three-minute half-life, so nothing of the wide path is left.
			throttledTicks(60, { qualityLimitationReason: 'none', deltaTime: 5000 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);

			// The same estimate that opened a finding against the wide path raises
			// nothing now: measured against the narrow path this call has actually been
			// running on, it is not a collapse at all. A link that settled at a third
			// of what it once carried has settled, and saying otherwise for the rest of
			// the call is the failure a call-long maximum would produce.
			throttledTicks(1);

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);

			// It takes a fresh collapse against *that* level to open one.
			throttledTicks(1, { available: THROTTLED_ESTIMATE * 0.3 });

			// Measured against the narrow path this call has actually been running on,
			// faded by the one second since it was last observed — and no trace of the
			// wide path it lost a minute ago.
			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.maxAvailableOutgoingBitrate)
				.toBeCloseTo(THROTTLED_ESTIMATE * DECAY_PER_SECOND, 0);
		});

		/**
		 * The memory reaches past the collection before. A yardstick that only ever
		 * compared a collection with its predecessor could not see a path that narrowed
		 * over several of them — which is most of them, since a bandwidth estimator
		 * ramps down over seconds.
		 */
		it('measures against the recent past, not against the collection before', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(2);

			// Three collections at an intermediate level, quiet enough that nothing is
			// raised on them.
			for (let i = 0; i < 3; ++i) tick({ available: 500_000 });

			throttledTicks(1);

			// 400k is a collapse against the 1161k this path was carrying four
			// collections ago, and not against the 500k of the collection before.
			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.maxAvailableOutgoingBitrate)
				.toBeCloseTo(HEALTHY_ESTIMATE * Math.pow(DECAY_PER_SECOND, 4), 0);
		});

		/**
		 * The memory fades per second of stats time, not per collection. Per collection
		 * would make an application collecting every second forget five times faster
		 * than one collecting every five, with nothing saying so — the same trap, in
		 * reverse, as sizing a window in milliseconds and getting two samples out of it.
		 */
		it('fades by elapsed time rather than by collection', () => {
			const slow = setup();
			const fast = setup();

			slow.healthyTicks(1);
			// One collection covering five seconds.
			slow.throttledTicks(1, { deltaTime: 5000 });

			fast.healthyTicks(1);
			// Five collections covering the same five seconds. The four in between
			// observe the narrowed path without the browser calling it a limitation, so
			// nothing is raised on them and the peak is left to fade.
			for (let i = 0; i < 4; ++i) {
				fast.tick({ deltaTime: 1000, available: THROTTLED_ESTIMATE, qualityLimitationReason: 'none' });
			}
			fast.throttledTicks(1, { deltaTime: 1000 });

			const slowMax = slow.clientMonitor.issueOfType(ISSUE_TYPE)?.payload.maxAvailableOutgoingBitrate;
			const fastMax = fast.clientMonitor.issueOfType(ISSUE_TYPE)?.payload.maxAvailableOutgoingBitrate;

			expect(slowMax).toBeCloseTo(HEALTHY_ESTIMATE * Math.pow(DECAY_PER_SECOND, 5), 0);
			expect(fastMax).toBeCloseTo(slowMax as number, 0);
		});

		it('does not fade on a collection that reported no estimate', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(2);

			// Nothing observed is not an observation: twenty blind collections must not
			// make what this path recently carried any less true.
			for (let i = 0; i < 20; ++i) tick({ available: undefined });

			throttledTicks(1);

			// Faded by the one second of this collection, and by nothing the blind ones
			// contributed.
			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.maxAvailableOutgoingBitrate)
				.toBeCloseTo(HEALTHY_ESTIMATE * DECAY_PER_SECOND, 0);
		});

		it('says nothing on a collection with no pacer measurement', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(4, { sendDelay: undefined });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});
	});

	describe('closing the finding', () => {
		it('resolves when the browser stops reporting a bandwidth limitation', () => {
			const { clientMonitor, throttledTicks, tick, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);
			expect(clientMonitor.getIssues()).toHaveLength(1);

			tick({ qualityLimitationReason: 'none' });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues).toHaveLength(1);
			expect(clientMonitor.resolvedIssues[0]?.comment)
				.toBe('the browser no longer reports the encoder as bandwidth limited');
			expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toEqual(expect.any(Number));
		});

		it('resolves on a path that settled below what it used to carry', () => {
			const { clientMonitor, throttledTicks, tick, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);

			// The encoder has followed the estimate down and the call is stable at a
			// third of what it was. This link has recovered, and it is never coming
			// back to where it was — a recovery threshold on the bitrate would hold
			// the finding open for the rest of the call.
			tick({
				available: THROTTLED_ESTIMATE,
				sending: 380_000,
				qualityLimitationReason: 'none',
			});

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('holds the finding open while the limitation stands', () => {
			const { clientMonitor, throttledTicks, tick, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);

			// The room is back and the pacer has drained, but the browser still calls
			// the encoder bandwidth limited: the episode is not over.
			tick({ qualityLimitationReason: 'bandwidth' });

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('closes the finding when the connection stops sending', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);
			throttledTicks(1, { sending: 0 });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment).toBe('nothing is being sent over this connection');
		});

		it('opens a second finding for a second episode', () => {
			const { clientMonitor, throttledTicks, tick, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);
			tick({ qualityLimitationReason: 'none' });
			throttledTicks(1);

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(2);
			expect(clientMonitor.getIssues()).toHaveLength(1);
		});
	});

	describe('the direction-agnostic feed', () => {
		it('emits `congestion` alongside its own event, saying which direction', () => {
			const { clientMonitor, throttledTicks, healthyTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);

			const combined = clientMonitor.emittedOf('congestion');

			expect(combined).toHaveLength(1);
			expect(combined[0]?.payload.direction).toBe('uplink');
			// The whole finding travels on it, not a flattened summary.
			expect(combined[0]?.payload.headroomInBps).toBe(THROTTLED_ESTIMATE - HEALTHY_SENDING);
		});
	});

	describe('the connection attribute', () => {
		it('moves with the finding rather than with the collection', () => {
			const { peerConnection, throttledTicks, tick, healthyTicks } = setup();

			tick();
			expect(peerConnection.uplinkCongested).toBe(false);

			healthyTicks(1);
			throttledTicks(1);
			expect(peerConnection.uplinkCongested).toBe(true);

			tick({ qualityLimitationReason: 'none' });
			expect(peerConnection.uplinkCongested).toBe(false);
		});
	});

	it('does nothing at all while disabled', () => {
		const { clientMonitor, detector, throttledTicks, healthyTicks } = setup();

		detector.disabled = true;
		healthyTicks(1);
		throttledTicks(4);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.emitted).toHaveLength(0);
	});
});
