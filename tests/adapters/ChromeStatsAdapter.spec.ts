/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChromeStatsAdapter } from '../../src/adapters/ChromeStatsAdapter';
import { RtcStats } from '../../src/schema/W3cStatsIdentifiers';

const adapter = () => new ChromeStatsAdapter();

describe('ChromeStatsAdapter', () => {
	it('folds mediaType into kind', () => {
		const stats: RtcStats[] = [
			{
				id: 'IT01V1', type: 'inbound-rtp', timestamp: 1, ssrc: 1,
				mediaType: 'video', // legacy alias, emitted alongside kind
				kind: 'video',
				framesDecoded: 100, framesDropped: 5,
			} as any,
			{
				id: 'OT01A1', type: 'outbound-rtp', timestamp: 1, ssrc: 2,
				mediaType: 'audio', // some versions emit it without kind
			} as any,
		];

		const [inbound, outbound] = adapter().adapt(stats) as any[];

		expect(inbound.kind).toBe('video');
		expect(inbound.mediaType).toBeUndefined();
		expect(outbound.kind).toBe('audio');
		expect(outbound.mediaType).toBeUndefined();
	});

	it('keeps non-standard members the browser measured', () => {
		const stats: RtcStats[] = [
			{
				id: 'IT01V1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				contentType: 'screenshare',
				googTimingFrameInfo: '123,456',
			} as any,
			{
				id: 'CP1', type: 'candidate-pair', timestamp: 1,
				writable: true, priority: 9114756843469684000, state: 'succeeded',
			} as any,
			{
				id: 'IL1', type: 'local-candidate', timestamp: 1,
				address: '192.168.1.10', networkType: 'wifi', isRemote: false, candidateType: 'host',
			} as any,
			{ id: 'T1', type: 'transport', timestamp: 1, rtcpTransportStatsId: 'T2' } as any,
		];

		const [inbound, pair, candidate, transport] = adapter().adapt(stats) as any[];

		// removed from the spec, but the browser reported them and the monitors
		// carry through whatever they receive
		expect(inbound.contentType).toBe('screenshare');
		expect(inbound.googTimingFrameInfo).toBe('123,456');
		expect(pair.writable).toBe(true);
		expect(pair.priority).toBe(9114756843469684000);
		expect(candidate.networkType).toBe('wifi');
		expect(candidate.isRemote).toBe(false);
		expect(transport.rtcpTransportStatsId).toBe('T2');
	});

	it('folds deprecated track reports into inbound-rtp and drops them (Chrome ≤ M111)', () => {
		const stats: RtcStats[] = [
			{
				id: 'RTCInboundRTPVideoStream_1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				trackId: 'RTCMediaStreamTrack_receiver_1', // legacy reference
			} as any,
			{
				id: 'RTCMediaStreamTrack_receiver_1', type: 'track', timestamp: 1,
				trackIdentifier: 'track-uuid-1',
				remoteSource: true,
				framesReceived: 300, framesDropped: 10, frameWidth: 1280, frameHeight: 720,
				freezeCount: 2, totalFreezesDuration: 1.5,
			} as any,
			{ id: 'RTCMediaStream_abc', type: 'stream', timestamp: 1 } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const inbound = adapted.find((stat) => stat.type === 'inbound-rtp');

		// legacy reports are gone, their payload lives on in the standard shape
		expect(adapted.some((stat) => stat.type === 'track' || stat.type === 'stream')).toBe(false);
		expect(inbound.trackId).toBeUndefined();
		expect(inbound.trackIdentifier).toBe('track-uuid-1');
		expect(inbound.framesReceived).toBe(300);
		expect(inbound.frameWidth).toBe(1280);
		expect(inbound.freezeCount).toBe(2);
	});

	it('does not overwrite RTP-level values with stale track-level ones', () => {
		const stats: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				trackId: 'track-ref-1',
				framesReceived: 500, // fresher than the track report's
			} as any,
			{
				id: 'track-ref-1', type: 'track', timestamp: 1,
				trackIdentifier: 'track-uuid-1', framesReceived: 490,
			} as any,
		];

		const inbound = (adapter().adapt(stats) as any[]).find((stat) => stat.type === 'inbound-rtp');

		expect(inbound.framesReceived).toBe(500);
		expect(inbound.trackIdentifier).toBe('track-uuid-1');
	});

	it('folds the legacy ip spelling into address on ICE candidate reports', () => {
		const stats: RtcStats[] = [
			{
				id: 'IL1', type: 'local-candidate', timestamp: 1,
				ip: '192.168.1.10', // legacy, emitted alongside address
				address: '192.168.1.10',
				candidateType: 'host', protocol: 'udp', port: 50000,
			} as any,
			{
				id: 'IR1', type: 'remote-candidate', timestamp: 1,
				ip: '10.0.0.1', // some versions: only the legacy spelling
				candidateType: 'srflx', protocol: 'udp', port: 3478,
			} as any,
		];

		const [local, remote] = adapter().adapt(stats) as any[];

		expect(local.address).toBe('192.168.1.10');
		expect(local.ip).toBeUndefined();
		expect(remote.address).toBe('10.0.0.1');
		expect(remote.ip).toBeUndefined();
	});

	it('fills in a dropped reference without touching one the browser reported', () => {
		const stats: RtcStats[] = [
			{ id: 'T1', type: 'transport', timestamp: 1, dtlsState: 'connected' } as any,
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
			{ id: 'in-2', type: 'inbound-rtp', timestamp: 1, ssrc: 2, kind: 'audio', transportId: 'T-native' } as any,
			{ id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 3, kind: 'audio' } as any,
			{ id: 'ms-1', type: 'media-source', timestamp: 1, kind: 'audio', trackIdentifier: 'mic' } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const byId = (id: string) => adapted.find((stat) => stat.id === id);

		expect(byId('in-1').transportId).toBe('T1');
		expect(byId('in-2').transportId).toBe('T-native');
		expect(byId('out-1').mediaSourceId).toBe('ms-1');
	});

	it('leaves fields the browser never reports absent instead of approximating them', () => {
		const stats: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				framesDecoded: 1000, framesDropped: 20,
			} as any,
			{
				id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 42, kind: 'video',
				packetsSent: 5000,
			} as any,
			{
				id: 'rin-1', type: 'remote-inbound-rtp', timestamp: 1, ssrc: 42, kind: 'video',
				packetsLost: 50,
			} as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const inbound = adapted.find((stat) => stat.type === 'inbound-rtp');
		const remoteInbound = adapted.find((stat) => stat.type === 'remote-inbound-rtp');

		// framesDecoded - framesDropped would be plausible, and wrong to report
		// as if the browser measured it
		expect(inbound.framesRendered).toBeUndefined();
		expect(remoteInbound.packetsReceived).toBeUndefined();
	});

	it('leaves an already-conformant report untouched', () => {
		const conformant: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'audio',
				trackIdentifier: 'track-1', packetsReceived: 100, jitter: 0.005,
			} as any,
		];
		const before = JSON.parse(JSON.stringify(conformant));

		const adapted = adapter().adapt(conformant);

		expect(adapted).toEqual(before);
	});
});
