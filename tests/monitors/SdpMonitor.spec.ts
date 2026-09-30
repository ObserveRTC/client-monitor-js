/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { CHROME_OFFER, SFU_ANSWER } from "../helpers/sdpFixtures";

describe('SdpMonitor', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;
	let meta: any[];

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
			bufferingEventsForSamples: true,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pc);
		meta = [];
		monitor.on('meta', (item: any) => meta.push(item));
	});

	afterEach(() => {
		monitor.close();
	});

	it('is a public attribute of the peer connection', () => {
		expect(pc.sdp).toBeDefined();
		expect(pc.sdp.localDescription).toBeUndefined();
	});

	it('adds each description to the sample as metadata, with the ICE password redacted', () => {
		expect(monitor.acceptLocalDescription('pc-1', { type: 'offer', sdp: CHROME_OFFER })).toBe(true);
		expect(monitor.acceptRemoteDescription('pc-1', { type: 'answer', sdp: SFU_ANSWER })).toBe(true);

		expect(meta.map((item) => item.type)).toEqual([ 'LOCAL_SDP', 'REMOTE_SDP' ]);
		expect(meta[0].payload).toMatchObject({ peerConnectionId: 'pc-1', type: 'offer' });
		expect(meta[0].payload.sdp).toContain('a=ice-pwd:<redacted>');
		expect(meta[0].payload.sdp).not.toContain('supersecretpassword1234');

		const sample = monitor.createSample();

		expect(sample?.clientMetaItems?.map((item) => item.type).filter((type) => type.endsWith('_SDP')))
			.toEqual([ 'LOCAL_SDP', 'REMOTE_SDP' ]);
	});

	it('keeps the full SDP on the monitor', () => {
		pc.sdp.acceptLocalDescription({ type: 'offer', sdp: CHROME_OFFER });

		expect(pc.sdp.localDescription?.sdp).toBe(CHROME_OFFER);
		expect(pc.sdp.localDescription?.parsed.mediaSections).toHaveLength(2);
		expect(pc.sdp.localDescriptionsCount).toBe(1);
	});

	it('does not report the same description twice', () => {
		monitor.acceptLocalDescription('pc-1', { type: 'offer', sdp: CHROME_OFFER });

		expect(monitor.acceptLocalDescription('pc-1', { type: 'offer', sdp: CHROME_OFFER })).toBe(false);
		expect(meta).toHaveLength(1);
		expect(pc.sdp.localDescriptionsCount).toBe(1);
	});

	it('ignores rollbacks, empty descriptions and unknown peer connections', () => {
		expect(monitor.acceptLocalDescription('pc-1', { type: 'rollback', sdp: '' })).toBe(false);
		expect(monitor.acceptLocalDescription('pc-1', { type: 'offer' })).toBe(false);
		expect(monitor.acceptLocalDescription('nope', { type: 'offer', sdp: CHROME_OFFER })).toBe(false);
		expect(meta).toHaveLength(0);
	});

	it('publishes one-sided facts before the negotiation completes', () => {
		monitor.acceptRemoteDescription('pc-1', { type: 'offer', sdp: SFU_ANSWER.replace('a=setup:passive', 'a=setup:actpass') });

		expect(pc.remoteIceLite).toBe(true);
		expect(pc.negotiationRole).toBeUndefined();
		expect(pc.negotiatedAudioCodecs).toBeUndefined();
	});

	it('publishes what the completed negotiation settled on the peer connection', () => {
		monitor.acceptLocalDescription('pc-1', { type: 'offer', sdp: CHROME_OFFER });
		monitor.acceptRemoteDescription('pc-1', { type: 'answer', sdp: SFU_ANSWER });

		expect(pc.negotiationRole).toBe('offerer');
		// The answerer is passive, so it is the DTLS server and this endpoint the client.
		expect(pc.dtlsRole).toBe('client');
		expect(pc.remoteIceLite).toBe(true);
		expect(pc.localIceLite).toBe(false);
		expect(pc.bundled).toBe(true);
		expect(pc.negotiatedAudioCodecs).toEqual([ 'audio/opus' ]);
		expect(pc.negotiatedVideoCodecs).toEqual([ 'video/VP8' ]);
		// The far end did not ask for DTX, so this endpoint is not expected to send it; the local
		// offer asked for it, but the answer makes the audio section recvonly on the far end, so
		// nothing is received on it.
		expect(pc.sendingAudioDtx).toBe(false);
		expect(pc.receivingAudioDtx).toBe(false);
		expect(pc.sendingAudioInbandFec).toBe(true);
		expect(pc.audioRedNegotiated).toBe(false);
		expect(pc.sendingSimulcast).toBe(true);

		const [ audio, video ] = pc.sdp.negotiatedMediaSections;

		expect(audio).toMatchObject({ mid: '0', sending: true, receiving: false, transportCc: true, primaryCodec: 'audio/opus' });
		expect(video).toMatchObject({ mid: '1', sending: true, receiving: false, sendSimulcastLayers: 3, codecs: [ 'video/VP8', 'video/rtx' ] });
	});

	it('reads the answerer side: receiving DTX this endpoint asked for', () => {
		// The roles reversed: the SFU offers to send, this endpoint answers asking for DTX.
		const sfuOffer = SFU_ANSWER
			.replace(/a=setup:passive/g, 'a=setup:actpass')
			.replace(/a=recvonly/g, 'a=sendonly');
		const localAnswer = CHROME_OFFER
			.replace(/a=setup:actpass/g, 'a=setup:active')
			.replace(/a=sendrecv|a=sendonly/g, 'a=recvonly');

		monitor.acceptRemoteDescription('pc-1', { type: 'offer', sdp: sfuOffer });
		monitor.acceptLocalDescription('pc-1', { type: 'answer', sdp: localAnswer });

		expect(pc.negotiationRole).toBe('answerer');
		// This endpoint answered `active`, so it is the DTLS client.
		expect(pc.dtlsRole).toBe('client');
		expect(pc.receivingAudioDtx).toBe(true);
		expect(pc.receivingAudioInbandFec).toBe(true);
		expect(pc.sendingAudioDtx).toBe(false);
		expect(pc.sendingSimulcast).toBe(false);
	});

	it('marks a rejected section and leaves it out of the summary', () => {
		monitor.acceptLocalDescription('pc-1', { type: 'offer', sdp: CHROME_OFFER });
		monitor.acceptRemoteDescription('pc-1', { type: 'answer', sdp: SFU_ANSWER.replace('m=video 7', 'm=video 0') });

		expect(pc.sdp.negotiatedMediaSections[1]?.rejected).toBe(true);
		expect(pc.negotiatedVideoCodecs).toEqual([]);
		expect(pc.sendingSimulcast).toBe(false);
	});

	it('accepts nothing once the peer connection is closed', () => {
		pc.close();

		expect(pc.sdp.acceptLocalDescription({ type: 'offer', sdp: CHROME_OFFER })).toBeUndefined();
	});
});
