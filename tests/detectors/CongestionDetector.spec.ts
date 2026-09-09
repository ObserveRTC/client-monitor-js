/* eslint-disable @typescript-eslint/no-explicit-any */
import { CongestionDetector } from "../../src/detectors/CongestionDetector";

/**
 * The deprecated whole-connection detector, kept so integrations built against the `congestion`
 * event and issue keep working. This pins the legacy contract as it was, so the class cannot drift
 * while it is still shipped.
 */
type Emitted = { name: string, payload: any };

function createHarness(sensitivity: 'low' | 'medium' | 'high' = 'medium') {
	const emitted: Emitted[] = [];
	const raised: { key: string, type: string, payload: any }[] = [];
	const resolved: { key: string, comment?: string }[] = [];

	const clientMonitor = {
		config: { congestionDetector: { sensitivity } },
		emit(name: string, payload: any) { emitted.push({ name, payload }); },
		raiseIssue(key: string, input: any) { raised.push({ key, type: input.type, payload: input.payload }); },
		resolveIssue(key: string, input: any) { resolved.push({ key, comment: input.comment }); },
	};

	const peerConnection: any = {
		peerConnectionId: 'pc-1',
		parent: clientMonitor,
		outboundRtps: [] as any[],
		congested: false,
		uplinkCongested: false,
		downlinkCongested: false,
		outboundFractionLost: 0,
		totalAvailableIncomingBitrate: 1_000_000,
		totalAvailableOutgoingBitrate: 800_000,
		receivingBitrate: 900_000,
		sendingBitrate: 700_000,
		avgRttInSec: 0.1,
		ewmaRttInSec: 0.1,
	};

	const detector = new CongestionDetector(peerConnection);

	return {
		detector, peerConnection, clientMonitor, emitted, raised, resolved,
		/** One collection. `bandwidthLimited` is the browser's own verdict on an outbound stream. */
		tick(options: { bandwidthLimited?: boolean } = {}) {
			peerConnection.outboundRtps = [
				{ qualityLimitationReason: options.bandwidthLimited ? 'bandwidth' : 'none' },
			];
			detector.update();
		},
		congestionEvents() { return emitted.filter(e => e.name === 'congestion'); },
	};
}

describe('CongestionDetector (deprecated)', () => {
	describe('the legacy contract', () => {
		it('raises the congestion issue and emits the congestion event together', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });

			expect(h.raised).toHaveLength(1);
			expect(h.raised[0].type).toBe('congestion');
			expect(h.congestionEvents()).toHaveLength(1);
		});

		it('emits the flat legacy payload, with no direction on it', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });

			const payload = h.congestionEvents()[0].payload;

			// What separates it from the uplink/downlink variants sharing this event.
			expect(payload.direction).toBeUndefined();
			expect(payload.peerConnectionMonitor).toBe(h.peerConnection);
			expect(payload.availableIncomingBitrate).toBe(1_000_000);
			expect(payload.availableOutgoingBitrate).toBe(800_000);
		});

		it('keys the issue on the peer connection', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });

			expect(h.raised[0].key).toBe('congestion-pc-pc-1');
		});

		it('sets `congested` and leaves the per-direction flags alone', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });

			expect(h.peerConnection.congested).toBe(true);
			expect(h.peerConnection.uplinkCongested).toBe(false);
			expect(h.peerConnection.downlinkCongested).toBe(false);
		});

		it('reports one episode, not one per collection', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });
			h.tick({ bandwidthLimited: true });
			h.tick({ bandwidthLimited: true });

			expect(h.raised).toHaveLength(1);
			expect(h.congestionEvents()).toHaveLength(1);
		});

		it('resolves when the connection stops being bandwidth limited', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });
			h.tick({ bandwidthLimited: false });

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe('congestion ended');
			expect(h.peerConnection.congested).toBe(false);
		});

		it('can report a second episode after the first ends', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });
			h.tick({ bandwidthLimited: false });
			h.tick({ bandwidthLimited: true });

			expect(h.raised).toHaveLength(2);
		});
	});

	/** The headroom that preceded the episode, which is what the payload's maxima are for. */
	describe('the before picture', () => {
		it('carries the peaks seen while the connection was healthy', () => {
			const h = createHarness('high');

			h.peerConnection.totalAvailableOutgoingBitrate = 2_000_000;
			h.peerConnection.sendingBitrate = 1_500_000;
			h.tick({ bandwidthLimited: false });

			h.peerConnection.totalAvailableOutgoingBitrate = 200_000;
			h.peerConnection.sendingBitrate = 150_000;
			h.tick({ bandwidthLimited: true });

			const payload = h.raised[0].payload;

			expect(payload.maxAvailableOutgoingBitrate).toBe(2_000_000);
			expect(payload.maxSendingBitrate).toBe(1_500_000);
			// And the collapsed figures at the moment it was declared.
			expect(payload.availableOutgoingBitrate).toBe(200_000);
		});

		it('measures each episode against the stretch before it, not the whole call', () => {
			const h = createHarness('high');

			h.peerConnection.totalAvailableOutgoingBitrate = 5_000_000;
			h.tick({ bandwidthLimited: false });
			h.tick({ bandwidthLimited: true });

			// The maxima reset at the raise, so the second episode cannot inherit the first's:
			// every healthy collection after it re-accumulates from whatever the link is now.
			h.peerConnection.totalAvailableOutgoingBitrate = 900_000;
			h.tick({ bandwidthLimited: false });
			h.tick({ bandwidthLimited: true });

			expect(h.raised[1].payload.maxAvailableOutgoingBitrate).toBe(900_000);
		});
	});

	describe('sensitivity', () => {
		it('high takes the browser verdict at its word', () => {
			const h = createHarness('high');

			h.tick({ bandwidthLimited: true });

			expect(h.raised).toHaveLength(1);
		});

		it('medium also wants the round trip to be moving', () => {
			const h = createHarness('medium');

			// Steady RTT: bandwidth limited, but no queue building.
			h.tick({ bandwidthLimited: true });
			expect(h.raised).toHaveLength(0);

			h.peerConnection.avgRttInSec = 0.3;
			h.tick({ bandwidthLimited: true });

			expect(h.raised).toHaveLength(1);
		});

		it('low wants outbound loss instead, and applies no round-trip guard', () => {
			const h = createHarness('low');

			h.tick({ bandwidthLimited: true });
			expect(h.raised).toHaveLength(0);

			// Steady RTT throughout: only the loss decides.
			h.peerConnection.outboundFractionLost = 0.08;
			h.tick({ bandwidthLimited: true });

			expect(h.raised).toHaveLength(1);
		});

		it('says nothing at all when the browser is not bandwidth limited', () => {
			for (const sensitivity of [ 'low', 'medium', 'high' ] as const) {
				const h = createHarness(sensitivity);

				h.peerConnection.outboundFractionLost = 0.5;
				h.peerConnection.avgRttInSec = 2;
				h.tick({ bandwidthLimited: false });

				expect(h.raised).toHaveLength(0);
			}
		});
	});

	it('says nothing while disabled', () => {
		const h = createHarness('high');

		h.detector.disabled = true;
		h.tick({ bandwidthLimited: true });

		expect(h.raised).toHaveLength(0);
		expect(h.congestionEvents()).toHaveLength(0);
	});
});
