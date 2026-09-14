/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * A track that ended is not a track that failed, and the two look identical in the stats: both
 * deliver nothing.
 *
 * The only thing that tells them apart is the `MediaStreamTrack` itself, and the `ended` event is
 * not enough to read it. By the Media Capture spec that event fires only when a track ends on its
 * own; `stop()` sets `readyState` and dispatches nothing. mediasoup-client's `Consumer.close()`
 * goes further and removes the listener before calling `stop()`, so for every consumer an
 * application closes, the event never arrives.
 *
 * Cleanup then falls to `_checkVisited`, which needs the browser to stop reporting the
 * inbound-rtp -- and one consumer per receive transport keeps being reported, because
 * mediasoup-client only *disables* the first m-section rather than rejecting it, to keep BUNDLE
 * intact. That track went on being judged for the rest of the call: `dry-inbound-track` raised
 * against a consumer that was closed minutes ago.
 *
 * So the detectors read `InboundTrackMonitor.readyState` directly, rather than waiting to be told.
 */
describe('an inbound track that ended while its stats keep arriving', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	const makeTrack = (id: string) => Object.assign(new EventTarget(), {
		id, kind: 'video', label: `cam-${id}`, readyState: 'live',
		muted: false, enabled: true, contentHint: '', getSettings: () => ({}),
	}) as any;

	/** One collection. `bytes` is the running total, so repeating it is a dry tick. */
	const report = (timestamp: number, bytes: number) => ([{
		type: 'inbound-rtp', id: 'in-1', timestamp, ssrc: 1111,
		kind: 'video', trackIdentifier: 'trk-1',
		packetsReceived: 100, bytesReceived: bytes, framesDecoded: 10,
	}] as any);

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0, samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pc);
	});

	afterEach(() => monitor.close());

	/** Collections at a 2s cadence that deliver no new bytes, with the detectors run on each. */
	const runDryCollections = (trackMonitor: any, count: number, from = 2000) => {
		for (let i = 0; i < count; ++i) {
			pc.accept(report(from + i * 2000, 1000));
			trackMonitor.update();
		}
	};

	const setup = () => {
		const track = makeTrack('trk-1');

		pc.addMediaStreamTrack(track);
		pc.accept(report(1000, 1000));

		const trackMonitor = pc.getInboundTrackMonitor('trk-1')!;

		expect(trackMonitor).toBeDefined();

		return { track, trackMonitor };
	};

	const dryIssues = () => monitor.getActiveIssuesByType('dry-inbound-track');

	it('raises while the track is live, which is what makes the stand-down meaningful', () => {
		const { trackMonitor } = setup();

		// Past the 5s default threshold.
		runDryCollections(trackMonitor, 6);

		expect(dryIssues()).toHaveLength(1);
		expect(trackMonitor.readyState).toBe('live');
	});

	it('raises nothing for a track stopped before it ever went dry', () => {
		const { track, trackMonitor } = setup();

		// `stop()`: readyState moves, no event is dispatched, the reports keep coming.
		track.readyState = 'ended';

		runDryCollections(trackMonitor, 6);

		expect(trackMonitor.readyState).toBe('ended');
		expect(dryIssues()).toHaveLength(0);
		expect(trackMonitor.dry).toBeUndefined();
	});

	it('resolves an issue already open when the track is stopped mid-episode', () => {
		const { track, trackMonitor } = setup();

		runDryCollections(trackMonitor, 6);
		expect(dryIssues()).toHaveLength(1);

		track.readyState = 'ended';
		runDryCollections(trackMonitor, 1, 14000);

		expect(dryIssues()).toHaveLength(0);
	});

	it('does not raise it again on any later collection', () => {
		const { track, trackMonitor } = setup();

		track.readyState = 'ended';
		runDryCollections(trackMonitor, 30);

		expect(dryIssues()).toHaveLength(0);
		expect(trackMonitor.dry).toBeUndefined();
	});

	it('reports the readyState it judged on', () => {
		const { track, trackMonitor } = setup();

		expect(trackMonitor.readyState).toBe('live');

		track.readyState = 'ended';

		expect(trackMonitor.readyState).toBe('ended');
		expect(trackMonitor.readyState).toBe('ended');
	});

	/**
	 * The contract above, widened to every detector the track carries rather than the one that
	 * reported the bug. Pathological stats -- nothing arriving, nothing decoding, nothing
	 * rendering, playout drifting -- are fed for long enough that the whole set has something to
	 * say, first on a live track to show the input really is bad, then on a stopped one.
	 */
	describe('no detector on the track judges it', () => {
		/** A collection where every counter says "nothing happened", for both kinds. */
		const pathological = (timestamp: number, kind: 'audio' | 'video') => ([{
			type: 'inbound-rtp', id: `in-${kind}`, timestamp, ssrc: kind === 'video' ? 1111 : 2222,
			kind, trackIdentifier: 'trk-1',
			// Frozen totals: no bytes, no packets, no frames in or out.
			packetsReceived: 100, bytesReceived: 1000,
			framesReceived: 10, framesDecoded: 10, framesRendered: 5, framesDropped: 5,
			keyFramesDecoded: 1, pliCount: 40, freezeCount: 9, totalFreezesDuration: 30,
			jitter: 0.4, packetsLost: 400, qpSum: 90000,
			totalDecodeTime: 40, totalInterFrameDelay: 40, totalSquaredInterFrameDelay: 800,
			frameWidth: 320, frameHeight: 180, framesPerSecond: 1,
			jitterBufferDelay: 40, jitterBufferEmittedCount: 100, jitterBufferTargetDelay: 40,
			estimatedPlayoutTimestamp: 1,
			concealedSamples: 90000, concealmentEvents: 900, totalSamplesReceived: 100000,
			insertedSamplesForDeceleration: 40000, removedSamplesForAcceleration: 40000,
		}] as any);

		const drive = (kind: 'audio' | 'video', stopAt?: number) => {
			const track = makeTrack('trk-1');

			track.kind = kind;
			pc.addMediaStreamTrack(track);

			for (let i = 0; i < 20; ++i) {
				if (stopAt !== undefined && i === stopAt) track.readyState = 'ended';

				pc.accept(pathological(1000 + i * 2000, kind));
				pc.getInboundTrackMonitor('trk-1')?.update();
			}

			return { track, trackMonitor: pc.getInboundTrackMonitor('trk-1') };
		};

		/** Every issue the client monitor holds, whatever its type. */
		const activeTypes = () => [ ...(monitor as any).activeIssues.keys() ] as string[];

		it.each([ 'audio', 'video' ] as const)('reports something on a live %s track', (kind) => {
			drive(kind);

			expect(activeTypes().length).toBeGreaterThan(0);
		});

		it.each([ 'audio', 'video' ] as const)('reports nothing once the %s track is stopped', (kind) => {
			drive(kind, 0);

			expect(activeTypes()).toEqual([]);
		});

		it.each([ 'audio', 'video' ] as const)('resolves what it had open when the %s track is stopped', (kind) => {
			drive(kind, 10);

			expect(activeTypes()).toEqual([]);
		});
	});

	/**
	 * Standing down keeps a dead track quiet; it does not make it go away. These pin the other
	 * half: the monitor is forgotten on the collection its track reads `ended`, without waiting
	 * for the stats to stop -- which, for one consumer per receive transport, they never do.
	 */
	describe('and is forgotten rather than left silent', () => {
		it('drops the track monitor while its rtp is still being reported', () => {
			const { track, trackMonitor } = setup();

			expect(pc.getInboundTrackMonitor('trk-1')).toBe(trackMonitor);

			track.readyState = 'ended';
			pc.accept(report(3000, 1000));

			expect(pc.getInboundTrackMonitor('trk-1')).toBeUndefined();
			expect(monitor.tracks).toHaveLength(0);
			expect(pc.createSample().inboundTracks).toHaveLength(0);
		});

		/**
		 * The browser is still reporting that component, and a component being reported is not a
		 * component that went away. It is the track that is over, not the stream.
		 */
		it('leaves the rtp monitor alone, because it is still reported', () => {
			const { track } = setup();

			track.readyState = 'ended';
			pc.accept(report(3000, 1000));

			expect(pc.inboundRtps).toHaveLength(1);

			// ...and it goes when the report does, by the ordinary rule.
			pc.accept([] as any);

			expect(pc.inboundRtps).toHaveLength(0);
		});

		it('does not rebuild it on any later report', () => {
			const { track } = setup();

			track.readyState = 'ended';

			for (let i = 0; i < 20; ++i) pc.accept(report(3000 + i * 2000, 1000 + i * 100));

			expect(pc.getInboundTrackMonitor('trk-1')).toBeUndefined();
			expect(monitor.tracks).toHaveLength(0);
		});

		it('resolves what the track had open on the way out', () => {
			const { track, trackMonitor } = setup();

			runDryCollections(trackMonitor, 6);
			expect(dryIssues()).toHaveLength(1);

			track.readyState = 'ended';
			pc.accept(report(20000, 1000));

			expect(pc.getInboundTrackMonitor('trk-1')).toBeUndefined();
			expect(dryIssues()).toHaveLength(0);
		});

		it('keeps a live track through the same pass', () => {
			const { trackMonitor } = setup();

			pc.accept(report(3000, 2000));

			expect(pc.getInboundTrackMonitor('trk-1')).toBe(trackMonitor);
		});
	});
});

