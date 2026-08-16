/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../src/ClientMonitor";
import { StatsReplayer, ReplayEntry } from "./helpers/StatsReplayer";

const silentLogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function createReplayMonitor() {
	return new ClientMonitor({
		logger: silentLogger,
		collectingPeriodInMs: 0, // no live collection timer; the replayer drives ticks
		bufferingEventsForSamples: true,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
	});
}

/** One recorded tick of a single-PC session with one inbound video track. */
function entry(timestamp: number, rtp: Record<string, unknown>): ReplayEntry {
	return {
		timestamp,
		peerConnections: [[
			'pc-1',
			[{
				type: 'inbound-rtp',
				id: 'in-1',
				timestamp,
				ssrc: 42,
				kind: 'video',
				trackIdentifier: 'track-1',
				...rtp,
			} as any],
		]],
		tracks: [{ peerConnectionId: 'pc-1', id: 'track-1', kind: 'video', readyState: 'live' }],
	};
}

describe('StatsReplayer', () => {
	it('rebuilds monitors and derived fields from recorded JSONL lines', async () => {
		const monitor = createReplayMonitor();
		const replayer = new StatsReplayer(monitor);

		const lines = [
			entry(0, { bytesReceived: 0, framesDecoded: 0, framesReceived: 0, packetsReceived: 0 }),
			entry(2000, { bytesReceived: 250000, framesDecoded: 60, framesReceived: 60, packetsReceived: 200 }),
		].map((e) => JSON.stringify(e));

		await replayer.replay(lines);

		const pc = monitor.getPeerConnectionMonitor('pc-1');
		const inboundRtp = pc?.mappedInboundRtpMonitors.get(42);

		expect(pc).toBeDefined();
		// 250kB over 2s = 1 Mbps — the same derivation a live run produces
		expect(inboundRtp?.bitrate).toBeCloseTo(1_000_000);
		expect(inboundRtp?.deltaFramesDecoded).toBe(60);
		// the recorded track became a real InboundTrackMonitor
		expect(pc?.mappedInboundTracks.has('track-1')).toBe(true);

		monitor.close();
	});

	it('fires detectors on the recorded fingerprint, stamped with recorded time', async () => {
		const monitor = createReplayMonitor();
		const replayer = new StatsReplayer(monitor);
		const raised: { type: string, at: number }[] = [];

		monitor.on('issue', (issue) => raised.push({ type: issue.type, at: (issue as any).raisedAt ?? issue.timestamp }));

		// stuck-decoder fingerprint: bytes keep flowing, nothing decodes, PLIs fire
		const entries = [
			entry(0,    { bytesReceived: 0,       framesDecoded: 100, framesReceived: 100, pliCount: 0 }),
			entry(2000, { bytesReceived: 500000,  framesDecoded: 100, framesReceived: 100, pliCount: 3 }),
			entry(4000, { bytesReceived: 1000000, framesDecoded: 100, framesReceived: 100, pliCount: 6 }),
			entry(6000, { bytesReceived: 1500000, framesDecoded: 100, framesReceived: 100, pliCount: 9 }),
		];

		await replayer.replay(entries);

		const stuck = raised.find((issue) => issue.type === 'stuck-decoder');

		expect(stuck).toBeDefined();
		// virtual time: the verdict is stamped with the RECORDED clock, even
		// though the replay itself took milliseconds
		expect(stuck?.at).toBe(6000);

		monitor.close();
	});

	it('restores the real clock after replay', async () => {
		const monitor = createReplayMonitor();
		const replayer = new StatsReplayer(monitor);
		const realNow = Date.now;

		await replayer.replay([entry(0, { bytesReceived: 0 })]);

		expect(Date.now).toBe(realNow);
		expect(Date.now()).toBeGreaterThan(1_000_000_000_000);

		monitor.close();
	});

	it('skips entries for a peer connection missing from a tick without corrupting deltas', async () => {
		const monitor = createReplayMonitor();
		const replayer = new StatsReplayer(monitor);

		await replayer.replayEntry(entry(0, { bytesReceived: 0 }));
		// tick with no data for pc-1: stale stats are re-served and ignored
		await replayer.replayEntry({ timestamp: 2000, peerConnections: [] });
		await replayer.replayEntry(entry(4000, { bytesReceived: 400000 }));
		replayer.finish();

		const inboundRtp = monitor.getPeerConnectionMonitor('pc-1')?.mappedInboundRtpMonitors.get(42);

		// 400kB over the full 4s span = 800 kbps
		expect(inboundRtp?.bitrate).toBeCloseTo(800_000);

		monitor.close();
	});
});
