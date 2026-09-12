/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownlinkCongestionDetector } from "../../src/detectors/DownlinkCongestionDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	minSeverity: 0.65,
	bufferBloatingSaturatesAt: 4,
};

const ISSUE_TYPE = 'downlink-congestion';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/** The two witnesses, restated so an expectation reads as arithmetic rather than a number. */
const undershootOf = (receiving: number, recentMax: number) => Math.max(0, 1 - (receiving / recentMax));

/** Zero at the baseline, one at four times it. */
const BUFFER_BLOATING_SATURATES_AT = 4;
const MIN_JITTER_BUFFER_DELAY_IN_MS = 10;
const bufferBloatingOf = (buffer: number, baseline: number) => {
	const floored = Math.max(baseline, MIN_JITTER_BUFFER_DELAY_IN_MS);

	return Math.min(1, Math.max(0, (buffer - floored) / (floored * (BUFFER_BLOATING_SATURATES_AT - 1))));
};
const severityOf = (undershoot: number, bufferBloating: number) => Math.sqrt(undershoot * bufferBloating);

/** The share of `minSeverity` the severity must fall under before a finding closes. */
const RESOLVE_SEVERITY_FRACTION = 0.5;

/** The recent maximum fades at this rate per second of stats time. */
const DECAY_PER_SECOND = 0.996;

/** A few settled collections before the interesting one. No gate requires them. */
const SETTLING_TICKS = 3;

/**
 * The measured throttle from the receiving side: 1849 kbps arriving with frames spending
 * 12ms in the jitter buffer, against ~420 kbps and 3109ms while throttled.
 */
const HEALTHY_BITRATE = 1_849_000;
const THROTTLED_BITRATE = 420_000;
const HEALTHY_BUFFER_MS = 12;
const BLOATED_BUFFER_MS = 3109;

class MockCapacityPeerConnection extends MockPeerConnectionMonitor {
	public receivingBitrate = 0;

	/** Whether any inbound video stream was present this collection. */
	public hasInboundVideo = true;

	/** Mean time a video frame spent in the jitter buffer over this collection. */
	public avgInboundVideoJitterBufferDelayInMs: number | undefined = undefined;

	/** The gap between the two stats reports this collection came from. */
	public deltaTime: number | undefined = 1000;

	public downlinkCongested = false;
}

type TickInput = {
	bitrate?: number;
	buffer?: number;
	deltaTime?: number;
	hasInboundVideo?: boolean;
};

function setup(config: Partial<typeof CONFIG> = {}) {
	const peerConnection = new MockCapacityPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.downlinkCongestionDetector = { ...CONFIG, ...config };

	const detector = new DownlinkCongestionDetector(peerConnection as any);

	/** One collection, as the monitor would present it. */
	const tick = (input: TickInput = {}) => {
		peerConnection.deltaTime = input.deltaTime ?? 1000;
		peerConnection.receivingBitrate = input.bitrate ?? HEALTHY_BITRATE;
		peerConnection.avgInboundVideoJitterBufferDelayInMs = 'buffer' in input ? input.buffer : HEALTHY_BUFFER_MS;
		peerConnection.hasInboundVideo = input.hasInboundVideo ?? true;
		detector.update();
	};

	/**
	 * A settled collection. Enough of these give the detector a maximum to measure an
	 * undershoot against and a median to measure bloating against.
	 */
	const settledTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) tick(input);
	};

	/** The onset of a throttle: the arriving bitrate undershoots and the buffer bloats. */
	const congestedTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) {
			tick({ bitrate: THROTTLED_BITRATE, buffer: BLOATED_BUFFER_MS, ...input });
		}
	};

	const raisedCount = () => clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE).length;

	return { detector, peerConnection, clientMonitor, tick, settledTicks, congestedTicks, raisedCount };
}

