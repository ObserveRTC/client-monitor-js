/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * The facts the two capacity detectors read, derived on the connection so that a
 * detector only has to compare a number with a threshold.
 *
 * Every one of them is about a distinction the old detector did not make.
 * `totalAvailableOutgoingBitrate` is `undefined` where the browser computed no
 * estimate, because the specification says the field "must not exist" for a pair
 * that never sent — where summing with `?? 0` could not tell that from an
 * estimate of zero. `avgPacketSendDelayInMs` divides by the counter the
 * specification pairs it with, because read raw the sum is cumulative and only
 * ever climbs, and per collection it scales with how much was sent.
 *
 * The rolling maxima the two capacity detectors measure a collapse against are
 * *not* here: each detector keeps its own window, because that is a baseline for
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
	 * drove the uplink detector's headroom unboundedly negative and pinned
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
		/**
		 * Deprecated, and deliberately not derived from the per-direction flags: it is the whole
		 * connection verdict of `CongestionDetector` and moves only when that detector says so, so
		 * removing it later cannot disturb the two that replaced it.
		 */
		it('is its own field, untouched by the per-direction flags', () => {
			expect(pc.congested).toBe(false);

			pc.uplinkCongested = true;
			pc.downlinkCongested = true;

			expect(pc.congested).toBe(false);

			pc.congested = true;
			expect(pc.congested).toBe(true);
		});
	});

	describe('totalAvailableOutgoingBitrate', () => {
		it('is undefined where the selected pair reported no estimate', () => {
			collect(1000);
			collect(2000);

			// Not zero: an absent estimate and an estimate of zero are different
			// claims, and only one of them says the path has no room.
			expect(pc.totalAvailableOutgoingBitrate).toBeUndefined();
		});

		it('is the estimate where there is one', () => {
			collect(1000, { availableOutgoingBitrate: 1_161_000 });

			expect(pc.totalAvailableOutgoingBitrate).toBe(1_161_000);
		});

		it('goes back to undefined when the estimate disappears', () => {
			collect(1000, { availableOutgoingBitrate: 1_161_000 });
			collect(2000);

			expect(pc.totalAvailableOutgoingBitrate).toBeUndefined();
		});
	});

	describe('avgPacketSendDelayInMs', () => {
		it('is the pacer queue time per packet, from the two deltas the spec pairs', () => {
			// totalPacketSendDelay is cumulative and in seconds: 0.6s over 300 packets
			// is 2ms of queue per packet.
			collect(1000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1000, totalPacketSendDelay: 1 } ] });
			collect(2000, { outboundRtps: [ { id: 'out-1', ssrc: 1, packetsSent: 1300, totalPacketSendDelay: 1.6 } ] });

			expect(pc.avgPacketSendDelayInMs).toBeCloseTo(2);
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
			// standing as though it described this collection. The baseline that
			// legitimately remembers lives in the detector, not here.
			expect(pc.avgPacketSendDelayInMs).toBeUndefined();
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

});
