/* eslint-disable @typescript-eslint/no-explicit-any */
import { FirefoxStatsAdapter } from '../../src/adapters/FirefoxStatsAdapter';
import { RtcStats } from '../../src/schema/W3cStatsIdentifiers';

const adapter = () => new FirefoxStatsAdapter();

describe('FirefoxStatsAdapter', () => {
	it('folds mediaType into kind and discardedPackets into packetsDiscarded', () => {
		const stats: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1,
				mediaType: 'audio', // Firefox emits it alongside kind
				kind: 'audio',
				packetsDiscarded: 3,
				discardedPackets: 3, // non-standard alias, emitted alongside
			} as any,
			{
				id: 'in-2', type: 'inbound-rtp', timestamp: 1, ssrc: 2, kind: 'audio',
				discardedPackets: 7, // alias only
			} as any,
		];

		const [withBoth, aliasOnly] = adapter().adapt(stats) as any[];

		expect(withBoth.kind).toBe('audio');
		expect(withBoth.mediaType).toBeUndefined();
		expect(withBoth.packetsDiscarded).toBe(3);
		expect(withBoth.discardedPackets).toBeUndefined();
		// the value survives under the standard name
		expect(aliasOnly.packetsDiscarded).toBe(7);
		expect(aliasOnly.discardedPackets).toBeUndefined();
	});

	it('preserves brace-wrapped track identifiers — they match Firefox track.id exactly', () => {
		const stats: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				trackIdentifier: '{b7c94165-2d19-4b47-a9c0-61c0df9d0b13}',
			} as any,
		];

		const [inbound] = adapter().adapt(stats) as any[];

		expect(inbound.trackIdentifier).toBe('{b7c94165-2d19-4b47-a9c0-61c0df9d0b13}');
	});

	it('maps candidate-pair cancelled → failed while keeping the non-standard members', () => {
		const stats: RtcStats[] = [
			{
				id: 'CP1', type: 'candidate-pair', timestamp: 1,
				selected: true, writable: true, readable: true, priority: 12345, componentId: 1,
				state: 'succeeded', nominated: true,
			} as any,
			{ id: 'CP2', type: 'candidate-pair', timestamp: 1, state: 'cancelled' } as any,
		];

		const [selectedPair, cancelledPair] = adapter().adapt(stats) as any[];

		expect(cancelledPair.state).toBe('failed');
		// `selected` is the only way to know Firefox's chosen pair before 153
		expect(selectedPair.selected).toBe(true);
		expect(selectedPair.writable).toBe(true);
		expect(selectedPair.readable).toBe(true);
		expect(selectedPair.priority).toBe(12345);
		expect(selectedPair.componentId).toBe(1);
	});

	it('keeps codec.codecType and csrc reports', () => {
		const stats: RtcStats[] = [
			{ id: 'csrc-1', type: 'csrc', timestamp: 1, contributorSsrc: 99 } as any,
			{ id: 'codec-1', type: 'codec', timestamp: 1, mimeType: 'video/VP8', codecType: 'decode' } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const codec = adapted.find((stat) => stat.type === 'codec');

		expect(adapted.some((stat) => stat.type === 'csrc')).toBe(true);
		expect(codec.codecType).toBe('decode');
	});

	it('infers outbound-rtp.mediaSourceId, which Firefox never emits', () => {
		const stats: RtcStats[] = [
			{ id: 'out-audio', type: 'outbound-rtp', timestamp: 1, ssrc: 1, kind: 'audio' } as any,
			// simulcast: three encodings of the same video source
			{ id: 'out-video-lo', type: 'outbound-rtp', timestamp: 1, ssrc: 2, kind: 'video', rid: 'l' } as any,
			{ id: 'out-video-hi', type: 'outbound-rtp', timestamp: 1, ssrc: 3, kind: 'video', rid: 'h' } as any,
			{ id: 'ms-audio', type: 'media-source', timestamp: 1, kind: 'audio', trackIdentifier: '{a}' } as any,
			{ id: 'ms-video', type: 'media-source', timestamp: 1, kind: 'video', trackIdentifier: '{v}' } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const byId = (id: string) => adapted.find((stat) => stat.id === id);

		expect(byId('out-audio').mediaSourceId).toBe('ms-audio');
		expect(byId('out-video-lo').mediaSourceId).toBe('ms-video');
		expect(byId('out-video-hi').mediaSourceId).toBe('ms-video');
	});

	it('leaves mediaSourceId unset when several sources of one kind make it ambiguous', () => {
		// camera + screen share: the report does not determine which one feeds
		// the stream, so the reference stays unresolved rather than guessed
		const stats: RtcStats[] = [
			{ id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
			{ id: 'ms-cam', type: 'media-source', timestamp: 1, kind: 'video', trackIdentifier: '{cam}' } as any,
			{ id: 'ms-screen', type: 'media-source', timestamp: 1, kind: 'video', trackIdentifier: '{screen}' } as any,
		];

		const outbound = (adapter().adapt(stats) as any[]).find((stat) => stat.id === 'out-1');

		expect(outbound.mediaSourceId).toBeUndefined();
	});

	it('infers transportId on RTP, codec and ICE reports (absent before Firefox 153)', () => {
		const stats: RtcStats[] = [
			{ id: 'T1', type: 'transport', timestamp: 1, selectedCandidatePairId: 'CP1' } as any,
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
			{ id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 2, kind: 'video' } as any,
			{ id: 'rin-1', type: 'remote-inbound-rtp', timestamp: 1, ssrc: 2, kind: 'video' } as any,
			{ id: 'codec-1', type: 'codec', timestamp: 1, mimeType: 'video/VP8' } as any,
			{ id: 'IL1', type: 'local-candidate', timestamp: 1, candidateType: 'host' } as any,
		];

		const adapted = adapter().adapt(stats) as any[];

		for (const id of ['in-1', 'out-1', 'rin-1', 'codec-1', 'IL1']) {
			expect(adapted.find((stat) => stat.id === id).transportId).toBe('T1');
		}
	});

	it('leaves transportId unset when the report has no single transport', () => {
		const noTransport: RtcStats[] = [
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
		];
		const twoTransports: RtcStats[] = [
			{ id: 'T1', type: 'transport', timestamp: 1 } as any,
			{ id: 'T2', type: 'transport', timestamp: 1 } as any,
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
		];

		expect((adapter().adapt(noTransport) as any[])[0].transportId).toBeUndefined();
		expect((adapter().adapt(twoTransports) as any[])[2].transportId).toBeUndefined();
	});

	it('does not overwrite a reference the browser already reported', () => {
		const stats: RtcStats[] = [
			{ id: 'T1', type: 'transport', timestamp: 1 } as any,
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video', transportId: 'T-native' } as any,
		];

		expect((adapter().adapt(stats) as any[])[1].transportId).toBe('T-native');
	});

	it('infers the remoteId/localId cross-references by SSRC', () => {
		const stats: RtcStats[] = [
			{ id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 42, kind: 'video' } as any,
			{ id: 'rin-1', type: 'remote-inbound-rtp', timestamp: 1, ssrc: 42, kind: 'video' } as any,
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 7, kind: 'audio' } as any,
			{ id: 'rout-1', type: 'remote-outbound-rtp', timestamp: 1, ssrc: 7, kind: 'audio' } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const byId = (id: string) => adapted.find((stat) => stat.id === id);

		expect(byId('out-1').remoteId).toBe('rin-1');
		expect(byId('rin-1').localId).toBe('out-1');
		expect(byId('in-1').remoteId).toBe('rout-1');
		expect(byId('rout-1').localId).toBe('in-1');
	});

	it('infers codecId, respecting the direction Firefox tags on codec entries', () => {
		const stats: RtcStats[] = [
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
			{ id: 'out-1', type: 'outbound-rtp', timestamp: 1, ssrc: 2, kind: 'video' } as any,
			{ id: 'out-audio', type: 'outbound-rtp', timestamp: 1, ssrc: 3, kind: 'audio' } as any,
			{ id: 'codec-dec', type: 'codec', timestamp: 1, mimeType: 'video/VP8', codecType: 'decode' } as any,
			{ id: 'codec-enc', type: 'codec', timestamp: 1, mimeType: 'video/VP8', codecType: 'encode' } as any,
			{ id: 'codec-opus', type: 'codec', timestamp: 1, mimeType: 'audio/opus' } as any,
		];

		const adapted = adapter().adapt(stats) as any[];
		const byId = (id: string) => adapted.find((stat) => stat.id === id);

		expect(byId('in-1').codecId).toBe('codec-dec');
		expect(byId('out-1').codecId).toBe('codec-enc');
		expect(byId('out-audio').codecId).toBe('codec-opus');
	});

	it('leaves codecId unset when several codecs of one kind are in play', () => {
		const stats: RtcStats[] = [
			{ id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video' } as any,
			{ id: 'codec-vp8', type: 'codec', timestamp: 1, mimeType: 'video/VP8' } as any,
			{ id: 'codec-h264', type: 'codec', timestamp: 1, mimeType: 'video/H264' } as any,
		];

		expect((adapter().adapt(stats) as any[])[0].codecId).toBeUndefined();
	});

	it('does not approximate values the browser never measured', () => {
		const stats: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				framesDecoded: 300, framesDropped: 4,
			} as any,
		];

		const inbound = (adapter().adapt(stats) as any[])[0];

		expect(inbound.framesRendered).toBeUndefined();
	});

	describe('reconstructed transport report (Firefox < 153)', () => {
		const pair = (timestamp: number, counters: Record<string, unknown>, id = 'CP1'): RtcStats =>
			({
				id, type: 'candidate-pair', timestamp, transportId: 'T1',
				selected: true, state: 'succeeded', ...counters,
			} as any);

		it('builds a transport from the selected pair and resolves transportId against it', () => {
			const stats: RtcStats[] = [
				pair(1000, { packetsSent: 10, packetsReceived: 20, bytesSent: 1000, bytesReceived: 2000 }),
				{ id: 'in-1', type: 'inbound-rtp', timestamp: 1000, ssrc: 1, kind: 'video' } as any,
			];

			const adapted = adapter().adapt(stats) as any[];
			const transport = adapted.find((stat) => stat.type === 'transport');
			const inbound = adapted.find((stat) => stat.type === 'inbound-rtp');

			expect(transport).toBeDefined();
			expect(transport.id).toBe('T1');
			expect(transport.selectedCandidatePairId).toBe('CP1');
			expect(transport.selectedCandidatePairChanges).toBe(0);
			expect(inbound.transportId).toBe(transport.id);
		});

		it('accumulates the pair deltas across ticks, and carries totals across a pair change', () => {
			const firefox = adapter();

			firefox.adapt([pair(1000, { packetsSent: 10, packetsReceived: 20, bytesSent: 1000, bytesReceived: 2000 })]);
			firefox.adapt([pair(3000, { packetsSent: 30, packetsReceived: 50, bytesSent: 3000, bytesReceived: 6000 })]);

			// the path switches: the new pair's counters start from its own zero,
			// the transport totals must not jump backwards
			const afterSwitch = firefox.adapt([
				pair(5000, { packetsSent: 5, packetsReceived: 7, bytesSent: 500, bytesReceived: 700 }, 'CP2'),
			]) as any[];
			const transport = afterSwitch.find((stat) => stat.type === 'transport');

			expect(transport.bytesSent).toBe(2000); // 3000 - 1000 accumulated
			expect(transport.bytesReceived).toBe(4000);
			expect(transport.packetsSent).toBe(20);
			expect(transport.selectedCandidatePairId).toBe('CP2');
			expect(transport.selectedCandidatePairChanges).toBe(1);
		});

		it('stays a no-op when a native transport report is present, wherever it appears', () => {
			// Firefox 153+: the report order is not guaranteed, so a native
			// transport listed AFTER the selected pair must still be honoured
			const stats: RtcStats[] = [
				pair(1000, { packetsSent: 10, bytesSent: 1000 }),
				{ id: 'T-native', type: 'transport', timestamp: 1000, dtlsState: 'connected' } as any,
			];

			const transports = (adapter().adapt(stats) as any[]).filter((stat) => stat.type === 'transport');

			expect(transports).toHaveLength(1);
			expect(transports[0].id).toBe('T-native');
		});

		it('does not double-count when the same tick is adapted twice', () => {
			const firefox = adapter();
			const tick = () => [pair(3000, { packetsSent: 30, bytesSent: 3000 })];

			firefox.adapt([pair(1000, { packetsSent: 10, bytesSent: 1000 })]);
			firefox.adapt(tick());
			const repeated = firefox.adapt(tick()) as any[];
			const transport = repeated.find((stat) => stat.type === 'transport');

			expect(transport.bytesSent).toBe(2000);
			expect(transport.packetsSent).toBe(20);
		});

		it('does nothing when no pair is selected', () => {
			const stats: RtcStats[] = [
				{ id: 'CP1', type: 'candidate-pair', timestamp: 1000, state: 'in-progress' } as any,
			];

			expect((adapter().adapt(stats) as any[]).some((stat) => stat.type === 'transport')).toBe(false);
		});
	});

	it('leaves an already-conformant report untouched', () => {
		const conformant: RtcStats[] = [
			{
				id: 'in-1', type: 'inbound-rtp', timestamp: 1, ssrc: 1, kind: 'video',
				trackIdentifier: '{t}', transportId: 'T1', framesDecoded: 10,
			} as any,
			{ id: 'T1', type: 'transport', timestamp: 1, selectedCandidatePairId: 'CP1' } as any,
		];
		const before = JSON.parse(JSON.stringify(conformant));

		expect(adapter().adapt(conformant)).toEqual(before);
	});
});
