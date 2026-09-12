import { ReplayEntry } from './StatsReplayer';
import { RtcStats } from '../../src/schema/W3cStatsIdentifiers';

/**
 * Synthetic uplink scenarios: what a sending connection's stats look like while
 * a particular thing goes wrong with the path.
 *
 * A scenario is a list of phases, and a phase is a *level* every field holds for
 * some collections. The generator turns those levels into the cumulative counters
 * `getStats()` actually reports, so the monitors derive their facts the same way
 * they do from a live browser — no field is written directly.
 *
 * The levels are taken from a captured session on Chromium 141: a 1.2 Mbps path
 * carrying a megabit at 30fps, a pacer sitting under a millisecond per packet,
 * and a 40ms round trip.
 */

/** What every field is doing during one collection. */
export type Condition = {
	/** The browser's send-side estimate, in bps. `undefined` models a browser that computes none. */
	availableBps?: number;
	/** What the congestion controller told the encoder to produce, in bps. */
	targetBps: number;
	/** What actually went on the wire, in bps. */
	actualBps: number;
	/** Frames the encoder produced per second. The signal that separates a narrowed path from quiet content. */
	fps: number;
	/** Mean pacer queue time per packet, in ms. */
	pacerMsPerPacket: number;
	/** Round trip as the far end reports it, in ms. */
	rttMs: number;
	/** Inter-arrival jitter the far end reports, in ms. */
	jitterMs: number;
	/** Packets the far end reports lost during this collection. */
	lostPackets: number;
	/** The browser's own verdict. */
	limitation: 'none' | 'bandwidth' | 'cpu' | 'other';
	/** Mean quantizer — rises as the encoder squeezes quality into a smaller budget. */
	qp: number;
};

export type Phase = { collections: number, condition: Condition };

const HEALTHY: Condition = {
	availableBps: 1_200_000,
	targetBps: 1_000_000,
	actualBps: 1_000_000,
	fps: 30,
	pacerMsPerPacket: 0.5,
	rttMs: 40,
	jitterMs: 8,
	lostPackets: 0,
	limitation: 'none',
	qp: 16,
};

/** A phase built by naming only what differs from a healthy collection. */
export const phase = (collections: number, condition: Partial<Condition> = {}): Phase =>
	({ collections, condition: { ...HEALTHY, ...condition } });

const PC_ID = 'pc-uplink';
const MTU_PAYLOAD_BYTES = 1200;

/**
 * Turns phases into `ReplayEntry` lines. Counters accumulate across the whole
 * run exactly as a browser's do, so a detector reading a delta sees a real
 * interval and never a level someone assigned it.
 */
