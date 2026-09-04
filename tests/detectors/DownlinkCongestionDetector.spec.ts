/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownlinkCongestionDetector } from "../../src/detectors/DownlinkCongestionDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	collapseRatio: 0.6,
	bufferElevationRatio: 2,
};

const ISSUE_TYPE = 'downlink-congestion';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/**
 * The measured throttle from the receiving side: 1849 kbps arriving healthy
 * against ~420 while throttled, and per-frame jitter buffer delay 5-20 ms against
 * 3109 ms.
 */
const HEALTHY_BITRATE = 1_849_000;
const THROTTLED_BITRATE = 420_000;
const HEALTHY_BUFFER_MS = 12;
const THROTTLED_BUFFER_MS = 3109;

class MockCapacityPeerConnection extends MockPeerConnectionMonitor {
	public receivingBitrate = 0;

	/** The gap between the two stats reports this collection came from. */
	public deltaTime: number | undefined = 1000;

	/**
	 * The connection's accumulated stats time, which the real monitor advances by
	 * `deltaTime` on every collection. The detector's window ages on this.
	 */
	public statsClockTime = 0;
	public avgInboundVideoJitterBufferDelayInMs: number | undefined = undefined;
	public ewmaInboundVideoJitterBufferDelayInMs: number | undefined = undefined;
	public avgInboundFractionLost: number | undefined = undefined;
	public downlinkCongested = false;

	/** Whether any inbound video stream was present this collection. */
	public hasInboundVideo = true;

	/**
	 * The browser's own limitation verdict, folded across the streams that sent
	 * anything. `undefined` where nothing was sent, which is a receive-only
	 * connection — this detector's largest blind spot.
	 */
	public qualityLimitationReason: string | undefined = undefined;
}

type TickInput = {
	bitrate?: number;
	deltaTime?: number;
	/** `undefined` stands for a browser reporting no buffer counters, or a stream emitting no frames. */
	buffer?: number;
	/** The smoothed level, which is what a baseline is taken from between episodes. */
	ewmaBuffer?: number;
	fractionLost?: number;
	/** `false` stands for a connection carrying no inbound video at all. */
	hasInboundVideo?: boolean;
	/** `undefined` stands for a connection with no sending stream to have a verdict about. */
	qualityLimitationReason?: string;
};

function setup() {
	const peerConnection = new MockCapacityPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.downlinkCongestionDetector = { ...CONFIG };

	const detector = new DownlinkCongestionDetector(peerConnection as any);

	const tick = (input: TickInput = {}) => {
		peerConnection.deltaTime = input.deltaTime ?? 1000;
		peerConnection.statsClockTime += peerConnection.deltaTime;
		peerConnection.receivingBitrate = input.bitrate ?? HEALTHY_BITRATE;
		peerConnection.avgInboundVideoJitterBufferDelayInMs = 'buffer' in input ? input.buffer : HEALTHY_BUFFER_MS;
		peerConnection.ewmaInboundVideoJitterBufferDelayInMs = input.ewmaBuffer ??
			peerConnection.avgInboundVideoJitterBufferDelayInMs;
		peerConnection.avgInboundFractionLost = input.fractionLost ?? 0;
		peerConnection.hasInboundVideo = input.hasInboundVideo ?? true;
		peerConnection.qualityLimitationReason = 'qualityLimitationReason' in input
			? input.qualityLimitationReason
			: 'none';
		detector.update();
	};

	/**
	 * A healthy stretch. It is where the buffer baseline comes from, and where the
	 * detector's own rolling window gets a maximum to measure a collapse against —
	 * one sample is not a maximum.
	 */
	const healthyTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) tick(input);
	};

	/**
	 * The throttled state: the browser reporting the path bandwidth-limited, less
	 * arriving, and the buffer holding frames far longer.
	 */
	const throttledTicks = (count: number, input: TickInput = {}) => {
		for (let i = 0; i < count; ++i) {
			tick({
				bitrate: THROTTLED_BITRATE,
				buffer: THROTTLED_BUFFER_MS,
				ewmaBuffer: HEALTHY_BUFFER_MS,
				qualityLimitationReason: 'bandwidth',
				...input,
			});
		}
	};

	return { detector, peerConnection, clientMonitor, tick, healthyTicks, throttledTicks };
}

