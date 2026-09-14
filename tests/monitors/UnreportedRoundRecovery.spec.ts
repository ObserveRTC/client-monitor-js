/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * A `getStats()` round that omits a track's report is not evidence the track went away: it
 * happens in ordinary calls and more often on busy clients, while the media keeps flowing.
 *
 * It used to cost the track its monitor for the rest of the session. `_checkVisited` dropped
 * the inbound rtp monitor and the track monitor hanging off it, and the rebuild path looked
 * only in `_pendingMediaStreamTracks` -- an entry consumed when the monitor was first built.
 * From then on `getInboundTrackMonitor` returned nothing for a track whose video was playing
 * fine: no detectors, no score contribution, and none of the context the application declared.
 */
describe('a stats round that omits a track', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	const makeTrack = (id: string) => Object.assign(new EventTarget(), {
		id, kind: 'video', label: `cam-${id}`, readyState: 'live',
		muted: false, enabled: true, contentHint: '', getSettings: () => ({}),
	}) as any;

	const inboundReport = (timestamp: number) => ([{
		type: 'inbound-rtp', id: 'in-1', timestamp, ssrc: 1111,
		kind: 'video', trackIdentifier: 'trk-1',
		packetsReceived: timestamp, bytesReceived: timestamp * 100, framesDecoded: timestamp,
	}] as any);

	/** A round carrying something, so the clock moves, but not this track's report. */
	const otherReport = (timestamp: number) => ([{
		type: 'peer-connection', id: 'pc', timestamp,
		dataChannelsOpened: 0, dataChannelsClosed: 0,
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

	it('keeps the track monitor, its identity and its context', () => {
		const track = makeTrack('trk-1');

		// A mediasoup consumer: the track is handed over before any report mentions it.
		pc.addMediaStreamTrack(track, { some: 'attachment' });
		monitor.setInboundTrackContext('trk-1', { contentType: 'screenshare' });

		pc.accept(inboundReport(1000));
		const trackMonitor = pc.getInboundTrackMonitor('trk-1');

		expect(trackMonitor).toBeDefined();
		expect(trackMonitor!.contentType).toBe('screenshare');

		pc.accept(otherReport(2000));

		expect(pc.getInboundTrackMonitor('trk-1')).toBe(trackMonitor);
		expect(trackMonitor!.contentType).toBe('screenshare');
		expect(trackMonitor!.attachments).toEqual({ some: 'attachment' });

		// and the same rtp monitor, so nothing downstream is holding a dead reference
		const inboundRtp = trackMonitor!.getInboundRtp();

		pc.accept(inboundReport(3000));

		expect(pc.getInboundTrackMonitor('trk-1')).toBe(trackMonitor);
		expect(trackMonitor!.getInboundRtp()).toBe(inboundRtp);
		expect(pc.inboundRtps).toHaveLength(1);
	});

	it('costs the window a gap rather than a fabricated sample', () => {
		const track = makeTrack('trk-1');

		pc.addMediaStreamTrack(track);
		pc.accept(inboundReport(1000));

		const trackMonitor = pc.getInboundTrackMonitor('trk-1')!;
		const window = (trackMonitor as any).slicedWindow;

		trackMonitor.update();
		const entriesAfterFirst = window.numberOfEntries;

		// The round said nothing about this track, so its clock did not move and the totals
		// it holds still describe the stretch already in the window.
		pc.accept(otherReport(2000));
		trackMonitor.update();

		expect(window.numberOfEntries).toBe(entriesAfterFirst);
	});

	it('still drops everything for a track torn down with stop(), which dispatches nothing', () => {
		const track = makeTrack('trk-1');

		pc.addMediaStreamTrack(track);
		pc.accept(inboundReport(1000));
		expect(pc.getInboundTrackMonitor('trk-1')).toBeDefined();

		track.readyState = 'ended';
		pc.accept(otherReport(2000));

		expect(pc.getInboundTrackMonitor('trk-1')).toBeUndefined();
		expect(pc.inboundRtps).toHaveLength(0);
	});
});
