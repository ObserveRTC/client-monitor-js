/* eslint-disable @typescript-eslint/no-explicit-any */
import { UplinkCongestionDetector } from "../../src/detectors/UplinkCongestionDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	minSeverity: 0.65,
	pacerBloatingSaturatesAt: 4,
};

const ISSUE_TYPE = 'uplink-congestion';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/** The two witnesses, restated so an expectation reads as arithmetic rather than a number. */
const undershootOf = (available: number, recentMax: number) => Math.max(0, 1 - (available / recentMax));

/** Zero at the baseline, one at four times it. */
const PACER_BLOATING_SATURATES_AT = 4;
const MIN_PACKET_SEND_DELAY_IN_MS = 1;
const pacerBloatingOf = (pacer: number, baseline: number) => {
	const floored = Math.max(baseline, MIN_PACKET_SEND_DELAY_IN_MS);

	return Math.min(1, Math.max(0, (pacer - floored) / (floored * (PACER_BLOATING_SATURATES_AT - 1))));
};
const severityOf = (undershoot: number, pacerBloating: number) => Math.sqrt(undershoot * pacerBloating);

/**
 * The detector's memory of what this path recently carried fades at this rate per second
 * of stats time. Every expectation below that involves the recent maximum is written in
 * terms of it rather than as a number, because the arithmetic *is* the behaviour.
 */
const DECAY_PER_SECOND = 0.996;

/** A few settled collections before the interesting one. No gate requires them. */
const SETTLING_TICKS = 3;

/**
 * The throttled run the detector was built against: a loopback peer connection on
 * Chromium 141 behind `tbf rate 500kbit`. Healthy, the estimate sat at 1161 kbps with the
 * encoder sending around a megabit. When the throttle bit, the estimate fell to ~400 kbps
 * while the encoder was still sending a megabit, and the pacer filled behind it.
 */
const HEALTHY_ESTIMATE = 1_161_000;
const HEALTHY_SENDING = 1_000_000;
const THROTTLED_ESTIMATE = 400_000;
const HEALTHY_SEND_DELAY_IN_MS = 30;
const BLOATED_SEND_DELAY_IN_MS = 240;

class MockCapacityPeerConnection extends MockPeerConnectionMonitor {
	/** Summed across the selected pairs, and `undefined` where the browser computed none. */
	public totalAvailableOutgoingBitrate: number | undefined = undefined;
	public sendingBitrate = 0;

	/** The gap between the two stats reports this collection came from. */
	public deltaTime: number | undefined = 1000;

	/** Pacer time per video packet over this collection. */
	public avgPacketSendDelayInMs: number | undefined = undefined;
	public uplinkCongested = false;

	/** The browser's own limitation verdict, folded across the streams that sent. */
	public qualityLimitationReason: string | undefined = undefined;
}

type TickInput = {
	available?: number;
	sending?: number;
	deltaTime?: number;
	sendDelay?: number;
	qualityLimitationReason?: string;
};

function setup(config: Partial<typeof CONFIG> = {}) {
	const peerConnection = new MockCapacityPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.uplinkCongestionDetector = { ...CONFIG, ...config };

	const detector = new UplinkCongestionDetector(peerConnection as any);

	/** One collection, as the monitor would present it. */
	const tick = (input: TickInput = {}) => {
		peerConnection.deltaTime = input.deltaTime ?? 1000;
		peerConnection.totalAvailableOutgoingBitrate = 'available' in input ? input.available : HEALTHY_ESTIMATE;
		peerConnection.sendingBitrate = input.sending ?? HEALTHY_SENDING;
		peerConnection.avgPacketSendDelayInMs = 'sendDelay' in input ? input.sendDelay : HEALTHY_SEND_DELAY_IN_MS;
		peerConnection.qualityLimitationReason = 'qualityLimitationReason' in input
			? input.qualityLimitationReason
			: 'none';
		detector.update();
	};

	/**
	 * A settled collection. Enough of these give the detector a maximum to measure an
	 * undershoot against and a median to measure bloating against.
	 */
	const settledTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) tick(input);
	};

	/**
	 * The onset of a throttle: the estimate undershoots its recent maximum, the pacer
	 * bloats past its median, and the browser says bandwidth.
	 */
	const congestedTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) {
			tick({
				available: THROTTLED_ESTIMATE,
				sending: HEALTHY_SENDING,
				sendDelay: BLOATED_SEND_DELAY_IN_MS,
				qualityLimitationReason: 'bandwidth',
				...input,
			});
		}
	};

	const raisedCount = () => clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE).length;

	return { detector, peerConnection, clientMonitor, tick, settledTicks, congestedTicks, raisedCount };
}