describe('DownlinkCongestionDetector', () => {
	it('is named after the fault and the direction it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('downlink-congestion-detector');
	});

	it('raises when the undershoot and the buffer bloating hold together', () => {
		const { clientMonitor, settledTicks, congestedTicks } = setup();

		settledTicks(SETTLING_TICKS);
		congestedTicks(1);

		// The baselines are what the settled collections left behind. This collection is
		// judged against them and only then joins them, so it cannot move its own baseline.
		const undershoot = undershootOf(THROTTLED_BITRATE, HEALTHY_BITRATE);
		const bufferBloating = bufferBloatingOf(BLOATED_BUFFER_MS, HEALTHY_BUFFER_MS);
		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			receivingBitrate: THROTTLED_BITRATE,
			recentMaxReceivingBitrate: HEALTHY_BITRATE,
			undershoot,
			bufferBloating,
			severity: severityOf(undershoot, bufferBloating),
			avgJitterBufferDelayInMs: BLOATED_BUFFER_MS,
			estimatedMedianJitterBufferDelayInMs: HEALTHY_BUFFER_MS,
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
		it('says nothing when the bitrate undershoots with the buffer flat', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// A muted camera, a dropped simulcast layer, a still screen share: the far end
			// was asked for less, and the link carried every bit of it.
			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { buffer: HEALTHY_BUFFER_MS });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing when the buffer bloats with the bitrate holding up', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { bitrate: HEALTHY_BITRATE });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing about a buffer that is deep but has not bloated', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// A buffer that was always this deep is this connection's normal, whatever the
			// absolute number looks like.
			settledTicks(SETTLING_TICKS, { buffer: BLOATED_BUFFER_MS });
			congestedTicks(4, { buffer: BLOATED_BUFFER_MS });

			expect(raisedCount()).toBe(0);
		});

		it('says nothing about a buffer bloating from nothing to nothing', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			// Four times the baseline and still under the noise floor: 2ms at 8ms is
			// arithmetic, and a ratio alone cannot say so.
			settledTicks(SETTLING_TICKS, { buffer: 2 });
			congestedTicks(4, { buffer: 8 });

			expect(raisedCount()).toBe(0);
		});

		it('scores a bitrate above its recent maximum as no undershoot at all', () => {
			const { settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { bitrate: HEALTHY_BITRATE * 2 });

			expect(raisedCount()).toBe(0);
		});

		it('takes two moderate witnesses over one extreme one', () => {
			const { clientMonitor, settledTicks, tick } = setup();

			// An undershoot of nearly one with the buffer at its median scores zero, because
			// the geometric mean multiplies. Two moderate witnesses clear the bar that one
			// extreme witness cannot.
			settledTicks(SETTLING_TICKS);
			tick({ bitrate: 1, buffer: HEALTHY_BUFFER_MS });

			expect(clientMonitor.getIssues()).toHaveLength(0);

			// Undershoot ~0.66 and bloating ~0.67: severity ~0.66, just over the bar.
			tick({ bitrate: HEALTHY_BITRATE * 0.34, buffer: HEALTHY_BUFFER_MS * 3 });

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});
	});

	describe('what it does not read', () => {
		it('judges a receive-only connection, which has no limitation verdict at all', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			// The mock reports no `qualityLimitationReason` and never has. A detector gating
			// on that verdict — as the uplink one does, correctly — is permanently blind on a
			// webinar attendee, which is the population most in need of a downlink verdict.
			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});
	});

	describe('the baselines it measures against', () => {
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

			// Twenty collections with the buffer held at two and a half times its median —
			// enough bloating to keep the finding open, close enough to the median that a
			// median creeping towards it would take the bloating to zero. Were the median
			// taking these samples it would reach them within a dozen collections and the
			// episode would talk itself out of existence while frames were still waiting.
			congestedTicks(20, { buffer: HEALTHY_BUFFER_MS * 2.5 });

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('fades the maximum by elapsed time rather than by collection', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);

			// One collection, sixty seconds of it. The maximum fades per second of stats
			// time, so applications collecting at different periods forget at the same rate.
			tick({ bitrate: HEALTHY_BITRATE * 0.5, deltaTime: 60_000 });
			congestedTicks(1);

			const faded = HEALTHY_BITRATE * Math.pow(DECAY_PER_SECOND, 60);

			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.recentMaxReceivingBitrate)
				.toBeCloseTo(faded, 0);
		});

		it('keeps feeding the maximum while a finding is open, which is what lets it forget', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			expect(clientMonitor.getIssues()).toHaveLength(1);

			// Ten minutes of stats time on the narrowed path. Nothing at a receiver knows
			// what the path can carry now, so the only way the finding can ever close is for
			// the baseline to fade towards what is actually arriving.
			congestedTicks(20, { deltaTime: 30_000 });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment)
				.toBe('the undershoot and the buffer bloating have both eased');
		});
	});

	describe('the conditions it refuses to judge on', () => {
		it('says nothing about a connection with no inbound video', () => {
			const { detector, settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(4, { hasInboundVideo: false });

			expect(raisedCount()).toBe(0);
			// Nothing to judge is not the same as being unable to see.
			expect(detector.inputsUnavailable).toBe(false);
		});

		it('reports being blind where no frame left the buffer to measure', () => {
			const { detector, settledTicks, congestedTicks, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(2, { buffer: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(raisedCount()).toBe(0);
		});
	});

	describe('closing the finding', () => {
		it('resolves once both witnesses have eased', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			tick();

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment)
				.toBe('the undershoot and the buffer bloating have both eased');
			expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toEqual(expect.any(Number));
		});

		it('holds the finding open between the bar and the fraction of it that closes one', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			// Severity around 0.45: under the bar that opened the finding, over the fraction
			// of it that closes one. The gap is the hysteresis, and it is what stops a path
			// sitting on the line from flapping the issue open and shut.
			const easing = () => tick({ bitrate: HEALTHY_BITRATE * 0.7, buffer: HEALTHY_BUFFER_MS * 2.5 });

			easing();

			const severity = severityOf(
				undershootOf(HEALTHY_BITRATE * 0.7, HEALTHY_BITRATE),
				bufferBloatingOf(HEALTHY_BUFFER_MS * 2.5, HEALTHY_BUFFER_MS),
			);

			expect(severity).toBeLessThan(CONFIG.minSeverity);
			expect(severity).toBeGreaterThan(CONFIG.minSeverity * RESOLVE_SEVERITY_FRACTION);
			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('closes the finding when the inbound video goes away', () => {
			const { clientMonitor, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			congestedTicks(1, { hasInboundVideo: false });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment).toBe('no inbound video on this connection');
		});

		it('opens a second finding for a second episode', () => {
			const { clientMonitor, settledTicks, congestedTicks, tick, raisedCount } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			tick();
			congestedTicks(1);

			expect(raisedCount()).toBe(2);
			expect(clientMonitor.getIssues()).toHaveLength(1);
		});
	});


	describe('the connection attribute', () => {
		it('moves with the finding rather than with the collection', () => {
			const { peerConnection, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			expect(peerConnection.downlinkCongested).toBe(false);

			congestedTicks(1);
			expect(peerConnection.downlinkCongested).toBe(true);

			tick();
			expect(peerConnection.downlinkCongested).toBe(false);
		});
	});

	it('fails closed where the configured severity never arrived', () => {
		const { clientMonitor, settledTicks, congestedTicks, raisedCount } = setup();

		// Untyped config, an `as` cast, config deserialized at runtime. `severity < undefined`
		// is false, so a comparison written that way would raise on every collection.
		clientMonitor.config.downlinkCongestionDetector = {} as any;

		settledTicks(SETTLING_TICKS);
		congestedTicks(4);

		expect(raisedCount()).toBe(0);
	});


	/**
	 * `downlinkVideoCongestionSeverity` is the continuous reading beside the boolean flag: a
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

			expect(peerConnection.downlinkVideoCongestionSeverity).toBe(payload.severity);
		});

		it('keeps moving while the finding stays open', () => {
			const { peerConnection, settledTicks, congestedTicks } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			const atOnset = peerConnection.downlinkVideoCongestionSeverity;

			// The same episode, deeper: less is arriving than at its onset.
			congestedTicks(1, { bitrate: THROTTLED_BITRATE / 4 });

			expect(atOnset).toBeGreaterThan(0);
			expect(peerConnection.downlinkVideoCongestionSeverity).toBeGreaterThan(atOnset as number);
		});

		it('is published on settled collections too, not only congested ones', () => {
			const { peerConnection, settledTicks } = setup();

			settledTicks(SETTLING_TICKS + 1);

			expect(peerConnection.downlinkVideoCongestionSeverity).toBe(0);
		});

		it('goes blank when there is no inbound video to judge', () => {
			const { peerConnection, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);
			expect(peerConnection.downlinkVideoCongestionSeverity).toBeGreaterThan(0);

			tick({ hasInboundVideo: false });

			expect(peerConnection.downlinkVideoCongestionSeverity).toBeUndefined();
		});

		it('goes blank when no frame left the buffer to measure', () => {
			const { peerConnection, settledTicks, congestedTicks, tick } = setup();

			settledTicks(SETTLING_TICKS);
			congestedTicks(1);

			tick({ buffer: undefined });

			expect(peerConnection.downlinkVideoCongestionSeverity).toBeUndefined();
		});
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
