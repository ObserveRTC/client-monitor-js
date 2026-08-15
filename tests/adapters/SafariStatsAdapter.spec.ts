/* eslint-disable @typescript-eslint/no-explicit-any */
import { SafariStatsAdapter } from '../../src/adapters/SafariStatsAdapter';
import { RtcStats } from '../../src/schema/W3cStatsIdentifiers';

const adapter = () => new SafariStatsAdapter();

describe('SafariStatsAdapter', () => {
	it('recovers trackIdentifier from the deprecated track report (Safari < 16.4)', () => {
		// pre-16.4 Safari: inbound-rtp has NO trackIdentifier, only the legacy
		// trackId reference — without folding, the monitor drops the report
		const stats: RtcStats[] = [
			{
				id: 'RTCInboundRTPVideoStream_1', type: 'inbound-rtp', timestamp: 1, ssrc: 1,
				mediaType: 'video', kind: 'video',
				trackId: 'RTCMediaStreamTrack_1',
			} as any,
			{
				id: 'RTCMediaStreamTrack_1', type: 'track', timestamp: 1,
				trackIdentifier: 'safari-track-1', remoteSource: true,
				frameWidth: 640, frameHeight: 480, framesReceived: 120, framesDropped: 3,
				pauseCount: 1, totalPausesDuration: 0.4,
			} as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const inbound = adapted.find((stat) => stat.type === 'inbound-rtp');

		expect(adapted.some((stat) => stat.type === 'track')).toBe(false);
		expect(inbound.trackIdentifier).toBe('safari-track-1');
		expect(inbound.trackId).toBeUndefined();
		expect(inbound.mediaType).toBeUndefined();
		expect(inbound.kind).toBe('video');
		expect(inbound.frameWidth).toBe(640);
		expect(inbound.pauseCount).toBe(1);
	});

	it('folds datachannelid into dataChannelIdentifier (Safari ≤ 17.6)', () => {
		const stats: RtcStats[] = [
			{
				id: 'DC1', type: 'data-channel', timestamp: 1,
				label: 'chat', state: 'open', datachannelid: 1,
			} as any,
		];

		const [dataChannel] = adapter().adapt(stats) as any[];

		expect(dataChannel.dataChannelIdentifier).toBe(1);
		expect(dataChannel.datachannelid).toBeUndefined();
	});

	it('maps legacy candidate-pair state spellings to the spec enum, keeping the other members', () => {
		const stats: RtcStats[] = [
			{ id: 'CP1', type: 'candidate-pair', timestamp: 1, state: 'inprogress' } as any,
			{ id: 'CP2', type: 'candidate-pair', timestamp: 1, state: 'cancelled' } as any,
			{
				id: 'CP3', type: 'candidate-pair', timestamp: 1, state: 'succeeded',
				priority: 123, writable: true, readable: true,
			} as any,
		];

		const [inProgress, cancelled, succeeded] = adapter().adapt(stats) as any[];

		expect(inProgress.state).toBe('in-progress');
		expect(cancelled.state).toBe('failed');
		expect(succeeded.state).toBe('succeeded');
		// spec-removed but measured — kept
		expect(succeeded.priority).toBe(123);
		expect(succeeded.writable).toBe(true);
		expect(succeeded.readable).toBe(true);
	});

	it('keeps spec-removed members WebKit still fills', () => {
		const stats: RtcStats[] = [
			{ id: 'IL1', type: 'local-candidate', timestamp: 1, candidateType: 'relay', deleted: false } as any,
			{ id: 'T1', type: 'transport', timestamp: 1, rtcpTransportStatsId: 'T2' } as any,
			{ id: 'codec-1', type: 'codec', timestamp: 1, mimeType: 'audio/opus', codecType: 'encode' } as any,
			{
				id: 'rin-1', type: 'remote-inbound-rtp', timestamp: 1, ssrc: 7, kind: 'audio',
				reportsReceived: 4,
			} as any,
		];

		const [candidate, transport, codec, remoteInbound] = adapter().adapt(stats) as any[];

		expect(candidate.deleted).toBe(false);
		expect(transport.rtcpTransportStatsId).toBe('T2');
		expect(codec.codecType).toBe('encode');
		expect(remoteInbound.reportsReceived).toBe(4);
	});

	it('infers codec.transportId, spec-required but unfilled through Safari 17.3', () => {
		const stats: RtcStats[] = [
			{ id: 'T1', type: 'transport', timestamp: 1, dtlsState: 'connected' } as any,
			{ id: 'codec-1', type: 'codec', timestamp: 1, mimeType: 'audio/opus', payloadType: 111 } as any,
		];

		const codec = (adapter().adapt(stats) as any[]).find((stat) => stat.type === 'codec');

		expect(codec.transportId).toBe('T1');
	});

	it('infers inbound-rtp.remoteId, which WebKit dropped in Safari 16.4–16.6', () => {
		const stats: RtcStats[] = [
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 42, kind: 'audio' } as any,
			{
				id: 'rout-1', type: 'remote-outbound-rtp', timestamp: 1, ssrc: 42, kind: 'audio',
				remoteTimestamp: 12345,
			} as any,
		];

		const adapted = adapter().adapt(stats) as any[];

		expect(adapted.find((stat) => stat.id === 'in-1').remoteId).toBe('rout-1');
		expect(adapted.find((stat) => stat.id === 'rout-1').localId).toBe('in-1');
	});

	it('leaves fields WebKit never fills absent', () => {
		const stats: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				trackIdentifier: 't-1', framesDecoded: 600, framesDropped: 12,
			} as any,
			{ id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 7, kind: 'audio', packetsSent: 900 } as any,
			{ id: 'rin-1', type: 'remote-inbound-rtp', timestamp: 1, ssrc: 7, kind: 'audio', packetsLost: 10 } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const inbound = adapted.find((stat) => stat.type === 'inbound-rtp');
		const remoteInbound = adapted.find((stat) => stat.type === 'remote-inbound-rtp');

		// an approximation would be indistinguishable from a measurement downstream
		expect(inbound.framesRendered).toBeUndefined();
		expect(remoteInbound.packetsReceived).toBeUndefined();
	});

	it('leaves a modern (17.4+) conformant report untouched', () => {
		const conformant: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'audio',
				trackIdentifier: 't-1', transportId: 'T1', packetsReceived: 100, concealedSamples: 40,
			} as any,
			{
				id: 'T1', type: 'transport', timestamp: 1,
				dtlsState: 'connected', selectedCandidatePairId: 'CP1', iceRole: 'controlling',
			} as any,
		];
		const before = JSON.parse(JSON.stringify(conformant));

		expect(adapter().adapt(conformant)).toEqual(before);
	});
});
