/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * The lifecycle half of `CaptureSourceLostDetector`, which its own spec cannot reach:
 * whether the track monitor carrying that detector still exists on the collection where
 * the source went away.
 *
 * It used to not. `addMediaStreamTrack` deleted the outbound track monitor straight from
 * the `ended` handler, and `ClientMonitor.update()` drives track detectors from exactly
 * that map — so the browser event announcing a lost device also deleted the detector
 * whose whole subject it was. The detector then fired only where no `ended` event is
 * sent at all, which by specification is `stop()`: the application's own teardown, the
 * one case that is not a finding. These specs pin the inversion shut from both ends.
 */
describe('capture source lost: the track monitor outlives the event', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	const makeTrack = (id: string) => Object.assign(new EventTarget(), {
		id, kind: 'video', label: `cam-${id}`, readyState: 'live',
		muted: false, enabled: true, contentHint: '',
	}) as any;

	/** A stand-in outbound track monitor that records whether its detectors ran. */
	const trackMonitorFor = (track: any) => {
		const updated = { count: 0 };
		const resolveAll = jest.fn();

		return {
			updated,
			resolveAll,
			monitor: {
				track,
				sourceEnded: false,
				detectors: { update: () => { updated.count += 1; } },
				trackIdentifier: track.id,
				issues: { resolveAll },
			} as any,
		};
	};

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pc);
	});

	afterEach(() => {
		monitor.close();
	});

	it('keeps the track monitor when the source goes away, and records why', () => {
		const track = makeTrack('lost');
		const { monitor: trackMonitor } = trackMonitorFor(track);

		pc.addMediaStreamTrack(track);
		pc.mappedOutboundTracks.set(track.id, trackMonitor);

		track.readyState = 'ended';
		track.dispatchEvent(new Event('ended'));

		expect(pc.mappedOutboundTracks.has(track.id)).toBe(true);
		expect(trackMonitor.sourceEnded).toBe(true);
		// ...and it is still reachable by the pass that drives track detectors.
		expect(monitor.tracks).toContain(trackMonitor);
	});

	/**
	 * The source taking its stats entry with it is the normal case, usually on the very
	 * collection where it ended — so the ordinary update pass, which runs after the
	 * sweep, would never see the track again. The sweep gives the detectors their last
	 * look before dropping the monitor.
	 */
	it('runs the detectors once more before dropping a monitor whose source was lost', () => {
		const track = makeTrack('lost');
		const { monitor: trackMonitor, updated, resolveAll } = trackMonitorFor(track);

		pc.addMediaStreamTrack(track);
		pc.mappedOutboundTracks.set(track.id, trackMonitor);
		pc.mappedMediaSourceMonitors.set('src-1', {
			trackIdentifier: track.id,
			get visited() { return false; },
		} as any);

		track.readyState = 'ended';
		track.dispatchEvent(new Event('ended'));

		(pc as any)._checkVisited();

		expect(updated.count).toBe(1);
		expect(pc.mappedOutboundTracks.has(track.id)).toBe(false);
		// The last look happens first, then whatever is still open is closed on the way out.
		expect(resolveAll).toHaveBeenCalledTimes(1);
	});

	/**
	 * ...and only on a lost source. An ordinary teardown has nothing left to find, and
	 * running detectors over a monitor whose stats have already stopped would be judging
	 * stale numbers.
	 */
	it('drops a monitor whose source was not lost without a further pass', () => {
		const track = makeTrack('stopped');
		const { monitor: trackMonitor, updated } = trackMonitorFor(track);

		pc.addMediaStreamTrack(track);
		pc.mappedOutboundTracks.set(track.id, trackMonitor);
		pc.mappedMediaSourceMonitors.set('src-1', {
			trackIdentifier: track.id,
			get visited() { return false; },
		} as any);

		// stop() sets readyState and dispatches nothing.
		track.readyState = 'ended';

		(pc as any)._checkVisited();

		expect(updated.count).toBe(0);
		expect(pc.mappedOutboundTracks.has(track.id)).toBe(false);
	});

	it('still forgets an inbound track and a pending one on the same event', () => {
		const track = makeTrack('inbound');
		const resolveAll = jest.fn();

		pc.addMediaStreamTrack(track);
		pc.mappedInboundTracks.set(track.id, { track, issues: { resolveAll } } as any);

		track.readyState = 'ended';
		track.dispatchEvent(new Event('ended'));

		expect(pc.mappedInboundTracks.has(track.id)).toBe(false);
		// Nothing looks at this track again, so whatever it had open is closed on the way out.
		expect(resolveAll).toHaveBeenCalledTimes(1);
	});
});
