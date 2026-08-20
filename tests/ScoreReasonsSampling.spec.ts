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
	it('ships the encoded score reasons by default', () => {
		const monitor = createMonitor();

		addPcWithReasons(monitor);

		const sample = monitor.createSample();
		const pcSample = sample?.peerConnections?.[0];

		// the sample carries the reason keys; magnitudes stay local
		expect(pcSample?.scoreReasons).toEqual([ 'high-rtt' ]);

		monitor.close();
	});

	it('ships the client-level reason keys on the client sample', () => {
		const monitor = createMonitor();

		monitor.scoreReasons = { 'high-rtt': 1.0, 'frozen-video': 2.0 };

		const sample = monitor.createSample();

		expect(sample?.scoreReasons).toEqual([ 'high-rtt', 'frozen-video' ]);

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

		// the track's reason keys ship on the track's own sample...
		expect(trackSample?.scoreReasons).toEqual([ 'frozen-video' ]);
		// ...and the peer connection sample carries only its own (rtt/jitter/loss) reasons
		expect(pcSample?.scoreReasons).toEqual([ 'high-rtt' ]);

		monitor.close();
	});
});
