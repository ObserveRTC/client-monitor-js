/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundRtpMonitor } from "../../src/monitors/InboundRtpMonitor";
import { OutboundRtpMonitor } from "../../src/monitors/OutboundRtpMonitor";
import { RemoteInboundRtpMonitor } from "../../src/monitors/RemoteInboundRtpMonitor";
import { MediaSourceMonitor } from "../../src/monitors/MediaSourceMonitor";
import { MediaPlayoutMonitor } from "../../src/monitors/MediaPlayoutMonitor";

/**
 * A peer connection stub carrying only the lookup maps and the config the
 * monitors touch, so these specs exercise the real monitor classes rather than
 * a reimplementation of their arithmetic.
 */
function mockPeerConnection() {
	return {
		mappedCodecMonitors: new Map(),
		mappedMediaSourceMonitors: new Map(),
		mappedOutboundRtpMonitors: new Map(),
		mappedRemoteInboundRtpMonitors: new Map(),
		mappedOutboundTracks: new Map(),
		outboundRtps: [],
		parent: {
			config: { syntheticSamplesDetector: null },
		},
	} as any;
}

function inbound(kind: 'audio' | 'video', first: Record<string, unknown>) {
	return new InboundRtpMonitor(mockPeerConnection(), {
		id: 'in-1',
		timestamp: 1000,
		ssrc: 1,
		kind,
		trackIdentifier: 'track-1',
		...first,
	} as any);
}

describe('InboundRtpMonitor derived fields', () => {
	// The guard that every delta-based detector rests on: on SSRC reuse or a
	// stats-object replacement the counters restart, and an unguarded
	// subtraction would hand every downstream rate a negative number.
	it('treats a counter going backwards as no progress', () => {
		const monitor = inbound('video', {
			packetsReceived: 1000,
			packetsLost: 50,
			bytesReceived: 100000,
			framesDecoded: 300,
			framesReceived: 310,
			framesDropped: 5,
			totalDecodeTime: 3,
		});

		monitor.accept({
			id: 'in-1',
			timestamp: 3000,
			ssrc: 1,
			kind: 'video',
			trackIdentifier: 'track-1',
			packetsReceived: 10,
			packetsLost: 0,
			bytesReceived: 500,
			framesDecoded: 2,
			framesReceived: 3,
			framesDropped: 0,
			totalDecodeTime: 0.01,
		} as any);

		expect(monitor.deltaPacketsReceived).toBe(0);
		expect(monitor.deltaPacketsLost).toBe(0);
		expect(monitor.deltaBytesReceived).toBe(0);
		expect(monitor.deltaFramesDecoded).toBe(0);
		expect(monitor.deltaFramesDropped).toBe(0);
		expect(monitor.bitrate).toBe(0);
	});

	// Silence inflates `concealedSamples`; without the subtraction every quiet
	// call would read as badly degraded.
	it('excludes silent concealment from the concealment rate', () => {
		const monitor = inbound('audio', {
			totalSamplesReceived: 0,
			concealedSamples: 0,
			silentConcealedSamples: 0,
			concealmentEvents: 0,
		});

		monitor.accept({
			id: 'in-1',
			timestamp: 3000,
			ssrc: 1,
			kind: 'audio',
			trackIdentifier: 'track-1',
			totalSamplesReceived: 96000,
			concealedSamples: 10000,
			silentConcealedSamples: 8000,
			concealmentEvents: 4,
		} as any);

		expect(monitor.concealmentRate).toBeCloseTo(2000 / 96000);
		expect(monitor.concealmentEventRate).toBeCloseTo(2);
	});

	it('derives jitter buffer delay per emitted sample', () => {
		const monitor = inbound('audio', {
			jitterBufferDelay: 0,
			jitterBufferEmittedCount: 0,
			jitterBufferTargetDelay: 0,
		});

		monitor.accept({
			id: 'in-1',
			timestamp: 3000,
			ssrc: 1,
			kind: 'audio',
			trackIdentifier: 'track-1',
			// 96000 samples that each waited 0.1s in the buffer.
			jitterBufferDelay: 9600,
			jitterBufferEmittedCount: 96000,
			jitterBufferTargetDelay: 19200,
		} as any);

		expect(monitor.avgJitterBufferDelayInMs).toBeCloseTo(100);
		expect(monitor.jitterBufferTargetDelayInMs).toBeCloseTo(200);
	});

	it('derives decode cost and recovery rates', () => {
		const monitor = inbound('video', {
			framesDecoded: 0,
			framesReceived: 0,
			framesRendered: 0,
			framesDropped: 0,
			keyFramesDecoded: 0,
			totalDecodeTime: 0,
			pliCount: 0,
			nackCount: 0,
		});

		monitor.accept({
			id: 'in-1',
			timestamp: 3000,
			ssrc: 1,
			kind: 'video',
			trackIdentifier: 'track-1',
			framesDecoded: 60,
			framesReceived: 66,
			framesRendered: 54,
			framesDropped: 6,
			keyFramesDecoded: 2,
			totalDecodeTime: 0.6,
			pliCount: 4,
			nackCount: 10,
		} as any);

		expect(monitor.decodeTimePerFrameInMs).toBeCloseTo(10);
		expect(monitor.dropRatio).toBeCloseTo(6 / 66);
		expect(monitor.renderRatio).toBeCloseTo(54 / 60);
		expect(monitor.keyFrameRate).toBeCloseTo(1);
		expect(monitor.pliRate).toBeCloseTo(2);
		expect(monitor.nackRate).toBeCloseTo(5);
	});
});

