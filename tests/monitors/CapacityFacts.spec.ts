/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * The facts the two capacity detectors read, derived on the connection so that a
 * detector only has to compare a number with a threshold.
 *
 * Every one of them is about a distinction the old detector did not make.
 * `availableOutgoingBitrate` is `undefined` where the browser computed no
 * estimate, because the specification says the field "must not exist" for a pair
 * that never sent — and `totalAvailableOutgoingBitrate` beside it, which sums
 * with `?? 0`, cannot tell that from an estimate of zero. Both queue means divide
 * by the counter the specification pairs them with, because read raw they are
 * cumulative and only ever climb.
 *
 * The rolling maxima the two capacity detectors measure a collapse against are
 * *not* here: each detector keeps its own window, because that is a yardstick for
 * a judgement rather than a fact about the connection.
 */
describe('peer connection capacity facts', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pc);
	});

	afterEach(() => {
		monitor.close();
	});

	/** One collection: a transport, its selected pair, and whatever streams are named. */
	const collect = (timestamp: number, options: {
		availableOutgoingBitrate?: number,
		outboundRtps?: Record<string, unknown>[],
		inboundRtps?: Record<string, unknown>[],
		dataChannels?: Record<string, unknown>[],
	} = {}) => {
		const pair: Record<string, unknown> = {
			type: 'candidate-pair', id: 'pair-1', timestamp, transportId: 'transport-1',
			localCandidateId: 'local-1', remoteCandidateId: 'remote-1', state: 'succeeded', nominated: true,
		};

		if (options.availableOutgoingBitrate !== undefined) {
			pair.availableOutgoingBitrate = options.availableOutgoingBitrate;
		}

		pc.accept([
			{ type: 'transport', id: 'transport-1', timestamp, selectedCandidatePairId: 'pair-1' },
			pair,
			...(options.outboundRtps ?? []).map((outboundRtp) => ({
				type: 'outbound-rtp', timestamp, kind: 'video', transportId: 'transport-1', ...outboundRtp,
			})),
			...(options.inboundRtps ?? []).map((inboundRtp) => ({
				type: 'inbound-rtp', timestamp, kind: 'video', transportId: 'transport-1', ...inboundRtp,
			})),
			...(options.dataChannels ?? []).map((dataChannel) => ({
				type: 'data-channel', timestamp, label: 'signaling', ...dataChannel,
			})),
		] as any);
	};

	describe('statsClockTime', () => {
		it('accumulates the measured gaps between collections', () => {
			// The first collection has no previous timestamp to measure against, so
			// the clock starts moving on the second.
			collect(1000);
			expect(pc.statsClockTime).toBe(0);

			collect(2000);
			expect(pc.statsClockTime).toBe(1000);

			// Four seconds in one collection — a backgrounded tab, a saturated main
			// thread. The clock credits what it cost rather than one nominal period,
			// which is what makes a window measured on it honest.
			collect(6000);
			expect(pc.statsClockTime).toBe(5000);
		});
	});

	/**
	 * Every per-collection accumulator on the connection has to be zeroed before the
	 * round that fills it, or it stops being a rate. The data channel pair were the
	 * ones that were not, and because `sendingBitrate` sums them in, an hour-long
	 * call with an active signalling channel read as sending tens of megabits — which
	 * drove `outgoingBitrateHeadroom` unboundedly negative and pinned
	 * `UplinkCongestionDetector` on for the rest of the call.
	 */
	describe('data channel bitrates', () => {
		it('reports a rate rather than a running total', () => {
			const channel = (bytes: number) => [ { id: 'dc-1', bytesSent: bytes, bytesReceived: bytes } ];

			collect(1000, { dataChannels: channel(0) });
			collect(2000, { dataChannels: channel(1_000) });

			expect(pc.dataChannelSendingBitrate).toBe(8_000);
			expect(pc.dataChannelReceivingBitrate).toBe(8_000);

			// The same 1000 bytes a second, ten collections later. A total would read
			// eleven times this; a rate reads the same.
			for (let i = 2; i <= 11; ++i) collect(1000 * (i + 1), { dataChannels: channel(1_000 * i) });

			expect(pc.dataChannelSendingBitrate).toBe(8_000);
			expect(pc.dataChannelReceivingBitrate).toBe(8_000);
		});

		it('leaves sendingBitrate and receivingBitrate as rates too', () => {
			const channel = (bytes: number) => [ { id: 'dc-1', bytesSent: bytes, bytesReceived: bytes } ];

			for (let i = 0; i <= 20; ++i) collect(1000 * (i + 1), { dataChannels: channel(1_000 * i) });

			expect(pc.sendingBitrate).toBe(8_000);
			expect(pc.receivingBitrate).toBe(8_000);
		});
	});

	describe('congested', () => {
		it('is either direction, and neither by default', () => {
			expect(pc.congested).toBe(false);

			pc.downlinkCongested = true;
			expect(pc.congested).toBe(true);

			pc.downlinkCongested = false;
			pc.uplinkCongested = true;
			expect(pc.congested).toBe(true);

			pc.uplinkCongested = false;
			expect(pc.congested).toBe(false);
		});
	});

	describe('availableOutgoingBitrate', () => {
		it('is undefined where the selected pair reported no estimate', () => {
			collect(1000);
			collect(2000);

			expect(pc.availableOutgoingBitrate).toBeUndefined();
			// The 4.9.0 reading of the same absence, kept for backwards compatibility
			// and unable to say so.
			expect(pc.totalAvailableOutgoingBitrate).toBe(0);
		});

		it('is the estimate where there is one', () => {
			collect(1000, { availableOutgoingBitrate: 1_161_000 });

			expect(pc.availableOutgoingBitrate).toBe(1_161_000);
		});

		it('goes back to undefined when the estimate disappears', () => {
			collect(1000, { availableOutgoingBitrate: 1_161_000 });
			collect(2000);

			expect(pc.availableOutgoingBitrate).toBeUndefined();
		});
	});

	describe('outgoingBitrateHeadroom', () => {
		const sending = (packetsSent: number, bytesSent: number) =>
			({ id: 'out-1', ssrc: 1, packetsSent, bytesSent });

		it('is what the path offers minus what is being put on it', () => {
			collect(1000, { availableOutgoingBitrate: 1_161_000, outboundRtps: [ sending(0, 0) ] });
			// 125_000 bytes over one second is a megabit on the wire.
			collect(2000, { availableOutgoingBitrate: 1_161_000, outboundRtps: [ sending(300, 125_000) ] });

			expect(pc.sendingBitrate).toBe(1_000_000);
			expect(pc.outgoingBitrateHeadroom).toBe(161_000);
		});

		it('goes negative when the estimate falls below what is still going out', () => {
			// The moment a path narrows: the estimate drops immediately and the
			// encoder takes a beat to follow it down. That inversion is the signal
			// `UplinkCongestionDetector` is built on.
			collect(1000, { availableOutgoingBitrate: 1_161_000, outboundRtps: [ sending(0, 0) ] });
			collect(2000, { availableOutgoingBitrate: 1_161_000, outboundRtps: [ sending(300, 125_000) ] });

			expect(pc.outgoingBitrateHeadroom).toBe(161_000);

			// Same megabit on the wire, a tenth of the estimate.
			collect(3000, { availableOutgoingBitrate: 100_000, outboundRtps: [ sending(600, 250_000) ] });

			expect(pc.outgoingBitrateHeadroom).toBe(-900_000);
		});

		it('smooths towards the level the call has been running at', () => {
			collect(1000, { availableOutgoingBitrate: 1_161_000, outboundRtps: [ sending(0, 0) ] });
			collect(2000, { availableOutgoingBitrate: 1_161_000, outboundRtps: [ sending(300, 125_000) ] });

			const seeded = pc.ewmaOutgoingBitrateHeadroom as number;

			collect(3000, { availableOutgoingBitrate: 100_000, outboundRtps: [ sending(600, 250_000) ] });

			// One collection moves an EWMA by a tenth of the gap, so the smoothed
			// level lags the collapse rather than following it — which is what makes
			// the drop below it measurable at all.
			expect(pc.ewmaOutgoingBitrateHeadroom).toBeCloseTo((-900_000 * 0.1) + (seeded * 0.9));
			expect(pc.ewmaOutgoingBitrateHeadroom as number).toBeGreaterThan(-900_000);
		});

		it('is undefined where there is no estimate to subtract from', () => {
			collect(1000, { outboundRtps: [ sending(0, 0) ] });
			collect(2000, { outboundRtps: [ sending(300, 125_000) ] });

			expect(pc.outgoingBitrateHeadroom).toBeUndefined();
			expect(pc.ewmaOutgoingBitrateHeadroom).toBeUndefined();
		});
	});

	describe('avgPacketSendDelayInMs', () => {
		it('is the pacer queue time per packet, from the two deltas the spec pairs', () => {
			// totalPacketSendDelay is cumulative and in seconds: 0.6s over 300 packets
			// is 2ms of queue per packet.
			collect(1000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1000, totalPacketSendDelay: 1 } ] });
			collect(2000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1300, totalPacketSendDelay: 1.6 } ] });

			expect(pc.avgPacketSendDelayInMs).toBeCloseTo(2);
			expect(pc.estimatedMedianPacketSendDelayInMs).toBeCloseTo(2);
		});

		it('weights the streams by packets rather than averaging the streams', () => {
			collect(1000, { outboundRtps: [
				{ id: 'out-1', ssrc: 1, packetsSent: 0, totalPacketSendDelay: 0 },
				{ id: 'out-2', ssrc: 2, packetsSent: 0, totalPacketSendDelay: 0 },
			] });
			// One stream sent three packets and queued them for 30ms each; the other
			// sent three hundred at 2ms. The mean a detector wants is the mean over
			// packets, which is close to 2ms — not the 16ms mean over streams.
			collect(2000, { outboundRtps: [
				{ id: 'out-1', ssrc: 1, packetsSent: 3, totalPacketSendDelay: 0.09 },
				{ id: 'out-2', ssrc: 2, packetsSent: 300, totalPacketSendDelay: 0.6 },
			] });

			expect(pc.avgPacketSendDelayInMs).toBeCloseTo(690 / 303);
		});

		it('describes this collection alone, not the call so far', () => {
			// The sums are accumulated in the collection loop, so they have to be
			// cleared with the other per-tick deltas: a mean that kept adding would
			// drift towards the whole call's average and stop reporting now.
			collect(1000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1000, totalPacketSendDelay: 1 } ] });
			collect(2000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1300, totalPacketSendDelay: 1.6 } ] });
			expect(pc.avgPacketSendDelayInMs).toBeCloseTo(2);

			// 3s of queue over 300 packets: 10ms each, on its own.
			collect(3000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1600, totalPacketSendDelay: 4.6 } ] });

			expect(pc.avgPacketSendDelayInMs).toBeCloseTo(10);
		});

		it('is undefined on a collection where nothing was sent', () => {
			collect(1000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1000, totalPacketSendDelay: 1 } ] });
			collect(2000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1300, totalPacketSendDelay: 1.6 } ] });
			collect(3000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1300, totalPacketSendDelay: 1.6 } ] });

			// No packets, so no queue time to report — rather than the previous answer
			// standing as though it described this collection.
			expect(pc.avgPacketSendDelayInMs).toBeUndefined();
			// The smoothed level is the one thing that legitimately remembers.
			expect(pc.estimatedMedianPacketSendDelayInMs).toBeCloseTo(2);
		});
	});

	describe('qualityLimitationReason', () => {
		const sending = (packetsSent: number, qualityLimitationReason?: string, id = 'out-1', ssrc = 1) =>
			({ id, ssrc, packetsSent, qualityLimitationReason });

		it('is the most limiting reason the sending streams reported', () => {
			// Simulcast layers disagree routinely. The specification names the
			// priority order: "bandwidth", "cpu", "other".
			collect(1000, { outboundRtps: [ sending(0, 'none'), sending(0, 'none', 'out-2', 2) ] });
			collect(2000, { outboundRtps: [ sending(300, 'none'), sending(300, 'bandwidth', 'out-2', 2) ] });

			expect(pc.qualityLimitationReason).toBe('bandwidth');
		});

		it('does not let a stream that sent nothing cast a vote', () => {
			// An inactive simulcast layer and a paused sender both keep reporting
			// whatever limited them when they stopped.
			collect(1000, { outboundRtps: [ sending(0, 'none'), sending(0, 'bandwidth', 'out-2', 2) ] });
			collect(2000, { outboundRtps: [ sending(300, 'none'), sending(0, 'bandwidth', 'out-2', 2) ] });

			expect(pc.qualityLimitationReason).toBe('none');
		});

		it('is undefined where no sending stream reported one', () => {
			// Audio-only: the field "must not exist for audio".
			collect(1000, { outboundRtps: [ sending(0) ] });
			collect(2000, { outboundRtps: [ sending(300) ] });

			expect(pc.qualityLimitationReason).toBeUndefined();
		});

		it('does not carry a verdict forward into a collection that sent nothing', () => {
			collect(1000, { outboundRtps: [ sending(0, 'bandwidth') ] });
			collect(2000, { outboundRtps: [ sending(300, 'bandwidth') ] });
			expect(pc.qualityLimitationReason).toBe('bandwidth');

			collect(3000, { outboundRtps: [ sending(300, 'bandwidth') ] });

			expect(pc.qualityLimitationReason).toBeUndefined();
		});
	});

	describe('hasInboundVideo', () => {
		it('is true while a video stream is present, whatever it is delivering', () => {
			// Present and delivering nothing is a stream nobody can see, which is a
			// finding somewhere else — not an absence of one here.
			collect(1000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', bytesReceived: 1000 } ] });
			collect(2000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', bytesReceived: 1000 } ] });

			expect(pc.hasInboundVideo).toBe(true);
			expect(pc.receivingVideoBitrate).toBe(0);
		});

		it('is false on an audio-only connection', () => {
			collect(1000, { inboundRtps: [ { id: 'in-2', ssrc: 4, kind: 'audio', trackIdentifier: 't2' } ] });
			collect(2000, { inboundRtps: [ { id: 'in-2', ssrc: 4, kind: 'audio', trackIdentifier: 't2' } ] });

			expect(pc.hasInboundVideo).toBe(false);
		});

		it('goes back to false when the video stream goes away', () => {
			collect(1000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1' } ] });
			expect(pc.hasInboundVideo).toBe(true);

			collect(2000);

			expect(pc.hasInboundVideo).toBe(false);
		});
	});

	describe('avgInboundVideoJitterBufferDelayInMs', () => {
		it('is the per-frame delay, from the two counters the spec pairs', () => {
			// jitterBufferDelay is cumulative seconds; divided by the frames that left
			// the buffer it is how long each of them waited.
			collect(1000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1, jitterBufferEmittedCount: 100 } ] });
			collect(2000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1.6, jitterBufferEmittedCount: 130 } ] });

			expect(pc.avgInboundVideoJitterBufferDelayInMs).toBeCloseTo(20);
		});

		it('weights the streams by frames rather than averaging the streams', () => {
			// Simulcast, or two remote cameras: one stream emitted three frames that
			// waited 300ms each, the other three hundred that waited 20ms. The mean a
			// detector wants is the mean over frames, close to 22ms — not the 160ms
			// mean over streams.
			collect(1000, { inboundRtps: [
				{ id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 0, jitterBufferEmittedCount: 0 },
				{ id: 'in-2', ssrc: 4, trackIdentifier: 't2', jitterBufferDelay: 0, jitterBufferEmittedCount: 0 },
			] });
			collect(2000, { inboundRtps: [
				{ id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 0.9, jitterBufferEmittedCount: 3 },
				{ id: 'in-2', ssrc: 4, trackIdentifier: 't2', jitterBufferDelay: 6, jitterBufferEmittedCount: 300 },
			] });

			expect(pc.avgInboundVideoJitterBufferDelayInMs).toBeCloseTo(6900 / 303);
		});

		it('leaves audio out of it', () => {
			// NetEQ holds samples on a different scale entirely, and it has a detector
			// of its own. A mean over both describes neither.
			collect(1000, { inboundRtps: [
				{ id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1, jitterBufferEmittedCount: 100 },
				{ id: 'in-2', ssrc: 4, kind: 'audio', trackIdentifier: 't2', jitterBufferDelay: 10, jitterBufferEmittedCount: 48000 },
			] });
			collect(2000, { inboundRtps: [
				{ id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1.6, jitterBufferEmittedCount: 130 },
				{ id: 'in-2', ssrc: 4, kind: 'audio', trackIdentifier: 't2', jitterBufferDelay: 12.4, jitterBufferEmittedCount: 96000 },
			] });

			expect(pc.avgInboundVideoJitterBufferDelayInMs).toBeCloseTo(20);
		});

		it('describes this collection alone, not the call so far', () => {
			collect(1000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1, jitterBufferEmittedCount: 100 } ] });
			collect(2000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1.6, jitterBufferEmittedCount: 130 } ] });
			expect(pc.avgInboundVideoJitterBufferDelayInMs).toBeCloseTo(20);

			// The throttle bites: 9s of buffered time over 30 frames is 300ms each,
			// and the collection before it has nothing to do with that.
			collect(3000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 10.6, jitterBufferEmittedCount: 160 } ] });

			expect(pc.avgInboundVideoJitterBufferDelayInMs).toBeCloseTo(300);
		});

		it('is undefined on a collection where no frame left the buffer', () => {
			collect(1000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1, jitterBufferEmittedCount: 100 } ] });
			collect(2000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1.6, jitterBufferEmittedCount: 130 } ] });
			collect(3000, { inboundRtps: [ { id: 'in-1', ssrc: 3, trackIdentifier: 't1', jitterBufferDelay: 1.6, jitterBufferEmittedCount: 130 } ] });

			expect(pc.avgInboundVideoJitterBufferDelayInMs).toBeUndefined();
		});
	});
});