/**
 * The outbound mirror. An application stops its producer tracks the same way, so the same gap
 * existed there -- with one extra obligation: `CaptureSourceLostDetector` asks whether a capture
 * device went away by itself, and its answer is only available while the track monitor is still
 * there. `sourceEnded` marks that case, set from the `ended` event, which is dispatched for a lost
 * device and never for `stop()`.
 */
describe('an outbound track that ended while its media source keeps arriving', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	const makeTrack = (id: string) => Object.assign(new EventTarget(), {
		id, kind: 'video', label: `cam-${id}`, readyState: 'live',
		muted: false, enabled: true, contentHint: '', getSettings: () => ({}),
	}) as any;

	const mediaSource = (timestamp: number) => ([{
		type: 'media-source', id: 'src-1', timestamp,
		trackIdentifier: 'trk-1', kind: 'video', width: 1280, height: 720,
	}] as any);

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0, samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pc);
	});

	afterEach(() => monitor.close());

	const setup = () => {
		const track = makeTrack('trk-1');

		pc.accept(mediaSource(1000));
		pc.addMediaStreamTrack(track);

		expect(pc.getOutboundTrackMonitor('trk-1')).toBeDefined();

		return { track, trackMonitor: pc.getOutboundTrackMonitor('trk-1')! };
	};

	it('drops the track monitor while its media source is still being reported', () => {
		const { track } = setup();

		// `stop()`: no event, and the source goes on being reported.
		track.readyState = 'ended';
		pc.accept(mediaSource(3000));

		expect(pc.getOutboundTrackMonitor('trk-1')).toBeUndefined();
		expect(pc.mediaSources).toHaveLength(1);
		expect(monitor.tracks).toHaveLength(0);
	});

	it('gives a lost capture source its last look before forgetting it', () => {
		const { track, trackMonitor } = setup();
		const detectorsUpdate = jest.spyOn(trackMonitor.detectors, 'update');

		// A device that went away by itself: the event is dispatched, and `readyState` moves.
		track.readyState = 'ended';
		track.dispatchEvent(new Event('ended'));

		expect(trackMonitor.sourceEnded).toBe(true);
		// Still there: the detector whose question this is has not been asked yet.
		expect(pc.getOutboundTrackMonitor('trk-1')).toBe(trackMonitor);

		pc.accept(mediaSource(3000));

		expect(detectorsUpdate).toHaveBeenCalledTimes(1);
		expect(pc.getOutboundTrackMonitor('trk-1')).toBeUndefined();
	});

	it('keeps a live track through the same pass', () => {
		const { trackMonitor } = setup();

		pc.accept(mediaSource(3000));

		expect(pc.getOutboundTrackMonitor('trk-1')).toBe(trackMonitor);
	});
});
