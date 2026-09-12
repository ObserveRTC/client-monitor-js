import { ReplayEntry } from './StatsReplayer';
import { RtcStats } from '../../src/schema/W3cStatsIdentifiers';

/**
 * Synthetic downlink scenarios: what a *receiving* connection's stats look like while
 * a particular thing goes wrong with the path.
 *
 * The same shape as `congestionScenarios.ts` on the sending side — a scenario is a list
 * of phases, and a phase is a level every field holds for some collections. The generator
 * turns those levels into the cumulative counters `getStats()` actually reports, so the
 * monitors derive their facts exactly as they do from a live browser and no field is ever
 * written directly.
 *
 * The levels come from the captured throttle run: 1849 kbps arriving at 30fps with frames
 * spending 12ms in the jitter buffer, against ~420 kbps and 3109ms while throttled.
 */

/** What every field is doing during one collection. */
export type InboundCondition = {
	/** What actually arrived, in bps. */
	receivingBps: number;
	/** Frames the decoder produced per second. */
	fps: number;
	/** Mean time a frame spent in the jitter buffer, in ms — the bloating witness. */
	jitterBufferMsPerFrame: number;
	/** Inter-arrival jitter, in ms. */
	jitterMs: number;
	/** Packets reported lost during this collection. */
	lostPackets: number;
	/**
	 * Whether this endpoint is also sending, and what the browser says about its encoder.
	 * `undefined` models a receive-only connection — a webinar attendee — which reports no
	 * `qualityLimitationReason` at all.
	 */
	limitation?: 'none' | 'bandwidth' | 'cpu' | 'other';
};

export type InboundPhase = { collections: number, condition: InboundCondition };

const HEALTHY: InboundCondition = {
	receivingBps: 1_849_000,
	fps: 30,
	jitterBufferMsPerFrame: 12,
	jitterMs: 2,
	lostPackets: 0,
	limitation: 'none',
};

export const inboundPhase = (collections: number, condition: Partial<InboundCondition> = {}): InboundPhase =>
	({ collections, condition: { ...HEALTHY, ...condition } });

const PC_ID = 'pc-downlink';
const MTU_PAYLOAD_BYTES = 1200;

/**
 * Turns phases into `ReplayEntry` lines. Counters accumulate across the whole run exactly
 * as a browser's do, so a detector reading a delta sees a real interval rather than a level
 * someone assigned it.
 */