describe('OutboundRtpMonitor derived fields', () => {
	function outbound(first: Record<string, unknown>) {
		return new OutboundRtpMonitor(mockPeerConnection(), {
			id: 'out-1',
			timestamp: 1000,
			ssrc: 2,
			kind: 'video',
			...first,
		} as any);
	}

	it('treats a counter going backwards as no progress', () => {
		const monitor = outbound({ packetsSent: 5000, bytesSent: 500000, framesEncoded: 300 });

		monitor.accept({
			id: 'out-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			packetsSent: 10,
			bytesSent: 900,
			framesEncoded: 1,
		} as any);

		expect(monitor.deltaPacketsSent).toBe(0);
		expect(monitor.deltaBytesSent).toBe(0);
		expect(monitor.deltaFramesEncoded).toBe(0);
	});

	it('derives encode cost per frame and the retransmission share', () => {
		const monitor = outbound({
			bytesSent: 0,
			headerBytesSent: 0,
			retransmittedBytesSent: 0,
			packetsSent: 0,
			retransmittedPacketsSent: 0,
			framesEncoded: 0,
			totalEncodeTime: 0,
			qpSum: 0,
		});

		monitor.accept({
			id: 'out-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			bytesSent: 100000,
			headerBytesSent: 10000,
			retransmittedBytesSent: 5000,
			packetsSent: 100,
			retransmittedPacketsSent: 5,
			framesEncoded: 60,
			totalEncodeTime: 0.9,
			qpSum: 1800,
		} as any);

		expect(monitor.encodeTimePerFrameInMs).toBeCloseTo(15);
		expect(monitor.retransmissionRatio).toBeCloseTo(0.05);
		expect(monitor.retransmittedPacketRatio).toBeCloseTo(0.05);
		expect(monitor.avgQpPerFrame).toBeCloseTo(30);
	});

	// The raw accumulators say what happened since the call started; the shares
	// say what happened now, which is the only thing a threshold can use.
	it('derives quality limitation shares from the interval, not the total', () => {
		const monitor = outbound({
			qualityLimitationDurations: { none: 100, cpu: 10, bandwidth: 5, other: 0 },
		});

		monitor.accept({
			id: 'out-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			qualityLimitationDurations: { none: 100.5, cpu: 11.5, bandwidth: 5, other: 0 },
		} as any);

		// 1.5s of the 2s of encoder time accounted for in this interval was CPU
		// limited, even though the lifetime totals are dominated by `none`.
		expect(monitor.qualityLimitationDurationShares?.cpu).toBeCloseTo(0.75);
		expect(monitor.qualityLimitationDurationShares?.none).toBeCloseTo(0.25);
		expect(monitor.qualityLimitationDurationShares?.bandwidth).toBe(0);
	});

	it('reports no shares when the encoder made no progress at all', () => {
		const monitor = outbound({
			qualityLimitationDurations: { none: 100, cpu: 10, bandwidth: 5, other: 0 },
		});

		monitor.accept({
			id: 'out-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			qualityLimitationDurations: { none: 100, cpu: 10, bandwidth: 5, other: 0 },
		} as any);

		expect(monitor.qualityLimitationDurationShares).toBeUndefined();
	});
});