describe('DownlinkCongestionDetector', () => {
	it('is named after the fault and the direction it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('downlink-congestion-detector');
	});

	it('raises when the verdict, the collapse and the queue all hold', () => {
		const { clientMonitor, healthyTicks, throttledTicks } = setup();

		healthyTicks(1);
		throttledTicks(1, { fractionLost: 0.39 });

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			receivingBitrate: THROTTLED_BITRATE,
			maxReceivingBitrate: HEALTHY_BITRATE,
			jitterBufferDelayInMs: THROTTLED_BUFFER_MS,
			baselineJitterBufferDelayInMs: HEALTHY_BUFFER_MS,
			fractionLost: 0.39,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	it('raises once per episode however long it lasts', () => {
		const { clientMonitor, healthyTicks, throttledTicks } = setup();

		healthyTicks(1);
		throttledTicks(8);

		expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(1);
	});

	describe('the three that must hold together', () => {
		it('says nothing without the browser calling the path bandwidth limited', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			// Everything else about these collections says congestion. The verdict is
			// far too eager to raise on by itself — precision 0.53 over a throttled run
			// — but as one of three it is what rules out a collapse the path did not
			// cause.
			healthyTicks(1);
			throttledTicks(4, { qualityLimitationReason: 'none' });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('says nothing when the bitrate collapses with the buffer perfectly normal', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			// A remote peer who muted, a static screen share, a dropped simulcast
			// layer: less was sent, and the link carried all of it.
			healthyTicks(1);
			throttledTicks(4, { buffer: HEALTHY_BUFFER_MS });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('says nothing when the buffer deepens while the bitrate holds up', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(4, { bitrate: HEALTHY_BITRATE });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('leaves an arriving bitrate exactly at the collapse ratio alone', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(4, { bitrate: HEALTHY_BITRATE * CONFIG.collapseRatio });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('says nothing about a buffer that doubled from nothing to nothing', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			// Twice the baseline, and still under the floor: a 5 ms buffer at 10 ms is
			// noise, and a ratio alone cannot say so.
			healthyTicks(1, { buffer: 5, ewmaBuffer: 5 });
			throttledTicks(4, { buffer: 40, ewmaBuffer: 5 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});
	});

	describe('the conditions it refuses to judge on', () => {
		it('says nothing about a connection with no inbound video', () => {
			const { clientMonitor, detector, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(4, { hasInboundVideo: false });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
			expect(detector.inputsUnavailable).toBe(false);
		});

		it('reports being blind where nothing was sent to have a verdict about', () => {
			const { clientMonitor, detector, healthyTicks, throttledTicks } = setup();

			// A receive-only viewer is the common case here, and the cost of borrowing
			// a sending-side verdict to judge the receiving direction. Blind is the
			// honest answer; silence would read as a healthy path.
			healthyTicks(1);
			throttledTicks(4, { qualityLimitationReason: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('reports being blind where no frame left the buffer to measure', () => {
			const { clientMonitor, detector, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(2, { buffer: undefined });

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('says nothing on the first collection, before there is a baseline or a window', () => {
			const { clientMonitor, throttledTicks } = setup();

			// Nothing to compare the buffer against, and one sample is not a maximum
			// to measure a collapse against either.
			throttledTicks(1);

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('ages its window in stats time, so a late collection costs what it cost', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(2);

			// Twelve seconds in one collection: the peak is older than the window
			// however few collections it took to get here, so there is no maximum left
			// to measure a collapse against.
			throttledTicks(1, { deltaTime: 12000 });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);
		});

		it('forgets a peak that has aged out of its window', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(2);

			// Eleven quiet collections on the narrowed path — the browser is not
			// calling it bandwidth limited, so nothing is raised, but the window keeps
			// filling. By the end the healthy peak is older than the ten seconds of
			// stats time the window holds.
			throttledTicks(11, { qualityLimitationReason: 'none' });

			expect(clientMonitor.raisedIssues.filter((issue) => issue.type === ISSUE_TYPE)).toHaveLength(0);

			// A further collapse, from the narrowed level rather than from the wide
			// one: half of what has actually been arriving for the last ten seconds.
			throttledTicks(1, { bitrate: THROTTLED_BITRATE / 2 });

			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.maxReceivingBitrate)
				.toBe(THROTTLED_BITRATE);
		});
	});

	describe('the loss it records without resting on', () => {
		it('raises on a collapse with no loss at all', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			// Loss is an onset event: on an unchanged throttle it burns for about six
			// seconds and then reads zero, while the viewer stays pinned at a quarter
			// of their bandwidth.
			healthyTicks(1);
			throttledTicks(1, { fractionLost: 0 });

			expect(clientMonitor.getIssues()).toHaveLength(1);
			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.fractionLost).toBe(0);
		});
	});

	describe('closing the finding', () => {
		it('resolves when the browser stops reporting a bandwidth limitation', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(1);
			throttledTicks(1);

			tick({ qualityLimitationReason: 'none' });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment)
				.toBe('the browser no longer reports the path as bandwidth limited');
			expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toEqual(expect.any(Number));
		});

		it('resolves on a path that settled below what it used to carry', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(1);
			throttledTicks(1);

			// Half the old capacity, the buffer still deep, and the limitation gone:
			// this link has recovered, and it is never coming back to where it was.
			// A recovery threshold on the arriving bitrate would hold the finding open
			// for the rest of the call.
			tick({
				bitrate: HEALTHY_BITRATE * 0.5,
				buffer: THROTTLED_BUFFER_MS,
				qualityLimitationReason: 'none',
			});

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('holds the finding open while the limitation stands, whatever the bitrate does', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(1);
			throttledTicks(1);

			// Recovered to the old level by the numbers, still bandwidth limited by the
			// browser: the episode is not over.
			tick({ bitrate: HEALTHY_BITRATE, qualityLimitationReason: 'bandwidth' });

			expect(clientMonitor.getIssues()).toHaveLength(1);
		});

		it('closes the finding when the limitation becomes something other than bandwidth', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(1);
			throttledTicks(1);

			// The verdict is no longer `bandwidth`, so as far as the browser is
			// concerned the bandwidth limitation is over — whatever else is now
			// limiting the encoder is a different detector's subject.
			tick({ qualityLimitationReason: 'cpu' });

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('closes the finding when the inbound video goes away', () => {
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);
			throttledTicks(1, { hasInboundVideo: false });

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(clientMonitor.resolvedIssues[0]?.comment).toBe('no inbound video on this connection');
		});

		it('judges the collapse against the baseline from before it, not against this collection', () => {
			// The smoothed level the monitor reports has already begun climbing by the
			// time the collapse is visible — that is what an EWMA does under a rising
			// buffer. Judged against it, an episode would have to out-run its own
			// smoothing to be reported at all.
			const { clientMonitor, healthyTicks, tick } = setup();

			healthyTicks(1, { buffer: 60, ewmaBuffer: 60 });
			tick({
				bitrate: THROTTLED_BITRATE,
				buffer: 150,
				ewmaBuffer: 100,
				qualityLimitationReason: 'bandwidth',
			});

			expect(clientMonitor.getIssues()).toHaveLength(1);
			expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.baselineJitterBufferDelayInMs).toBe(60);
		});

		it('takes its next baseline from where the buffer settles afterwards', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(1);
			throttledTicks(1);
			// Recovered, but to a deeper buffer than the call started with.
			tick({ bitrate: HEALTHY_BITRATE, buffer: 400, ewmaBuffer: 400, qualityLimitationReason: 'none' });

			expect(clientMonitor.getIssues()).toHaveLength(0);

			// A second collapse whose buffer is merely where the last one left it is
			// not a second episode.
			throttledTicks(4, { buffer: 500, ewmaBuffer: 400 });

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('opens a second finding for a second episode', () => {
			const { clientMonitor, healthyTicks, throttledTicks, tick } = setup();

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
			const { clientMonitor, healthyTicks, throttledTicks } = setup();

			healthyTicks(1);
			throttledTicks(1);

			const combined = clientMonitor.emittedOf('congestion');

			expect(combined).toHaveLength(1);
			expect(combined[0]?.payload.direction).toBe('downlink');
			expect(combined[0]?.payload.receivingBitrate).toBe(THROTTLED_BITRATE);
			expect(combined[0]?.payload.jitterBufferDelayInMs).toBe(THROTTLED_BUFFER_MS);
		});
	});

	describe('the connection attribute', () => {
		it('moves with the finding rather than with the collection', () => {
			const { peerConnection, healthyTicks, throttledTicks, tick } = setup();

			healthyTicks(1);
			expect(peerConnection.downlinkCongested).toBe(false);

			throttledTicks(1);
			expect(peerConnection.downlinkCongested).toBe(true);

			tick({ qualityLimitationReason: 'none' });
			expect(peerConnection.downlinkCongested).toBe(false);
		});
	});

	it('does nothing at all while disabled', () => {
		const { clientMonitor, detector, healthyTicks, throttledTicks } = setup();

		detector.disabled = true;
		healthyTicks(1);
		throttledTicks(4);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.emitted).toHaveLength(0);
	});
});