export function generateInboundScenario(phases: InboundPhase[], options: {
	collectingPeriodInMs?: number,
	startTimestamp?: number,
} = {}): ReplayEntry[] {
	const periodInMs = options.collectingPeriodInMs ?? 1000;
	const startedAt = options.startTimestamp ?? 1_700_000_000_000;
	const periodInS = periodInMs / 1000;

	// Cumulative counters, the only state a real getStats() carries between calls.
	let bytesReceived = 0;
	let packetsReceived = 0;
	let packetsLost = 0;
	let framesDecoded = 0;
	let framesReceived = 0;
	let framesRendered = 0;
	let jitterBufferDelay = 0;
	let jitterBufferEmittedCount = 0;
	let totalDecodeTime = 0;
	let pairBytesReceived = 0;
	let pairPacketsReceived = 0;
	let responsesReceived = 0;
	let bytesSent = 0;
	let packetsSent = 0;
	let totalPacketSendDelay = 0;
	const limitationDurations = { none: 0, bandwidth: 0, cpu: 0, other: 0 };

	const entries: ReplayEntry[] = [];
	let tick = 0;

	for (const { collections, condition: c } of phases) {
		for (let i = 0; i < collections; ++i) {
			const timestamp = startedAt + (tick * periodInMs);
			const bytesThisTick = (c.receivingBps * periodInS) / 8;
			const packetsThisTick = Math.max(1, Math.round(bytesThisTick / MTU_PAYLOAD_BYTES));
			const framesThisTick = Math.max(1, Math.round(c.fps * periodInS));

			bytesReceived += bytesThisTick;
			packetsReceived += packetsThisTick;
			packetsLost += c.lostPackets;
			framesDecoded += framesThisTick;
			framesReceived += framesThisTick;
			framesRendered += framesThisTick;
			// The buffer figure is per frame, so the counter grows with both.
			jitterBufferDelay += (c.jitterBufferMsPerFrame / 1000) * framesThisTick;
			jitterBufferEmittedCount += framesThisTick;
			totalDecodeTime += 0.004 * framesThisTick;
			pairBytesReceived += bytesThisTick * 1.05;
			pairPacketsReceived += packetsThisTick + 1;
			responsesReceived += 1;

			// A sending side only where the scenario has one. A receive-only connection
			// reports no outbound stream at all, and so no limitation verdict.
			const sending = c.limitation !== undefined;

			if (sending) {
				bytesSent += 25_000 * periodInS;
				packetsSent += Math.max(1, Math.round((25_000 * periodInS) / MTU_PAYLOAD_BYTES));
				totalPacketSendDelay += 0.0005 * packetsSent;
				limitationDurations[c.limitation as 'none'] += periodInS;
			}

			const stats: RtcStats[] = [
				{
					type: 'transport', id: 'T01', timestamp,
					selectedCandidatePairId: 'P01',
					bytesReceived: pairBytesReceived, packetsReceived: pairPacketsReceived,
					dtlsState: 'connected', iceState: 'connected',
					selectedCandidatePairChanges: 1,
				},
				{
					type: 'candidate-pair', id: 'P01', timestamp, transportId: 'T01',
					localCandidateId: 'L01', remoteCandidateId: 'R01',
					state: 'succeeded', nominated: true,
					bytesReceived: pairBytesReceived, packetsReceived: pairPacketsReceived,
					currentRoundTripTime: 0.04,
					totalRoundTripTime: 0.04 * responsesReceived,
					responsesReceived, requestsSent: responsesReceived,
				},
				{
					type: 'local-candidate', id: 'L01', timestamp, transportId: 'T01',
					candidateType: 'host', protocol: 'udp', address: '192.168.1.2', port: 50000,
				},
				{
					type: 'remote-candidate', id: 'R01', timestamp, transportId: 'T01',
					candidateType: 'srflx', protocol: 'udp', address: '10.0.0.1', port: 50001,
				},
				{
					type: 'inbound-rtp', id: 'I01', timestamp, ssrc: 2001, kind: 'video',
					transportId: 'T01', trackIdentifier: 'track-remote-video', mid: '0',
					bytesReceived, packetsReceived, packetsLost,
					jitter: c.jitterMs / 1000,
					framesDecoded, framesReceived, framesRendered,
					framesPerSecond: c.fps,
					frameWidth: 1280, frameHeight: 720,
					jitterBufferDelay, jitterBufferEmittedCount,
					totalDecodeTime,
					keyFramesDecoded: 1, framesDropped: 0,
					nackCount: 0, pliCount: 0, firCount: 0,
					freezeCount: 0, totalFreezesDuration: 0,
					pauseCount: 0, totalPausesDuration: 0,
				},
			] as unknown as RtcStats[];

			if (sending) {
				stats.push({
					type: 'media-source', id: 'S01', timestamp, kind: 'video',
					trackIdentifier: 'track-local-video', frames: framesDecoded, framesPerSecond: 30,
					width: 640, height: 360,
				} as unknown as RtcStats);
				stats.push({
					type: 'outbound-rtp', id: 'O01', timestamp, ssrc: 1001, kind: 'video',
					transportId: 'T01', mediaSourceId: 'S01', mid: '1', active: true,
					bytesSent, packetsSent, framesEncoded: framesDecoded, framesSent: framesDecoded,
					totalPacketSendDelay, qpSum: 16 * framesDecoded, totalEncodeTime: 0.004 * framesDecoded,
					targetBitrate: 25_000, framesPerSecond: 30,
					frameWidth: 640, frameHeight: 360,
					qualityLimitationReason: c.limitation,
					qualityLimitationDurations: { ...limitationDurations },
					qualityLimitationResolutionChanges: 0,
					nackCount: 0, pliCount: 0, firCount: 0,
					retransmittedPacketsSent: 0, retransmittedBytesSent: 0,
					keyFramesEncoded: 1, hugeFramesSent: 0,
				} as unknown as RtcStats);
			}

			entries.push({ timestamp, peerConnections: [[PC_ID, stats]] });
			++tick;
		}
	}

	return entries;
}

/**
 * A brief dip and a fast recovery — one collection where less arrived and frames waited
 * a little longer, then back to normal.
 *
 * **This is the false positive.** A detector firing here reports a fault the viewer never
 * saw, every time a router hiccups.
 */
export const inboundTransientDipScenario = () => generateInboundScenario([
	inboundPhase(20),
	inboundPhase(1, { receivingBps: 1_100_000, jitterBufferMsPerFrame: 30, jitterMs: 12 }),
	inboundPhase(10),
]);

/**
 * The measured throttle, from the receiving side: a settled 1849 kbps call, then the path
 * drops to a quarter of that and frames start waiting hundreds of milliseconds in the
 * buffer because they are arriving slower than they are played out. Both witnesses move
 * together, which is what makes it congestion rather than a quiet sender.
 *
 * The tail recovers to a *lower* level than it started at — 1.1 Mbps rather than 1.8 —
 * because a path that narrowed rarely gives all of it back. The finding still has to close.
 */
export const inboundCapacityCollapseScenario = () => generateInboundScenario([
	inboundPhase(20),
	inboundPhase(8, {
		receivingBps: 420_000, fps: 12,
		jitterBufferMsPerFrame: 900, jitterMs: 120, lostPackets: 40,
	}),
	inboundPhase(20, { receivingBps: 1_100_000, jitterBufferMsPerFrame: 20, jitterMs: 6 }),
]);