export function generateScenario(phases: Phase[], options: {
	collectingPeriodInMs?: number,
	startTimestamp?: number,
} = {}): ReplayEntry[] {
	const periodInMs = options.collectingPeriodInMs ?? 1000;
	const startedAt = options.startTimestamp ?? 1_700_000_000_000;
	const periodInS = periodInMs / 1000;

	// Cumulative counters, the only state a real getStats() carries between calls.
	let bytesSent = 0;
	let packetsSent = 0;
	let framesEncoded = 0;
	let framesSent = 0;
	let totalPacketSendDelay = 0;
	let qpSum = 0;
	let totalEncodeTime = 0;
	let packetsLost = 0;
	let totalRoundTripTime = 0;
	let rttMeasurements = 0;
	let pairBytesSent = 0;
	let pairPacketsSent = 0;
	let responsesReceived = 0;
	let sourceFrames = 0;
	const limitationDurations = { none: 0, bandwidth: 0, cpu: 0, other: 0 };

	const entries: ReplayEntry[] = [];
	let tick = 0;

	for (const { collections, condition: c } of phases) {
		for (let i = 0; i < collections; ++i) {
			const timestamp = startedAt + (tick * periodInMs);
			const bytesThisTick = (c.actualBps * periodInS) / 8;
			const packetsThisTick = Math.max(1, Math.round(bytesThisTick / MTU_PAYLOAD_BYTES));
			const framesThisTick = Math.round(c.fps * periodInS);

			bytesSent += bytesThisTick;
			packetsSent += packetsThisTick;
			framesEncoded += framesThisTick;
			framesSent += framesThisTick;
			// The pacer figure is per packet, so the counter grows with both.
			totalPacketSendDelay += (c.pacerMsPerPacket / 1000) * packetsThisTick;
			qpSum += c.qp * framesThisTick;
			// Small frames cost less to encode — the property that makes this a CPU discriminator.
			totalEncodeTime += (bytesThisTick / framesThisTick / 60_000) * framesThisTick;
			packetsLost += c.lostPackets;
			totalRoundTripTime += c.rttMs / 1000;
			rttMeasurements += 1;
			responsesReceived += 1;
			// The transport carries RTP plus overhead; STUN and DTLS are the difference.
			pairBytesSent += bytesThisTick * 1.05;
			pairPacketsSent += packetsThisTick + 1;
			sourceFrames += Math.round(30 * periodInS);
			limitationDurations[c.limitation] += periodInS;

			const stats: RtcStats[] = [
				{
					type: 'transport', id: 'T01', timestamp,
					selectedCandidatePairId: 'P01',
					bytesSent: pairBytesSent, packetsSent: pairPacketsSent,
					dtlsState: 'connected', iceState: 'connected',
					selectedCandidatePairChanges: 1,
				},
				{
					type: 'candidate-pair', id: 'P01', timestamp, transportId: 'T01',
					localCandidateId: 'L01', remoteCandidateId: 'R01',
					state: 'succeeded', nominated: true,
					...(c.availableBps === undefined ? {} : { availableOutgoingBitrate: c.availableBps }),
					bytesSent: pairBytesSent, packetsSent: pairPacketsSent,
					bytesDiscardedOnSend: 0, packetsDiscardedOnSend: 0,
					currentRoundTripTime: c.rttMs / 1000,
					totalRoundTripTime, responsesReceived, requestsSent: responsesReceived,
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
					type: 'media-source', id: 'S01', timestamp, kind: 'video',
					trackIdentifier: 'track-video', frames: sourceFrames, framesPerSecond: 30,
					width: 1280, height: 720,
				},
				{
					type: 'outbound-rtp', id: 'O01', timestamp, ssrc: 1001, kind: 'video',
					transportId: 'T01', mediaSourceId: 'S01', mid: '0', active: true,
					bytesSent, packetsSent, framesEncoded, framesSent,
					totalPacketSendDelay, qpSum, totalEncodeTime,
					targetBitrate: c.targetBps,
					framesPerSecond: c.fps,
					frameWidth: 1280, frameHeight: 720,
					qualityLimitationReason: c.limitation,
					qualityLimitationDurations: { ...limitationDurations },
					qualityLimitationResolutionChanges: 0,
					nackCount: 0, pliCount: 0, firCount: 0,
					retransmittedPacketsSent: 0, retransmittedBytesSent: 0,
					keyFramesEncoded: 1, hugeFramesSent: 0,
				},
				{
					type: 'remote-inbound-rtp', id: 'RI01', timestamp, ssrc: 1001, kind: 'video',
					transportId: 'T01', localId: 'O01',
					packetsLost, jitter: c.jitterMs / 1000,
					roundTripTime: c.rttMs / 1000,
					totalRoundTripTime, roundTripTimeMeasurements: rttMeasurements,
					fractionLost: c.lostPackets / Math.max(1, packetsThisTick),
				},
			] as unknown as RtcStats[];

			entries.push({ timestamp, peerConnections: [[PC_ID, stats]] });
			++tick;
		}
	}

	return entries;
}

/**
 * A brief dip and a fast recovery — a bandwidth probe that overshot, or a
 * cellular cell change. The path is momentarily short of what the encoder is
 * producing and the browser says `bandwidth` for one collection, but nothing is
 * actually being given up: the frame rate holds and the pacer barely moves.
 *
 * **This is the false positive.** A detector that fires here reports a fault the
 * viewer never saw, once every time the controller probes.
 */
export const transientDipScenario = () => generateScenario([
	phase(20),
	phase(1, {
		availableBps: 900_000, targetBps: 1_100_000, actualBps: 1_000_000,
		pacerMsPerPacket: 6, limitation: 'bandwidth', qp: 18,
	}),
	phase(1, { availableBps: 950_000, actualBps: 980_000, pacerMsPerPacket: 2, qp: 17 }),
	phase(15),
]);

/**
 * The path loses most of its capacity between one collection and the next — a
 * shaper engaging, or another device on the link starting a large transfer.
 *
 * The first collection is the inversion the detector is built on: the estimate has
 * already collapsed while the encoder is still sending the old rate. Then the
 * encoder follows it down, giving up frames as it goes, and the call runs on at a
 * third of what it had until the capacity comes back.
 */
export const capacityCollapseScenario = () => generateScenario([
	phase(20),
	// The estimate falls; the encoder has not been told yet.
	phase(1, {
		availableBps: 300_000, targetBps: 1_000_000, actualBps: 950_000,
		fps: 30, pacerMsPerPacket: 45, rttMs: 55, jitterMs: 14,
		lostPackets: 30, limitation: 'bandwidth', qp: 24,
	}),
	// The encoder has followed, and is paying for it in frames.
	phase(8, {
		availableBps: 300_000, targetBps: 320_000, actualBps: 310_000,
		fps: 15, pacerMsPerPacket: 18, rttMs: 50, jitterMs: 12,
		limitation: 'bandwidth', qp: 30,
	}),
	// The capacity comes back.
	phase(10),
]);