describe('UplinkCongestionDetector', () => {
	it('is named after the fault and the direction it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('uplink-congestion-detector');
	});

	it('raises when the verdict, the undershoot and the pacer bloating all hold', () => {
		const { clientMonitor, settledTicks, congestedTicks } = setup();

		settledTicks(SETTLING_TICKS);
		congestedTicks(1);

		// The baseline is what the settled collections left behind. This collection is
		// judged against it and only then joins it, so it cannot move its own baseline.
		const recentMax = HEALTHY_ESTIMATE;
		const undershoot = undershootOf(THROTTLED_ESTIMATE, recentMax);
		const pacerBloating = pacerBloatingOf(BLOATED_SEND_DELAY_IN_MS, HEALTHY_SEND_DELAY_IN_MS);
		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			availableOutgoingBitrate: THROTTLED_ESTIMATE,
			sendingBitrate: HEALTHY_SENDING,
			recentMaxAvailableBitrate: recentMax,
			undershoot,
			pacerBloating,
			severity: severityOf(undershoot, pacerBloating),
			avgPacketSendDelayInMs: BLOATED_SEND_DELAY_IN_MS,
			estimatedMedianPacketSendDelayInMs: HEALTHY_SEND_DELAY_IN_MS,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	it('raises once per episode however long it lasts', () => {
		const { clientMonitor, settledTicks, congestedTicks, raisedCount } = setup();

		settledTicks(SETTLING_TICKS);
		congestedTicks(8);

		expect(raisedCount()).toBe(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	describe('what must hold together', () => {
		it('says nothing without the browser calling the encoder bandwidth limited', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// Both witnesses are where a finding wants them. The verdict decides whether
			// this is congestion at all, and it says no.
			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { qualityLimitationReason: 'cpu' });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing while the estimate is where it has been all call', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { available: HEALTHY_ESTIMATE });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing when the estimate undershoots and the pacer is not bloating', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// The geometric mean's whole point: one witness at its settled level takes the
			// severity to zero rather than merely failing to add to it.
			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { sendDelay: HEALTHY_SEND_DELAY_IN_MS });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing about a pacer that is deep but has not bloated', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// A pacer that was always this deep is this connection's normal, whatever the
			// absolute number looks like.
			settledTicks(SETTLING_TICKS, { sendDelay: BLOATED_SEND_DELAY_IN_MS });
			congestedTicks(4, { sendDelay: BLOATED_SEND_DELAY_IN_MS });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing about a pacer bloating from nothing to nothing', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// Four times the baseline and still under the noise floor: 0.2ms at 0.8ms is
			// arithmetic, and a ratio alone cannot say so.
			settledTicks(SETTLING_TICKS, { sendDelay: 0.2 });
			congestedTicks(4, { sendDelay: 0.8 });

			expect(raisedCount()).toBe(0);
		});

		it('scores an estimate above its recent maximum as no undershoot at all', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { available: HEALTHY_ESTIMATE * 2 });

			expect(raisedCount()).toBe(0);
		});

		it('takes two moderate witnesses over one extreme one', () => {
			const { clientMonitor, settledTicks, tick } = setup();

			// An undershoot of nearly one with the pacer at its median scores zero, because
			// the geometric mean multiplies. Two moderate witnesses clear the bar that one
			// extreme witness cannot — which is the ordering the mean exists to produce.
			settledTicks(SETTLING_TICKS);
			tick({
				available: 1,
				sendDelay: HEALTHY_SEND_DELAY_IN_MS,
				qualityLimitationReason: 'bandwidth',
			});

			expect(clientMonitor.getIssues()).toHaveLength(0);

			// Undershoot ~0.66 and bloating ~0.67: severity ~0.66, just over the bar.
			tick({
				available: HEALTHY_ESTIMATE * 0.34,
				sendDelay: HEALTHY_SEND_DELAY_IN_MS * 3,
				qualityLimitationReason: 'bandwidth',
			});

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});
	});

	describe('the baselines it measures against', () => {
		it('keeps feeding them while the browser calls the encoder bandwidth limited', () => {
			const { clientMonitor, tick, congestedTicks } = setup();

			// The regression this exists for. The verdict reads `bandwidth` on nearly every
			// collection of a real call — all 34 of the measured throttle run, including its
			// 6 healthy ones. Feeding the baselines only on collections without it starved
			// them: no baseline was ever established, and the detector went permanently
			// silent on exactly the calls it is meant to describe.
			for (let i = 0; i < SETTLING_TICKS; ++i) {
				tick({ qualityLimitationReason: 'bandwidth' });
			}

			congestedTicks(1);

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		/**
		 * One observation is a usable baseline: the decaying maximum starts as that sample
		 * and the frugal quantile as its own estimate, so both witnesses read against a real
		 * number rather than a placeholder. Waiting for more only means a collapse arriving
		 * early in a call goes unreported — and a call that is congested from its first
		 * seconds is exactly the one worth describing.
		 */
		it('judges a collapse against a baseline of a single collection', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			settledTicks(1);
			congestedTicks(1);

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('does not let an open episode drag the median it is judged against', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			expect(clientMonitor.getIssues()).toHaveLength(1);

			// Twenty collections of a deep pacer. Were the median taking them, it would
			// climb until the bloating scored zero and the episode talked itself out of
			// existence while the pacer was still deep.
			congestedTicks(20);

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('fades the maximum by elapsed time rather than by collection', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);

			// One collection, sixty seconds of it — a backgrounded tab, a saturated main
			// thread. The maximum fades per second of stats time, not per collection, so
			// applications collecting at different periods forget at the same rate.
			tick({ available: HEALTHY_ESTIMATE * 0.5, deltaTime: 60_000 });
			congestedTicks(1);

			const faded = HEALTHY_ESTIMATE * Math.pow(DECAY_PER_SECOND, 60);

			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.recentMaxAvailableBitrate)
				.toBeCloseTo(faded, 0);
		});

		it('holds the maximum steady across ordinary collections', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			// Ten seconds of settled collections fade it by well under a percent, so the
			// baseline a call is judged against is the path at its best, not its latest.
			settledTicks(10);
			congestedTicks(1);

			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.recentMaxAvailableBitrate)
				.toBe(HEALTHY_ESTIMATE);
		});
	});

	describe('the look-alike this shape rules out by construction', () => {
		it('says nothing about a sender that stopped asking for bandwidth', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// A muted camera, a replaced track, a screen share of a still slide. The estimate
			// follows the demand down — an undershoot — but nothing is queueing behind it,
			// because the encoder is asking for less rather than being refused more.
			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { sending: 100_000, sendDelay: HEALTHY_SEND_DELAY_IN_MS });

			expect(raisedCount()).toBe(0);
		});
	});

	describe('the conditions it refuses to judge on', () => {
		it('says nothing about a connection sending nothing at all', () => {
			const { detector, settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { sending: 0 });

			expect(raisedCount()).toBe(0);
			// Nothing to judge is not the same as being unable to see.
			expect(detector.inputsUnavailable).toBe(false);
		});

		it('reports being blind rather than healthy where the browser computed no estimate', () => {
			const { detector, settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(2, { available: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(raisedCount()).toBe(0);
		});

		it('reports being blind where there is no verdict to read', () => {
			const { detector, settledTicks, congestedTicks, raisedCount } = setup();

			// An audio-only sender: the field must not exist for audio.
			settledTicks(SETTLING_TICKS);
			congestedTicks(2, { qualityLimitationReason: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(raisedCount()).toBe(0);
		});

		it('reports being blind on a collection with no pacer measurement', () => {
			const { detector, settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(2, { sendDelay: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(raisedCount()).toBe(0);
		});
	});

	describe('closing the finding', () => {
		it('resolves when the browser stops reporting a bandwidth limitation', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			expect(clientMonitor.getIssues()).toHaveLength(1);

			tick({ qualityLimitationReason: 'none' });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment)
				.toBe('the browser no longer reports the encoder as bandwidth limited');
			expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toEqual(expect.any(Number));
		});

		it('resolves on a path that settled below what it used to carry', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			// The encoder has followed the estimate down and the call is stable at a third
			// of what it was. This link has recovered and is never coming back to where it
			// started; a bitrate threshold against the old maximum would say otherwise.
			tick({
				available: THROTTLED_ESTIMATE,
				sending: 380_000,
				sendDelay: BLOATED_SEND_DELAY_IN_MS,
				qualityLimitationReason: 'none',
			});

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('holds the finding open while the limitation stands', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			// Both witnesses back at their settled levels, and the browser still calling the
			// encoder bandwidth limited: the episode is not over.
			tick({ qualityLimitationReason: 'bandwidth' });

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('closes the finding when the connection stops sending', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			congestedTicks(1, { sending: 0 });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment).toBe('nothing is being sent over this connection');
		});

		it('opens a second finding for a second episode', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			tick({ qualityLimitationReason: 'none' });
			congestedTicks(1);

			expect(raisedCount()).toBe(2);
			expect(clientMonitor.getIssues()).toHaveLength(1);
		});
	});


	describe('the connection attribute', () => {
		it('moves with the finding rather than with the collection', () => {
			const { peerConnection, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			expect(peerConnection.uplinkCongested).toBe(false);

			congestedTicks(1);
			expect(peerConnection.uplinkCongested).toBe(true);

			tick({ qualityLimitationReason: 'none' });
			expect(peerConnection.uplinkCongested).toBe(false);
		});
	});

	/**
	 * `uplinkVideoCongestionSeverity` is the continuous reading beside the boolean flag: a
	 * finding is on or off, this is how bad it is right now. An application drawing a meter
	 * reads it every collection, so it has to keep moving while an episode is open and has to
	 * go blank when there is nothing to judge — a stale number would draw a healthy path as
	 * congested for the rest of the call.
	 */
	describe('the severity published on the connection', () => {
		it('carries the same number the finding was raised with', () => {
			const { peerConnection, clientMonitor, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			const payload = clientMonitor.issueOfType(ISSUE_TYPE)?.payload as any;

			expect(peerConnection.uplinkVideoCongestionSeverity).toBe(payload.severity);
		});

		it('keeps moving while the finding stays open', () => {
			const { peerConnection, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			const atOnset = peerConnection.uplinkVideoCongestionSeverity;

			// The same episode, deeper: the estimate has fallen further still.
			congestedTicks(1, { available: THROTTLED_ESTIMATE / 4 });

			expect(atOnset).toBeGreaterThan(0);
			expect(peerConnection.uplinkVideoCongestionSeverity).toBeGreaterThan(atOnset as number);
		});

		it('is published on settled collections too, not only congested ones', () => {
			const { peerConnection, settledTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			// Bandwidth limited, but nothing given up — a probe overshoot rather than a fault.
			tick({ qualityLimitationReason: 'bandwidth' });

			expect(peerConnection.uplinkVideoCongestionSeverity).toBe(0);
		});

		it('goes blank when the browser stops reporting a bandwidth limitation', () => {
			const { peerConnection, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			expect(peerConnection.uplinkVideoCongestionSeverity).toBeGreaterThan(0);

			tick({ qualityLimitationReason: 'none' });

			expect(peerConnection.uplinkVideoCongestionSeverity).toBeUndefined();
		});

		it('goes blank when the browser reports no estimate at all', () => {
			const { peerConnection, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			tick({ available: undefined, qualityLimitationReason: 'bandwidth' });

			expect(peerConnection.uplinkVideoCongestionSeverity).toBeUndefined();
		});
	});

	it('fails closed where the configured severity never arrived', () => {
		const { clientMonitor, settledTicks, congestedTicks, raisedCount } = setup();

		// Untyped config, an `as` cast, config deserialized at runtime. `severity < undefined`
		// is false, so a comparison written that way would raise on every collection.
		clientMonitor.config.uplinkCongestionDetector = {} as any;

		settledTicks(SETTLING_TICKS);
		congestedTicks(4);

		expect(raisedCount()).toBe(0);
	});

	it('does nothing at all while disabled', () => {
		const { clientMonitor, detector, settledTicks, congestedTicks } = setup();

		detector.disabled = true;
		settledTicks(SETTLING_TICKS);
		congestedTicks(4);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.emitted).toHaveLength(0);
	});
});