/**
 * The far end was asked for less: a muted camera, a dropped simulcast layer, a screen share
 * of a still slide. The arriving bitrate collapses exactly as it does under congestion — and
 * the buffer never moves, because the link is carrying everything it is given.
 *
 * **This is the look-alike the second witness exists for.** A detector reading the bitrate
 * alone cannot tell this from the collapse above.
 */
export const inboundQuietSenderScenario = () => generateInboundScenario([
	inboundPhase(20),
	inboundPhase(15, { receivingBps: 300_000, fps: 4, jitterBufferMsPerFrame: 12 }),
]);

/**
 * The same collapse as `inboundCapacityCollapseScenario`, on a connection that sends nothing
 * at all — a webinar attendee, a spectator. There is no outbound stream, so no
 * `qualityLimitationReason` exists to read.
 *
 * This is the population a receive-side detector exists for, and the one a sending-side
 * verdict would make permanently blind.
 */
export const inboundReceiveOnlyCollapseScenario = () => generateInboundScenario([
	inboundPhase(20, { limitation: undefined }),
	inboundPhase(8, {
		limitation: undefined,
		receivingBps: 420_000, fps: 12,
		jitterBufferMsPerFrame: 900, jitterMs: 120, lostPackets: 40,
	}),
]);

/**
 * A severe episode, a partial recovery, and a second dip inside the window that follows.
 *
 * The path never gives all of it back: 1849 kbps before, 1200 after. The second dip is to
 * 650 kbps — a real dip against what the path now carries, and a collapse against what it
 * carried before the first episode. Which of the two the detector believes is exactly what
 * the faster post-episode fade decides.
 */
export const inboundPartialRecoveryScenario = () => generateInboundScenario([
	inboundPhase(20),
	inboundPhase(8, {
		receivingBps: 420_000, fps: 12,
		jitterBufferMsPerFrame: 900, jitterMs: 120, lostPackets: 40,
	}),
	inboundPhase(25, { receivingBps: 1_200_000, jitterBufferMsPerFrame: 14 }),
	inboundPhase(6, { receivingBps: 650_000, jitterBufferMsPerFrame: 45, jitterMs: 20 }),
]);

/**
 * An episode, a recovery, and then a slow slide — the path degrading over a minute rather
 * than falling off a cliff, with frames waiting longer at every step.
 *
 * The faster post-episode fade has to *stop*. While it runs the maximum tracks close to
 * what is arriving, which is the point; if it never stopped, the baseline would follow a
 * gradual decline all the way down and no amount of degradation would ever read as an
 * undershoot.
 */
export const inboundSlowSlideAfterEpisodeScenario = () => generateInboundScenario([
	inboundPhase(20),
	inboundPhase(8, {
		receivingBps: 420_000, fps: 12,
		jitterBufferMsPerFrame: 900, jitterMs: 120, lostPackets: 40,
	}),
	inboundPhase(20, { receivingBps: 1_200_000, jitterBufferMsPerFrame: 14 }),
	inboundPhase(4, { receivingBps: 1_050_000, jitterBufferMsPerFrame: 22 }),
	inboundPhase(4, { receivingBps: 900_000, jitterBufferMsPerFrame: 32 }),
	inboundPhase(4, { receivingBps: 750_000, jitterBufferMsPerFrame: 45 }),
	inboundPhase(6, { receivingBps: 600_000, jitterBufferMsPerFrame: 60, jitterMs: 25 }),
]);

/**
 * The receiving mirror of `fadeReturnsToNormalScenario`: the second collapse arrives after
 * the post-episode window has closed, so the maximum has gone back to fading slowly and
 * still remembers the peak. A fade that never returned to normal would have tracked the
 * drift down and stayed quiet through a real one.
 */
export const inboundFadeReturnsToNormalScenario = () => generateInboundScenario([
	inboundPhase(20),
	inboundPhase(8, {
		receivingBps: 420_000, fps: 12,
		jitterBufferMsPerFrame: 900, jitterMs: 120, lostPackets: 40,
	}),
	// Fully recovered, and held long enough for the 30-second faster fade to expire.
	inboundPhase(31, { receivingBps: 1_200_000, jitterBufferMsPerFrame: 14 }),
	// A drift with the buffer flat — nothing to report, but the maximum is fading through it.
	inboundPhase(25, { receivingBps: 700_000, jitterBufferMsPerFrame: 14 }),
	inboundPhase(6, {
		receivingBps: 520_000, fps: 22,
		jitterBufferMsPerFrame: 60, jitterMs: 25, lostPackets: 5,
	}),
]);

export const DOWNLINK_SCENARIOS = {
	transientDip: inboundTransientDipScenario,
	capacityCollapse: inboundCapacityCollapseScenario,
	quietSender: inboundQuietSenderScenario,
	receiveOnlyCollapse: inboundReceiveOnlyCollapseScenario,
	partialRecovery: inboundPartialRecoveryScenario,
	slowSlideAfterEpisode: inboundSlowSlideAfterEpisodeScenario,
	fadeReturnsToNormal: inboundFadeReturnsToNormalScenario,
};