/**
 * A loss-based flow — a TCP upload, a system update — starting on the same link.
 * It is more aggressive than a delay-based congestion controller by construction:
 * it fills the buffer until it sees loss, and our controller yields to it long
 * before that.
 *
 * **The one scenario where the queue actually forms.** Round trip climbs from 40ms
 * to over 200 as the competing flow fills the bottleneck, which is exactly the
 * evidence a captured session never showed — because on those, our controller was
 * the only thing on the link and backed off before any queue built.
 */
export const competingFlowScenario = () => generateScenario([
	phase(20),
	// The flow ramps. Our estimate walks down in steps while the queue fills.
	phase(3, {
		availableBps: 900_000, targetBps: 900_000, actualBps: 890_000,
		fps: 28, pacerMsPerPacket: 3, rttMs: 90, jitterMs: 16,
		lostPackets: 2, limitation: 'none', qp: 19,
	}),
	phase(3, {
		availableBps: 600_000, targetBps: 620_000, actualBps: 610_000,
		fps: 24, pacerMsPerPacket: 8, rttMs: 160, jitterMs: 24,
		lostPackets: 5, limitation: 'bandwidth', qp: 24,
	}),
	phase(4, {
		availableBps: 420_000, targetBps: 450_000, actualBps: 430_000,
		fps: 18, pacerMsPerPacket: 14, rttMs: 210, jitterMs: 30,
		lostPackets: 8, limitation: 'bandwidth', qp: 29,
	}),
	// The competing flow finishes.
	phase(12),
]);

/**
 * A severe episode, then a path that comes back to two thirds of what it had —
 * the ordinary shape of a shaper lifting, a cell handover settling, or a
 * competing flow leaving one device behind.
 *
 * The second dip is shallow *against the new plateau* and deep against the peak
 * the path last reached before the episode. Which of the two the detector scores
 * it against is the whole question the post-episode faster fade answers.
 */
export const partialRecoveryScenario = () => generateScenario([
	phase(20),
	phase(8, {
		availableBps: 300_000, targetBps: 300_000, actualBps: 300_000,
		fps: 15, pacerMsPerPacket: 20, rttMs: 55, jitterMs: 14,
		lostPackets: 20, limitation: 'bandwidth', qp: 30,
	}),
	// Back, but not to where it was.
	phase(25, {
		availableBps: 800_000, targetBps: 700_000, actualBps: 700_000,
		qp: 18,
	}),
	// A dip a third below the new plateau, and more than half below the old peak.
	phase(6, {
		availableBps: 520_000, targetBps: 500_000, actualBps: 500_000,
		fps: 22, pacerMsPerPacket: 6, rttMs: 48, jitterMs: 12,
		limitation: 'bandwidth', qp: 24,
	}),
]);

/**
 * The same episode, but with the second dip arriving *after* the post-episode window has
 * closed rather than inside it — a long call that went bad once, recovered fully, drifted
 * down for a while, and then narrowed for real.
 *
 * The faster fade is a temporary measure, and this is what "temporary" has to mean: by the
 * time the drift happens the maximum is fading at the ordinary rate again, so it still
 * remembers the peak and the dip is scored against it. A fade that never returned to normal
 * would have forgotten the peak and stayed quiet through a real narrowing.
 */
export const fadeReturnsToNormalScenario = () => generateScenario([
	phase(20),
	phase(8, {
		availableBps: 300_000, targetBps: 300_000, actualBps: 300_000,
		fps: 15, pacerMsPerPacket: 20, rttMs: 55, jitterMs: 14,
		lostPackets: 20, limitation: 'bandwidth', qp: 30,
	}),
	// Fully recovered, and held long enough for the 30-second faster fade to expire.
	phase(31),
	// A drift the detector says nothing about, long enough to matter to a fading maximum.
	phase(25, { availableBps: 700_000, targetBps: 650_000, actualBps: 650_000, qp: 18 }),
	phase(6, {
		availableBps: 520_000, targetBps: 500_000, actualBps: 500_000,
		fps: 22, pacerMsPerPacket: 6, rttMs: 48, jitterMs: 12,
		limitation: 'bandwidth', qp: 24,
	}),
]);

export const UPLINK_SCENARIOS = {
	'transient-dip': transientDipScenario,
	'capacity-collapse': capacityCollapseScenario,
	'competing-flow': competingFlowScenario,
	'partial-recovery': partialRecoveryScenario,
	'fade-returns-to-normal': fadeReturnsToNormalScenario,
} as const;
