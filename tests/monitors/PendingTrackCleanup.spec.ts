/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * `addMediaStreamTrack` parks a track that no report mentions yet -- the normal case for a
 * mediasoup consumer, whose track exists a collection or more before its `inbound-rtp` appears.
 *
 * That waiting room has only two exits: the first report that names the track, which builds its
 * monitor, and the track's `ended` listener. The second is not an exit at all for an application
 * that closes a consumer, because `stop()` dispatches no `ended` event and mediasoup-client
 * removes the listener before calling it. A consumer created and closed inside one collecting
 * period -- ordinary at the 5s period applications run -- therefore stayed parked for the rest of
 * the call, holding a reference to its track, and every one of them accumulated.
 *
 * Nothing downstream ever noticed, which is why it went unseen: a parked track is not in
 * `tracks`, raises nothing and is sampled nowhere. It is a leak and nothing else.
 */
describe('a track parked before its first report', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	const makeTrack = (id: string) => Object.assign(new EventTarget(), {
		id, kind: 'video', label: `cam-${id}`, readyState: 'live',
		muted: false, enabled: true, contentHint: '', getSettings: () => ({}),
	}) as any;

	const inboundReport = (trackId: string, ssrc: number, timestamp: number) => ([{
		type: 'inbound-rtp', id: `in-${ssrc}`, timestamp, ssrc, kind: 'video',
		trackIdentifier: trackId, packetsReceived: 100, bytesReceived: 1000, framesDecoded: 10,
	}] as any);

	const parked = () => (pc as any)._pendingMediaStreamTracks as Map<string, unknown>;

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

	it('is let go once its track has ended', () => {
		const track = makeTrack('trk-1');

		pc.addMediaStreamTrack(track);
		expect(parked().has('trk-1')).toBe(true);

		// `stop()`: readyState moves, nothing is dispatched, and no report ever named it.
		track.readyState = 'ended';
		pc.accept([] as any);

		expect(parked().has('trk-1')).toBe(false);
	});

	it('does not accumulate across a call of short-lived consumers', () => {
		for (let i = 0; i < 25; ++i) {
			const track = makeTrack(`trk-${i}`);

			pc.addMediaStreamTrack(track);
			track.readyState = 'ended';
			pc.accept([] as any);
		}

		expect(parked().size).toBe(0);
	});

	it('keeps one that is merely waiting, however long it waits', () => {
		const track = makeTrack('trk-1');

		pc.addMediaStreamTrack(track);

		for (let i = 0; i < 20; ++i) pc.accept([] as any);

		expect(parked().has('trk-1')).toBe(true);

		// ...and it still builds its monitor when the report finally arrives.
		pc.accept(inboundReport('trk-1', 1111, 1000));

		expect(pc.getInboundTrackMonitor('trk-1')).toBeDefined();
		expect(parked().has('trk-1')).toBe(false);
	});

	it('leaves a waiting track alone while a stopped sibling is let go', () => {
		const waiting = makeTrack('trk-waiting');
		const stopped = makeTrack('trk-stopped');

		pc.addMediaStreamTrack(waiting);
		pc.addMediaStreamTrack(stopped);

		stopped.readyState = 'ended';
		pc.accept([] as any);

		expect(parked().has('trk-stopped')).toBe(false);
		expect(parked().has('trk-waiting')).toBe(true);
	});
});
