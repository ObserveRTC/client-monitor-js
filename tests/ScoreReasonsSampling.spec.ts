import { ClientMonitor } from "../src/ClientMonitor";
import { PeerConnectionMonitor } from "../src/monitors/PeerConnectionMonitor";
import { InboundRtpMonitor } from "../src/monitors/InboundRtpMonitor";
import { InboundTrackMonitor } from "../src/monitors/InboundTrackMonitor";

const silentLogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function createMonitor(config: Record<string, unknown> = {}) {
	return new ClientMonitor({
		logger: silentLogger,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
		...config,
	});
}

function addPcWithReasons(monitor: ClientMonitor) {
	const pcMonitor = new PeerConnectionMonitor(
		'pc-1',
		{ getStats: async () => [] },
		monitor,
		monitor.logger,
	);

	pcMonitor.calculatedStabilityScore.value = 4.0;
	pcMonitor.calculatedStabilityScore.reasons = { 'high-rtt': 1.0 };
	monitor.addPeerConnectionMonitor(pcMonitor);

	return pcMonitor;
}

describe('sendScoreReasonsToServer', () => {
	it('ships the score reasons with their magnitudes by default', () => {
		const monitor = createMonitor();

		const pcMonitor = addPcWithReasons(monitor);

		const sample = monitor.createSample();
		const pcSample = sample?.peerConnections?.[0];

		// the sample carries the reasons with the points each subtracted
		expect(pcSample?.scoreReasons).toEqual({ 'high-rtt': 1.0 });
		// ...as a copy, never aliasing the live reasons object
		expect(pcSample?.scoreReasons).not.toBe(pcMonitor.calculatedStabilityScore.reasons);

		monitor.close();
	});

	it('emits the aggregate but keeps the client\'s own reasons separate', () => {
		const monitor = createMonitor();
		const emitted: Record<string, number>[] = [];

		monitor.on('score', ({ currentReasons }) => emitted.push(currentReasons));

		// the calculator's two views: nothing of the client's own, and the sum of
		// every component's reasons
		monitor.setScore(4.5, undefined, { 'high-rtt': 1.0, 'frozen-video': 2.0 });

		// the event carries the aggregate, so applications react to the whole picture
		expect(emitted).toEqual([{ 'high-rtt': 1.0, 'frozen-video': 2.0 }]);
		// ...but the monitor's own reasons stay empty, like any other component
		expect(monitor.scoreReasons).toBeUndefined();
		// ...and nothing lands on the wire, since each reason ships on its component
		expect(monitor.createSample()?.scoreReasons).toBeUndefined();

		monitor.close();
	});

	it('ships client-level reasons when the client itself has any', () => {
		const monitor = createMonitor();

		monitor.setScore(4.5, { 'high-packetloss': 0.5 }, { 'high-packetloss': 0.5, 'frozen-video': 2.0 });

		expect(monitor.scoreReasons).toEqual({ 'high-packetloss': 0.5 });
		expect(monitor.createSample()?.scoreReasons).toEqual({ 'high-packetloss': 0.5 });

		monitor.close();
	});

	it('does not duplicate a component reason at the client level', () => {
		// The regression: a track pixelating used to surface `pixelated-video`
		// on the client sample too, so one event was counted twice on the wire
		// and the client looked like the thing that was pixelating.
		const monitor = createMonitor();
		const pcMonitor = addPcWithReasons(monitor);

		const track = {
			id: 'inbound-video-1',
			kind: 'video',
			enabled: true,
			muted: false,
			readyState: 'live',
		} as unknown as MediaStreamTrack;
		const inboundRtp = new InboundRtpMonitor(pcMonitor, {
			id: 'rtp-1',
			timestamp: Date.now(),
			ssrc: 1111,
			kind: 'video',
			trackIdentifier: track.id,
		});
		const trackMonitor = new InboundTrackMonitor(track, inboundRtp);

		pcMonitor.mappedInboundTracks.set(track.id, trackMonitor);
		trackMonitor.calculatedScore.value = 4.9;
		trackMonitor.calculatedScore.reasons = { 'pixelated-video': 0.27 };

		// the calculator's aggregate reaches the event, not the monitor field
		monitor.setScore(4.975, undefined, { 'high-rtt': 1.0, 'pixelated-video': 0.27 });

		const sample = monitor.createSample();

		expect(sample?.scoreReasons).toBeUndefined();
		expect(sample?.peerConnections?.[0]?.scoreReasons).toEqual({ 'high-rtt': 1.0 });
		expect(sample?.peerConnections?.[0]?.inboundTracks?.[0]?.scoreReasons)
			.toEqual({ 'pixelated-video': 0.27 });

		monitor.close();
	});

	it('drops the score reasons from the sample when explicitly false', () => {
		const monitor = createMonitor({ sendScoreReasonsToServer: false });

		addPcWithReasons(monitor);

		const sample = monitor.createSample();
		const pcSample = sample?.peerConnections?.[0];

		// the score itself is still shipped — only the reasons are dropped
		expect(pcSample?.score).toBe(4.0);
		expect(pcSample?.scoreReasons).toBeUndefined();

		monitor.close();
	});

	it('attributes track-caused reasons to the track sample, not to the peer connection', () => {
		const monitor = createMonitor();
		const pcMonitor = addPcWithReasons(monitor);

		const track = {
			id: 'inbound-video-1',
			kind: 'video',
			enabled: true,
			muted: false,
			readyState: 'live',
		} as unknown as MediaStreamTrack;
		const inboundRtp = new InboundRtpMonitor(pcMonitor, {
			id: 'rtp-1',
			timestamp: Date.now(),
			ssrc: 1111,
			kind: 'video',
			trackIdentifier: track.id,
		});
		const trackMonitor = new InboundTrackMonitor(track, inboundRtp);

		pcMonitor.mappedInboundTracks.set(track.id, trackMonitor);

		// something happened on the TRACK: it froze
		trackMonitor.calculatedScore.value = 3.0;
		trackMonitor.calculatedScore.reasons = { 'frozen-video': 2.0 };

		const sample = monitor.createSample();
		const pcSample = sample?.peerConnections?.[0];
		const trackSample = pcSample?.inboundTracks?.[0];

		// the track's reasons ship on the track's own sample...
		expect(trackSample?.scoreReasons).toEqual({ 'frozen-video': 2.0 });
		// ...and the peer connection sample carries only its own (rtt/jitter/loss) reasons
		expect(pcSample?.scoreReasons).toEqual({ 'high-rtt': 1.0 });

		monitor.close();
	});
});