describe('RemoteInboundRtpMonitor derived fields', () => {
	// `packetsLost` legitimately decreases when a late packet arrives, so the
	// guard is not merely defensive here.
	it('does not report a negative loss delta', () => {
		const monitor = new RemoteInboundRtpMonitor(mockPeerConnection(), {
			id: 'rin-1',
			timestamp: 1000,
			ssrc: 2,
			kind: 'video',
			packetsReceived: 1000,
			packetsLost: 20,
		} as any);

		monitor.accept({
			id: 'rin-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			packetsReceived: 1100,
			packetsLost: 18,
		} as any);

		expect(monitor.deltaPacketsLost).toBe(0);
		expect(monitor.deltaPacketsReceived).toBe(100);
	});

	it('averages the round trip over the measurements taken in the interval', () => {
		const monitor = new RemoteInboundRtpMonitor(mockPeerConnection(), {
			id: 'rin-1',
			timestamp: 1000,
			ssrc: 2,
			kind: 'video',
			totalRoundTripTime: 1,
			roundTripTimeMeasurements: 10,
		} as any);

		monitor.accept({
			id: 'rin-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			totalRoundTripTime: 1.6,
			roundTripTimeMeasurements: 14,
		} as any);

		expect(monitor.avgRoundTripTimeInSec).toBeCloseTo(0.15);
	});

	it('reports no average when no new measurement arrived', () => {
		const monitor = new RemoteInboundRtpMonitor(mockPeerConnection(), {
			id: 'rin-1',
			timestamp: 1000,
			ssrc: 2,
			kind: 'video',
			totalRoundTripTime: 1,
			roundTripTimeMeasurements: 10,
		} as any);

		monitor.accept({
			id: 'rin-1',
			timestamp: 3000,
			ssrc: 2,
			kind: 'video',
			totalRoundTripTime: 1,
			roundTripTimeMeasurements: 10,
		} as any);

		expect(monitor.avgRoundTripTimeInSec).toBeUndefined();
	});
});

describe('MediaSourceMonitor derived fields', () => {
	it('derives the source frame rate and RMS level', () => {
		const monitor = new MediaSourceMonitor(mockPeerConnection(), {
			id: 'src-1',
			timestamp: 1000,
			kind: 'audio',
			frames: 100,
			totalAudioEnergy: 1,
			totalSamplesDuration: 10,
		} as any);

		monitor.accept({
			id: 'src-1',
			timestamp: 3000,
			kind: 'audio',
			frames: 160,
			// 0.04 energy over 1s of samples => RMS 0.2
			totalAudioEnergy: 1.04,
			totalSamplesDuration: 11,
		} as any);

		expect(monitor.deltaFrames).toBe(60);
		expect(monitor.sourceFps).toBeCloseTo(30);
		expect(monitor.rmsAudioLevel).toBeCloseTo(0.2);
	});
});

describe('MediaPlayoutMonitor derived fields', () => {
	it('derives playout delay per sample and the synthesized share', () => {
		const monitor = new MediaPlayoutMonitor(mockPeerConnection(), {
			id: 'play-1',
			timestamp: 1000,
			kind: 'audio',
			totalPlayoutDelay: 0,
			totalSamplesCount: 0,
			totalSamplesDuration: 0,
			synthesizedSamplesDuration: 0,
		} as any);

		monitor.accept({
			id: 'play-1',
			timestamp: 3000,
			kind: 'audio',
			// 96000 samples that each waited 50ms.
			totalPlayoutDelay: 4800,
			totalSamplesCount: 96000,
			totalSamplesDuration: 2,
			synthesizedSamplesDuration: 0.1,
		} as any);

		expect(monitor.playoutDelayPerSampleInMs).toBeCloseTo(50);
		expect(monitor.synthesizedSamplesRatio).toBeCloseTo(0.05);
	});
});
