import { InboundRtpStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { RemoteOutboundRtpMonitor } from "./RemoteOutboundRtpMonitor";
import { positiveDelta } from "../utils/common";

export class InboundRtpMonitor implements InboundRtpStats {
	// field indicate that this object was visited by accepting stats
	private _visited = true;

	public addedAt = Date.now();

	// fields from InboundRtpStats
	timestamp: number;
	id: string;
	ssrc: number;
	kind: MediaKind;
	trackIdentifier: string;
	transportId?: string | undefined;
	codecId?: string | undefined;
	packetsReceived?: number | undefined;
	packetsReceivedWithEct1?: number | undefined;
	packetsReceivedWithCe?: number | undefined;
	packetsReportedAsLost?: number | undefined;
	packetsReportedAsLostButRecovered?: number | undefined;
	packetsLost?: number | undefined;
	jitter?: number | undefined;
	mid?: string | undefined;
	remoteId?: string | undefined;
	framesDecoded?: number | undefined;
	keyFramesDecoded?: number | undefined;
	framesRendered?: number | undefined;
	framesDropped?: number | undefined;
	frameWidth?: number | undefined;
	frameHeight?: number | undefined;
	framesPerSecond?: number | undefined;
	qpSum?: number | undefined;
	totalDecodeTime?: number | undefined;
	totalInterFrameDelay?: number | undefined;
	totalSquaredInterFrameDelay?: number | undefined;
	pauseCount?: number | undefined;
	totalPausesDuration?: number | undefined;
	freezeCount?: number | undefined;
	totalFreezesDuration?: number | undefined;
	lastPacketReceivedTimestamp?: number | undefined;
	headerBytesReceived?: number | undefined;
	packetsDiscarded?: number | undefined;
	fecBytesReceived?: number | undefined;
	fecPacketsReceived?: number | undefined;
	fecPacketsDiscarded?: number | undefined;
	bytesReceived?: number | undefined;
	nackCount?: number | undefined;
	firCount?: number | undefined;
	pliCount?: number | undefined;
	totalProcessingDelay?: number | undefined;
	estimatedPlayoutTimestamp?: number | undefined;
	jitterBufferDelay?: number | undefined;
	jitterBufferTargetDelay?: number | undefined;
	jitterBufferEmittedCount?: number | undefined;
	jitterBufferMinimumDelay?: number | undefined;
	totalSamplesReceived?: number | undefined;
	concealedSamples?: number | undefined;
	silentConcealedSamples?: number | undefined;
	concealmentEvents?: number | undefined;
	insertedSamplesForDeceleration?: number | undefined;
	removedSamplesForAcceleration?: number | undefined;
	audioLevel?: number | undefined;
	totalAudioEnergy?: number | undefined;
	totalSamplesDuration?: number | undefined;
	framesReceived?: number | undefined;
	decoderImplementation?: string | undefined;
	playoutId?: string | undefined;
	powerEfficientDecoder?: boolean | undefined;
	framesAssembledFromMultiplePackets?: number | undefined;
	totalAssemblyTime?: number | undefined;
	retransmittedPacketsReceived?: number | undefined;
	retransmittedBytesReceived?: number | undefined;
	rtxSsrc?: number | undefined;
	fecSsrc?: number | undefined;
	totalCorruptionProbability?: number | undefined;
	totalSquaredCorruptionProbability?: number | undefined;
	corruptionMeasurements?: number | undefined;

	// derived fields
	bitrate?: number;
	avgFramesPerSec?: number;
	fpsVolatility?: number;
	lastNFramesPerSec: number[] = [];
	receivingAudioSamples?: number;
	totalFractionLost?: number;
	bitPerPixel?: number;
	packetRate?: number | undefined;
	ewmaFps?: number;

	deltaPacketsLost?: number;
	deltaPacketsReceived?: number;
	deltaBytesReceived?: number;
	deltaJitterBufferDelay?: number;
	deltaCorruptionProbability?: number;
	deltaFractionLost?: number;
	deltaFramesDecoded?: number;
	deltaQpSum?: number | undefined;
	/**
	 * Mean quantizer of the frames decoded in this interval — how coarsely the
	 * picture the viewer actually saw was compressed. `undefined` when the
	 * browser does not report `qpSum` for this codec, in which case no picture
	 * quality judgement is made at all.
	 */
	avgQpPerFrame?: number | undefined;
	deltaFramesReceived?: number;
	deltaFramesRendered?: number;
	deltaTime?: number;

	// ---- derived: audio concealment & jitter buffer ----
	public deltaTotalSamplesReceived?: number;
	public deltaConcealedSamples?: number;
	public deltaSilentConcealedSamples?: number;
	public deltaConcealmentEvents?: number;
	public deltaInsertedSamplesForDeceleration?: number;
	public deltaRemovedSamplesForAcceleration?: number;
	public deltaPacketsDiscarded?: number;
	public deltaJitterBufferEmittedCount?: number;
	public deltaJitterBufferTargetDelay?: number;
	/**
	 * The share of this interval's audio (`0..1`) the listener heard as invention
	 * rather than as anything the sender actually transmitted.
	 *
	 * When packets are missing or late, NetEQ does not play silence; it fabricates
	 * audio from what came before, so playout never stops. Some of that fabrication
	 * is inaudible: while the talker was silent there was nothing to reproduce, and
	 * the invented samples come out as silence or comfort noise nobody could
	 * distinguish from the real thing. The browser reports those separately as
	 * `silentConcealedSamples` and they are subtracted here, so what is left is
	 * fabrication the listener could actually hear — the robotic or watery artefact
	 * behind a "they were breaking up" complaint.
	 *
	 * `undefined` when the browser reports no concealment counters, or when no
	 * samples arrived this interval, which is not the same as zero.
	 */
	public inventedSpeechRatio?: number;
	public concealmentEventRate?: number;
	/** Share of samples NetEQ stretched or compressed to keep up. */
	public timeStretchRate?: number;
	public avgJitterBufferDelayInMs?: number;
	public jitterBufferTargetDelayInMs?: number;
	public discardRate?: number;

	// ---- derived: video decode cost & recovery pressure ----
	public deltaFramesDropped?: number;
	public deltaKeyFramesDecoded?: number;
	public deltaTotalDecodeTime?: number;
	public deltaTotalFreezesDuration?: number;
	/**
	 * Freezes that *started* in this interval. The specification counts one when the
	 * gap between two rendered frames reaches `max(3 × average duration, average +
	 * 150ms)`, so the bar scales with the stream's own frame rate — roughly 100ms at
	 * 30fps and 600ms at 5fps — and a slow but evenly-paced picture never trips it.
	 *
	 * A counter accumulated frame by frame, which is what makes it readable at any
	 * collecting period: unlike `framesPerSecond`, which is the rate sampled at the
	 * moment of collection, nothing here is lost between collections.
	 */
	public deltaFreezeCount?: number;
	/**
	 * Share of this interval the picture spent frozen — `totalFreezesDuration` over
	 * the interval, both taken in seconds.
	 *
	 * The companion to {@link deltaFreezeCount}, and what it cannot say on its own:
	 * the counter reports how many times the picture stopped, this reports how much
	 * of the viewer's time those stops took. Two brief interruptions and two that
	 * left the picture off for most of the interval score the same count and read
	 * very differently here.
	 *
	 * Needs nothing declared by the application, which is what makes it usable on a
	 * whole fleet: it says how much of the viewer's time was lost without anyone
	 * having to state what the stream was supposed to deliver.
	 *
	 * **Can exceed `1`.** A freeze is credited entirely to the interval containing
	 * the frame that ends it, so a stop spanning several collections lands in one of
	 * them whole — the intervals it covered report nothing at all, and the one that
	 * catches the recovery can report more frozen time than it lasted. Read above
	 * `1` as "the picture was stopped for longer than this collection", which is
	 * exactly what it means, rather than as a broken ratio.
	 */
	public frozenTimeRatio?: number;
	/**
	 * Pauses that ended in this interval, and how long they lasted in total.
	 *
	 * The other half of {@link deltaFreezeCount}, and not optional to read. The
	 * specification splits a stopped picture in two by duration — "video is
	 * considered to be paused if time passed since last rendered frame exceeds 5
	 * seconds" — and the split is exclusive: past that bar `freezeCount` and
	 * `totalFreezesDuration` do not move at all, and these two carry the outage
	 * instead. Verified on Chromium 141, which reports a 5.5s stop as a freeze and
	 * a 6s stop as a pause, with the other pair flat.
	 *
	 * So anything reading only the freeze counters is blind to exactly the longest
	 * interruptions. Both pairs are credited on the collection containing the frame
	 * that ends the stop, and both count one per contiguous stop.
	 */
	public deltaPauseCount?: number;
	public deltaTotalPausesDuration?: number;
	/**
	 * Share of this interval the picture spent paused — the pause counterpart of
	 * {@link frozenTimeRatio}, and subject to the same caveat: it can exceed `1`,
	 * because a stop spanning collections is credited whole to the one that catches
	 * the recovery.
	 */
	public pausedTimeRatio?: number;
	public deltaTotalInterFrameDelay?: number;
	public deltaTotalSquaredInterFrameDelay?: number;
	/** Mean gap between the frames rendered in this interval, in milliseconds. */
	public avgInterFrameDelayInMs?: number;
	/**
	 * How unevenly those frames arrived: the standard deviation of the gap between
	 * them over its mean, taken from the two interval sums the browser accumulates
	 * per frame.
	 *
	 * Unitless. An evenly-paced picture sits near zero whether it runs at 30fps or at 8 —
	 * slow is not uneven — and any interruption lifts it, so it reads well as a
	 * direction: this interval was more ragged than that one, on the same stream.
	 *
	 * It does not read as a threshold, and this is worth knowing before anyone
	 * gates on it. One freeze of length `D` against a normal gap `d`, among `N`
	 * frames, moves the value by roughly `(D - d) / (d * sqrt(N))` — so the same
	 * interruption measures differently at a different frame rate or a different
	 * collecting period, both of which change `N`. Two freezes at exactly the
	 * spec's own freeze threshold land near 0.86 at 30fps over a second and near
	 * 0.34 at 15fps over five, which is the same event and a two-and-a-half-fold
	 * spread. Anything needing a fixed line wants a normalised quantity instead,
	 * such as `InboundTrackMonitor.deliveredFrameRatio`.
	 *
	 * `undefined` until two frames have been rendered in an interval, which is the
	 * least that can carry a spread.
	 */
	public interFrameDelayVariation?: number;
	public deltaPliCount?: number;
	public deltaFirCount?: number;
	public deltaNackCount?: number;
	public deltaRetransmittedBytesReceived?: number;
	public deltaRetransmittedPacketsReceived?: number;
	/** Share of the bytes received in this interval that were retransmissions. */
	public retransmissionRatio?: number;
	public decodeTimePerFrameInMs?: number;
	public dropRatio?: number;
	public renderRatio?: number;
	public keyFrameRate?: number;
	public pliRate?: number;
	public firRate?: number;
	public nackRate?: number;

	/**
	 * Additional data attached to this stats, will be shipped to the server
	 */
	attachments?: Record<string, unknown> | undefined;
	/**
	 * Additional data attached to this stats, will not be shipped to the server,
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: InboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind as MediaKind;
		this.trackIdentifier = options.trackIdentifier;

		this._updateStats(options);
	}

	/**
	 * Copies the report onto this monitor, field by field.
	 *
	 * Deliberately not `Object.assign`, which copies only the members a report
	 * happens to carry and silently leaves every other one at its previous value.
	 * `getStats()` omits what it has nothing to say about — `framesPerSecond` once
	 * frames stop being decoded, `qpSum` on a codec that does not expose it — and
	 * under `Object.assign` those fields kept describing an interval that had
	 * already passed. Anything reading them then saw a healthy last measurement for
	 * as long as the condition lasted, which is exactly backwards: the moment the
	 * browser stops measuring is the moment worth noticing.
	 *
	 * Assigning every field means an omitted member arrives as `undefined`, which is
	 * what it means. The identity fields are assigned too, from a report that is
	 * required to carry them.
	 */
	private _updateStats(stats: Omit<InboundRtpStats, 'appData'>): void {
		this.timestamp = stats.timestamp;
		this.id = stats.id;
		this.ssrc = stats.ssrc;
		this.kind = stats.kind as MediaKind;
		this.trackIdentifier = stats.trackIdentifier;

		this.transportId = stats.transportId;
		this.codecId = stats.codecId;
		this.packetsReceived = stats.packetsReceived;
		this.packetsReceivedWithEct1 = stats.packetsReceivedWithEct1;
		this.packetsReceivedWithCe = stats.packetsReceivedWithCe;
		this.packetsReportedAsLost = stats.packetsReportedAsLost;
		this.packetsReportedAsLostButRecovered = stats.packetsReportedAsLostButRecovered;
		this.packetsLost = stats.packetsLost;
		this.jitter = stats.jitter;
		this.mid = stats.mid;
		this.remoteId = stats.remoteId;
		this.framesDecoded = stats.framesDecoded;
		this.keyFramesDecoded = stats.keyFramesDecoded;
		this.framesRendered = stats.framesRendered;
		this.framesDropped = stats.framesDropped;
		this.frameWidth = stats.frameWidth;
		this.frameHeight = stats.frameHeight;
		this.framesPerSecond = stats.framesPerSecond;
		this.qpSum = stats.qpSum;
		this.totalDecodeTime = stats.totalDecodeTime;
		this.totalInterFrameDelay = stats.totalInterFrameDelay;
		this.totalSquaredInterFrameDelay = stats.totalSquaredInterFrameDelay;
		this.pauseCount = stats.pauseCount;
		this.totalPausesDuration = stats.totalPausesDuration;
		this.freezeCount = stats.freezeCount;
		this.totalFreezesDuration = stats.totalFreezesDuration;
		this.lastPacketReceivedTimestamp = stats.lastPacketReceivedTimestamp;
		this.headerBytesReceived = stats.headerBytesReceived;
		this.packetsDiscarded = stats.packetsDiscarded;
		this.fecBytesReceived = stats.fecBytesReceived;
		this.fecPacketsReceived = stats.fecPacketsReceived;
		this.fecPacketsDiscarded = stats.fecPacketsDiscarded;
		this.bytesReceived = stats.bytesReceived;
		this.nackCount = stats.nackCount;
		this.firCount = stats.firCount;
		this.pliCount = stats.pliCount;
		this.totalProcessingDelay = stats.totalProcessingDelay;
		this.estimatedPlayoutTimestamp = stats.estimatedPlayoutTimestamp;
		this.jitterBufferDelay = stats.jitterBufferDelay;
		this.jitterBufferTargetDelay = stats.jitterBufferTargetDelay;
		this.jitterBufferEmittedCount = stats.jitterBufferEmittedCount;
		this.jitterBufferMinimumDelay = stats.jitterBufferMinimumDelay;
		this.totalSamplesReceived = stats.totalSamplesReceived;
		this.concealedSamples = stats.concealedSamples;
		this.silentConcealedSamples = stats.silentConcealedSamples;
		this.concealmentEvents = stats.concealmentEvents;
		this.insertedSamplesForDeceleration = stats.insertedSamplesForDeceleration;
		this.removedSamplesForAcceleration = stats.removedSamplesForAcceleration;
		this.audioLevel = stats.audioLevel;
		this.totalAudioEnergy = stats.totalAudioEnergy;
		this.totalSamplesDuration = stats.totalSamplesDuration;
		this.framesReceived = stats.framesReceived;
		this.decoderImplementation = stats.decoderImplementation;
		this.playoutId = stats.playoutId;
		this.powerEfficientDecoder = stats.powerEfficientDecoder;
		this.framesAssembledFromMultiplePackets = stats.framesAssembledFromMultiplePackets;
		this.totalAssemblyTime = stats.totalAssemblyTime;
		this.retransmittedPacketsReceived = stats.retransmittedPacketsReceived;
		this.retransmittedBytesReceived = stats.retransmittedBytesReceived;
		this.rtxSsrc = stats.rtxSsrc;
		this.fecSsrc = stats.fecSsrc;
		this.totalCorruptionProbability = stats.totalCorruptionProbability;
		this.totalSquaredCorruptionProbability = stats.totalSquaredCorruptionProbability;
		this.corruptionMeasurements = stats.corruptionMeasurements;
		this.attachments = stats.attachments;
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	/**
	 * Milliseconds of **stats time** this monitor has observed, accumulated from
	 * `deltaTime` — the clock every window and duration in the library is measured
	 * on, and the one thing `Date.now()` must never stand in for.
	 *
	 * It advances by what each collection actually cost rather than by one nominal
	 * period, so a late or skipped collection widens a window by the time the
	 * condition really held underneath. It never goes backwards and it is not a
	 * timestamp: only differences between two readings of it mean anything.
	 */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public accept(stats: Omit<InboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;

		if (elapsedInMs <= 0) {
			// The same report served again: no interval passed, so nothing derived
			// from one can be recomputed. The fields still take the report, so what
			// this monitor holds is always the latest one seen.
			this._updateStats(stats);

			return; // logger?
		}
		const elapsedInSec = elapsedInMs / 1000;

		// before we assign let's update delta fields
		this.deltaTotalSamplesReceived = positiveDelta(stats.totalSamplesReceived, this.totalSamplesReceived);
		if (this.deltaTotalSamplesReceived !== undefined) {
			this.receivingAudioSamples = this.deltaTotalSamplesReceived;
		}
		if (this.bytesReceived !== undefined && stats.bytesReceived !== undefined) {
			this.deltaBytesReceived = positiveDelta(stats.bytesReceived, this.bytesReceived);
			// a counter reset leaves the delta undefined; carrying the previous
			// bitrate forward would describe traffic this interval did not see
			this.bitrate = this.deltaBytesReceived === undefined
				? undefined
				: Math.max(0, this.deltaBytesReceived * 8 / elapsedInSec);
		}
		if (this.packetsLost !== undefined && stats.packetsLost !== undefined) {
			this.deltaPacketsLost = positiveDelta(stats.packetsLost, this.packetsLost);
		}
		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined) {
			this.deltaPacketsReceived = positiveDelta(stats.packetsReceived, this.packetsReceived);
			this.packetRate = this.deltaPacketsReceived === undefined
				? undefined
				: this.deltaPacketsReceived / elapsedInSec;
		}

		// ---- audio: concealment and jitter-buffer pressure ----
		this.deltaConcealedSamples = positiveDelta(stats.concealedSamples, this.concealedSamples);
		this.deltaSilentConcealedSamples = positiveDelta(stats.silentConcealedSamples, this.silentConcealedSamples);
		this.deltaConcealmentEvents = positiveDelta(stats.concealmentEvents, this.concealmentEvents);
		this.deltaInsertedSamplesForDeceleration = positiveDelta(stats.insertedSamplesForDeceleration, this.insertedSamplesForDeceleration);
		this.deltaRemovedSamplesForAcceleration = positiveDelta(stats.removedSamplesForAcceleration, this.removedSamplesForAcceleration);
		this.deltaPacketsDiscarded = positiveDelta(stats.packetsDiscarded, this.packetsDiscarded);
		this.deltaJitterBufferEmittedCount = positiveDelta(stats.jitterBufferEmittedCount, this.jitterBufferEmittedCount);

		if (this.deltaConcealedSamples !== undefined && 0 < (this.deltaTotalSamplesReceived ?? 0)) {
			// silent concealment is subtracted: `concealedSamples` also rises during ordinary silence
			const invented = Math.max(0, this.deltaConcealedSamples - (this.deltaSilentConcealedSamples ?? 0));

			this.inventedSpeechRatio = invented / (this.deltaTotalSamplesReceived as number);
		} else {
			this.inventedSpeechRatio = undefined;
		}
		this.concealmentEventRate = this.deltaConcealmentEvents !== undefined
			? this.deltaConcealmentEvents / elapsedInSec : undefined;

		if (0 < (this.deltaTotalSamplesReceived ?? 0)) {
			const stretched = (this.deltaInsertedSamplesForDeceleration ?? 0) + (this.deltaRemovedSamplesForAcceleration ?? 0);

			this.timeStretchRate = stretched / (this.deltaTotalSamplesReceived as number);
		} else {
			this.timeStretchRate = undefined;
		}

		if (this.deltaPacketsDiscarded !== undefined) {
			const consumed = this.deltaPacketsDiscarded + (this.deltaPacketsReceived ?? 0);

			this.discardRate = 0 < consumed ? this.deltaPacketsDiscarded / consumed : 0;
		}
		if (this.totalCorruptionProbability !== undefined &&
			stats.totalCorruptionProbability !== undefined &&
			this.corruptionMeasurements !== undefined &&
			stats.corruptionMeasurements !== undefined
		) {
			const deltaCorruption = stats.totalCorruptionProbability - this.totalCorruptionProbability;
			const deltaMeasurements = Math.max(1, stats.corruptionMeasurements - this.corruptionMeasurements);
			this.deltaCorruptionProbability = Math.max(
				0,
				deltaCorruption / deltaMeasurements
			);
		}

		this.deltaJitterBufferDelay = positiveDelta(stats.jitterBufferDelay, this.jitterBufferDelay);
		this.deltaFramesDecoded = positiveDelta(stats.framesDecoded, this.framesDecoded);
		this.deltaFramesReceived = positiveDelta(stats.framesReceived, this.framesReceived);
		this.deltaFramesRendered = positiveDelta(stats.framesRendered, this.framesRendered);
		this.deltaFramesDropped = positiveDelta(stats.framesDropped, this.framesDropped);
		this.deltaKeyFramesDecoded = positiveDelta(stats.keyFramesDecoded, this.keyFramesDecoded);
		this.deltaQpSum = positiveDelta(stats.qpSum, this.qpSum);

		if (this.deltaQpSum !== undefined && this.deltaFramesDecoded !== undefined && 0 < this.deltaFramesDecoded) {
			this.avgQpPerFrame = this.deltaQpSum / this.deltaFramesDecoded;
		} else {
			// No frames decoded this interval, or the browser does not report
			// qpSum: carrying the previous average forward would describe media
			// that is no longer being shown.
			this.avgQpPerFrame = undefined;
		}
		this.deltaTotalDecodeTime = positiveDelta(stats.totalDecodeTime, this.totalDecodeTime);
		this.deltaTotalFreezesDuration = positiveDelta(stats.totalFreezesDuration, this.totalFreezesDuration);
		this.deltaFreezeCount = positiveDelta(stats.freezeCount, this.freezeCount);
		// Both sides are seconds — `totalFreezesDuration` by specification, `elapsedInSec`
		// by construction — so the ratio needs no conversion and carries no unit.
		this.frozenTimeRatio = this.deltaTotalFreezesDuration !== undefined && 0 < elapsedInSec
			? this.deltaTotalFreezesDuration / elapsedInSec
			: undefined;
		this.deltaPauseCount = positiveDelta(stats.pauseCount, this.pauseCount);
		this.deltaTotalPausesDuration = positiveDelta(stats.totalPausesDuration, this.totalPausesDuration);
		this.pausedTimeRatio = this.deltaTotalPausesDuration !== undefined && 0 < elapsedInSec
			? this.deltaTotalPausesDuration / elapsedInSec
			: undefined;
		this.deltaTotalInterFrameDelay = positiveDelta(stats.totalInterFrameDelay, this.totalInterFrameDelay);
		this.deltaTotalSquaredInterFrameDelay = positiveDelta(stats.totalSquaredInterFrameDelay, this.totalSquaredInterFrameDelay);

		// The first two moments of the gap between the frames rendered in this
		// interval. `totalInterFrameDelay` and its squared counterpart are sums the
		// browser accumulates one frame at a time, so the mean and the spread they
		// give describe every frame in the interval rather than the instant the
		// collection happened to land on.
		if (
			this.deltaTotalInterFrameDelay !== undefined &&
			this.deltaTotalSquaredInterFrameDelay !== undefined &&
			1 < (this.deltaFramesDecoded ?? 0)
		) {
			const frames = this.deltaFramesDecoded as number;
			const mean = this.deltaTotalInterFrameDelay / frames;
			// Clamped: the two sums are floats accumulated independently, so a
			// perfectly even stream can land a hair below zero here.
			const variance = Math.max(0, this.deltaTotalSquaredInterFrameDelay / frames - mean * mean);

			this.avgInterFrameDelayInMs = mean * 1000;
			this.interFrameDelayVariation = 0 < mean ? Math.sqrt(variance) / mean : undefined;
		} else {
			this.avgInterFrameDelayInMs = undefined;
			this.interFrameDelayVariation = undefined;
		}
		this.deltaPliCount = positiveDelta(stats.pliCount, this.pliCount);
		this.deltaFirCount = positiveDelta(stats.firCount, this.firCount);
		this.deltaNackCount = positiveDelta(stats.nackCount, this.nackCount);
		this.deltaRetransmittedBytesReceived = positiveDelta(stats.retransmittedBytesReceived, this.retransmittedBytesReceived);
		this.deltaRetransmittedPacketsReceived = positiveDelta(stats.retransmittedPacketsReceived, this.retransmittedPacketsReceived);

		this.retransmissionRatio = this.deltaRetransmittedBytesReceived !== undefined && 0 < (this.deltaBytesReceived ?? 0)
			? Math.min(1, this.deltaRetransmittedBytesReceived / (this.deltaBytesReceived as number))
			: undefined;

		this.avgJitterBufferDelayInMs = 0 < (this.deltaJitterBufferEmittedCount ?? 0) && this.deltaJitterBufferDelay !== undefined
			? (this.deltaJitterBufferDelay / (this.deltaJitterBufferEmittedCount as number)) * 1000
			: undefined;
		this.deltaJitterBufferTargetDelay = positiveDelta(stats.jitterBufferTargetDelay, this.jitterBufferTargetDelay);
		this.jitterBufferTargetDelayInMs = 0 < (this.deltaJitterBufferEmittedCount ?? 0) && this.deltaJitterBufferTargetDelay !== undefined
			? (this.deltaJitterBufferTargetDelay / (this.deltaJitterBufferEmittedCount as number)) * 1000
			: undefined;

		// ---- video: decode cost and recovery pressure ----
		this.decodeTimePerFrameInMs = 0 < (this.deltaFramesDecoded ?? 0) && this.deltaTotalDecodeTime !== undefined
			? (this.deltaTotalDecodeTime / (this.deltaFramesDecoded as number)) * 1000 : undefined;
		this.dropRatio = 0 < (this.deltaFramesReceived ?? 0) && this.deltaFramesDropped !== undefined
			? this.deltaFramesDropped / (this.deltaFramesReceived as number) : undefined;
		this.renderRatio = 0 < (this.deltaFramesDecoded ?? 0) && this.deltaFramesRendered !== undefined
			? this.deltaFramesRendered / (this.deltaFramesDecoded as number) : undefined;
		this.keyFrameRate = this.deltaKeyFramesDecoded !== undefined ? this.deltaKeyFramesDecoded / elapsedInSec : undefined;
		this.pliRate = this.deltaPliCount !== undefined ? this.deltaPliCount / elapsedInSec : undefined;
		this.firRate = this.deltaFirCount !== undefined ? this.deltaFirCount / elapsedInSec : undefined;
		this.nackRate = this.deltaNackCount !== undefined ? this.deltaNackCount / elapsedInSec : undefined;
		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;

		this._updateStats(stats);

		if (this.framesPerSecond) {
			this.lastNFramesPerSec.push(this.framesPerSecond);
			if (this.lastNFramesPerSec.length > 10) {
				this.lastNFramesPerSec.shift();

			}

			const avgFramesPerSec = this.lastNFramesPerSec.reduce((acc, fps) => acc + fps, 0) / this.lastNFramesPerSec.length;
			const avgDiff = this.lastNFramesPerSec.reduce((acc, fps) => acc + Math.abs(fps - avgFramesPerSec), 0) / this.lastNFramesPerSec.length

			this.avgFramesPerSec = avgFramesPerSec;
			this.fpsVolatility = avgDiff / avgFramesPerSec;

			if (this.bitrate && this.frameWidth && this.frameHeight) {
				this.bitPerPixel = this.bitrate / (this.frameWidth * this.frameHeight * this.framesPerSecond);
			}
		}

		if (this.packetsReceived !== undefined && this.packetsLost !== undefined) {
			this.totalFractionLost = 0 < this.packetsReceived && 0 < this.packetsLost
				? (this.packetsLost) / (this.packetsLost + this.packetsReceived) : 0.0;
		}
		if (this.deltaPacketsReceived !== undefined && this.deltaPacketsLost !== undefined) {
			this.deltaFractionLost = 0 < this.deltaPacketsReceived && 0 < this.deltaPacketsLost
				? (this.deltaPacketsLost) / (this.deltaPacketsLost + this.deltaPacketsReceived) : 0.0;
		}
		if (this.framesPerSecond !== undefined) {
			this.ewmaFps = this.ewmaFps ? 0.9 * this.ewmaFps + 0.1 * this.framesPerSecond : this.framesPerSecond;
		}
	}

	public getRemoteOutboundRtp(): RemoteOutboundRtpMonitor | undefined {
		return this._peerConnection.mappedRemoteOutboundRtpMonitors.get(this.ssrc);
	}

	public getIceTransport() {
		return this._peerConnection.mappedIceTransportMonitors.get(this.transportId ?? '');
	}

	public getSelectedCandidatePair() {
		return this.getIceTransport()?.getSelectedCandidatePair();
	}

	public getCodec() {
		return this._peerConnection.mappedCodecMonitors.get(this.codecId ?? '');
	}

	public getMediaPlayout() {
		return this._peerConnection.mappedMediaPlayoutMonitors.get(this.playoutId ?? '');
	}

	public getTrack() {
		return this._peerConnection.mappedInboundTracks.get(this.trackIdentifier);
	}

	public createSample(): InboundRtpStats {
		return {
			timestamp: this.timestamp,
			id: this.id,
			ssrc: this.ssrc,
			kind: this.kind,
			trackIdentifier: this.trackIdentifier,
			transportId: this.transportId,
			codecId: this.codecId,
			packetsReceived: this.packetsReceived,
			packetsReceivedWithEct1: this.packetsReceivedWithEct1,
			packetsReceivedWithCe: this.packetsReceivedWithCe,
			packetsReportedAsLost: this.packetsReportedAsLost,
			packetsReportedAsLostButRecovered: this.packetsReportedAsLostButRecovered,
			packetsLost: this.packetsLost,
			jitter: this.jitter,
			mid: this.mid,
			remoteId: this.remoteId,
			framesDecoded: this.framesDecoded,
			keyFramesDecoded: this.keyFramesDecoded,
			framesRendered: this.framesRendered,
			framesDropped: this.framesDropped,
			frameWidth: this.frameWidth,
			frameHeight: this.frameHeight,
			framesPerSecond: this.framesPerSecond,
			qpSum: this.qpSum,
			totalDecodeTime: this.totalDecodeTime,
			totalInterFrameDelay: this.totalInterFrameDelay,
			totalSquaredInterFrameDelay: this.totalSquaredInterFrameDelay,
			pauseCount: this.pauseCount,
			totalPausesDuration: this.totalPausesDuration,
			freezeCount: this.freezeCount,
			totalFreezesDuration: this.totalFreezesDuration,
			lastPacketReceivedTimestamp: this.lastPacketReceivedTimestamp,
			headerBytesReceived: this.headerBytesReceived,
			packetsDiscarded: this.packetsDiscarded,
			fecBytesReceived: this.fecBytesReceived,
			fecPacketsReceived: this.fecPacketsReceived,
			fecPacketsDiscarded: this.fecPacketsDiscarded,
			bytesReceived: this.bytesReceived,
			nackCount: this.nackCount,
			firCount: this.firCount,
			pliCount: this.pliCount,
			totalProcessingDelay: this.totalProcessingDelay,
			estimatedPlayoutTimestamp: this.estimatedPlayoutTimestamp,
			jitterBufferDelay: this.jitterBufferDelay,
			jitterBufferTargetDelay: this.jitterBufferTargetDelay,
			jitterBufferEmittedCount: this.jitterBufferEmittedCount,
			jitterBufferMinimumDelay: this.jitterBufferMinimumDelay,
			totalSamplesReceived: this.totalSamplesReceived,
			concealedSamples: this.concealedSamples,
			silentConcealedSamples: this.silentConcealedSamples,
			concealmentEvents: this.concealmentEvents,
			insertedSamplesForDeceleration: this.insertedSamplesForDeceleration,
			removedSamplesForAcceleration: this.removedSamplesForAcceleration,
			audioLevel: this.audioLevel,
			totalAudioEnergy: this.totalAudioEnergy,
			totalSamplesDuration: this.totalSamplesDuration,
			framesReceived: this.framesReceived,
			decoderImplementation: this.decoderImplementation,
			playoutId: this.playoutId,
			powerEfficientDecoder: this.powerEfficientDecoder,
			framesAssembledFromMultiplePackets: this.framesAssembledFromMultiplePackets,
			totalAssemblyTime: this.totalAssemblyTime,
			retransmittedPacketsReceived: this.retransmittedPacketsReceived,
			retransmittedBytesReceived: this.retransmittedBytesReceived,
			rtxSsrc: this.rtxSsrc,
			fecSsrc: this.fecSsrc,
			totalCorruptionProbability: this.totalCorruptionProbability,
			totalSquaredCorruptionProbability: this.totalSquaredCorruptionProbability,
			corruptionMeasurements: this.corruptionMeasurements,
			attachments: this.attachments,
		}
	}
}