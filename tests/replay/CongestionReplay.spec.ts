/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Replays a captured session and records, tick by tick, what the two new
 * capacity detectors say, what the detector they replace would have said, and
 * the raw signals a human would use to decide who was right.
 *
 * Not a test — a measurement. Point `REPLAY_FILE` at a JSONL of ClientSamples
 * and read the CSV it writes.
 */
import * as fs from 'fs';
import * as readline from 'readline';
import { ClientMonitor } from '../../src/ClientMonitor';
import { StatsReplayer } from '../helpers/StatsReplayer';
import { clientSampleToReplayEntry } from '../helpers/clientSampleToReplay';

const REPLAY_FILE = process.env.REPLAY_FILE;
const OUT_FILE = process.env.OUT_FILE ?? '/tmp/replay.csv';

/**
 * The detector being replaced, as a pure function of the same per-tick facts.
 * Transcribed from `CongestionDetector.update()` at 4.9.0 — it cannot be
 * instantiated any more because its config block is gone, and reproducing the
 * rule is what the comparison needs anyway.
 *
 * `high`   : the browser's verdict alone.
 * `medium` : the verdict, plus the current mean RTT diverging from its EWMA by
 *            more than a third of that EWMA, clamped to 50-150ms.
 * `low`    : the verdict, plus outbound loss above 5%.
 */
function oldCongestionRule(pc: any) {
	const bwLimited = pc.qualityLimitationReason === 'bandwidth';
	const avgRtt = pc.avgRttInSec;
	const ewmaRtt = pc.ewmaRttInSec;
	const rttDiff = avgRtt !== undefined && ewmaRtt !== undefined ? Math.abs(avgRtt - ewmaRtt) : 0;

	const high = bwLimited;
	const medium = !ewmaRtt ? false : bwLimited && rttDiff > Math.min(0.15, Math.max(0.05, ewmaRtt * 0.33));
	const low = pc.outboundFractionLost === undefined ? false : bwLimited && pc.outboundFractionLost > 0.05;

	return { high, medium, low };
}

jest.setTimeout(20 * 60 * 1000);

// A measurement, not an assertion: it runs only when pointed at a capture.
const maybe = REPLAY_FILE ? it : it.skip;

maybe('replays the session', async () => {
	const monitor = new ClientMonitor({
		collectingPeriodInMs: 0,
		samplingPeriodInMs: 0,
		integration: 'Unknown',
	} as any);

	// Edge-triggered records of what each detector said, so a raise that stays
	// open for twenty collections is one episode rather than twenty.
	const episodes: { type: string, at: number, tick: number, payload: any }[] = [];
	const resolutions: { type: string, at: number, tick: number, comment?: string }[] = [];

	let tick = 0;

	monitor.on('issue', (issue: any) => {
		episodes.push({ type: issue.type, at: issue.raisedAt, tick, payload: issue.payload });
	});
	(monitor as any).on('issue-resolved', (issue: any) => {
		resolutions.push({ type: issue.type, at: issue.resolvedAt, tick, comment: issue.comment });
	});

	const replayer = new StatsReplayer(monitor);
	const rows: string[] = [];

	rows.push([
		'tick', 'ts', 'pc', 'dir',
		'qualityLimitationReason',
		'availOutBps', 'sendingBps', 'headroomBps', 'ewmaHeadroomBps',
		'pktSendDelayMs', 'ewmaPktSendDelayMs',
		'recvBps', 'jbDelayMs', 'ewmaJbDelayMs',
		'outFractionLost', 'inFractionLost', 'rttMs',
		'uplinkRaised', 'downlinkRaised',
		'oldHigh', 'oldMedium', 'oldLow',
		'hasInboundVideo', 'statsClockMs',
	].join(','));

	const stream = readline.createInterface({
		input: fs.createReadStream(REPLAY_FILE as string),
		crlfDelay: Infinity,
	});

	for await (const line of stream) {
		if (!line.trim()) continue;

		await replayer.replayEntry(clientSampleToReplayEntry(JSON.parse(line)));
		++tick;

		for (const pc of (monitor as any).peerConnections as any[]) {
			const old = oldCongestionRule(pc);
			const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : '');

			rows.push([
				tick,
				(monitor as any).clientMonitorTimestamp ?? '',
				pc.peerConnectionId.slice(0, 8),
				pc.attachments?.direction ?? '',
				pc.qualityLimitationReason ?? '',
				num(pc.availableOutgoingBitrate),
				num(pc.sendingBitrate),
				num(pc.outgoingBitrateHeadroom),
				num(pc.ewmaOutgoingBitrateHeadroom),
				num(pc.avgPacketSendDelayInMs),
				num(pc.estimatedMedianPacketSendDelayInMs),
				num(pc.receivingBitrate),
                num(pc.avgInboundVideoJitterBufferDelayInMs),
				num(pc.ewmaInboundVideoJitterBufferDelayInMs),
				num(pc.outboundFractionLost),
				num(pc.avgInboundFractionLost),
				num(pc.avgRttInSec === undefined ? undefined : pc.avgRttInSec * 1000),
				pc.uplinkCongested ? 1 : 0,
				pc.downlinkCongested ? 1 : 0,
				old.high ? 1 : 0,
				old.medium ? 1 : 0,
				old.low ? 1 : 0,
				pc.hasInboundVideo ? 1 : 0,
				num(pc.statsClockTime),
			].join(','));
		}
	}

	replayer.finish();

	fs.writeFileSync(OUT_FILE, rows.join('\n'));
	fs.writeFileSync(OUT_FILE.replace(/\.csv$/, '.episodes.json'), JSON.stringify({ episodes, resolutions }, null, 2));

	// eslint-disable-next-line no-console
	console.log(`ticks=${tick} rows=${rows.length - 1} episodes=${episodes.length} resolutions=${resolutions.length}`);
});
