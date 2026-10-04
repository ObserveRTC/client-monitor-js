/* eslint-disable @typescript-eslint/no-explicit-any */
import EventEmitter from 'eventemitter3';
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { MediasoupTransportBinding, peerConnectionOfTransport } from "../../src/sources/MediasoupTransportBinding";
import { CHROME_OFFER, SFU_ANSWER } from "../helpers/sdpFixtures";

/** The handler's private connection, as far as the binding touches it. */
class FakePeerConnection extends EventTarget {
	public signalingState: RTCSignalingState = 'stable';
	public localDescription: { type: string, sdp: string } | null = null;
	public remoteDescription: { type: string, sdp: string } | null = null;

	public setLocalDescription(description: { type: string, sdp: string }) {
		this.localDescription = description;
		this._move(description.type === 'offer' ? 'have-local-offer' : 'stable');
	}

	public setRemoteDescription(description: { type: string, sdp: string }) {
		this.remoteDescription = description;
		this._move(description.type === 'offer' ? 'have-remote-offer' : 'stable');
	}

	private _move(state: RTCSignalingState) {
		this.signalingState = state;
		this.dispatchEvent(new Event('signalingstatechange'));
	}
}

/** A mediasoup-client transport reduced to what the binding reads: events, an observer, a handler. */
class FakeTransport extends EventEmitter {
	public readonly id = 'transport-1';
	public readonly observer = new EventEmitter();
	public iceGatheringState = 'new';

	public constructor(public readonly handler: any) {
		super();
	}
}

describe('MediasoupTransportBinding session descriptions', () => {
	let monitor: ClientMonitor;
	let pcMonitor: PeerConnectionMonitor;

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
			bufferingEventsForSamples: true,
		} as any);
		pcMonitor = new PeerConnectionMonitor('transport-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('transport-1', pcMonitor);
	});

	afterEach(() => {
		monitor.close();
	});

	it('reaches the peer connection behind the transport handler', () => {
		const pc = new FakePeerConnection();

		expect(peerConnectionOfTransport(new FakeTransport({ _pc: pc }) as any)).toBe(pc);
		// Older releases kept the handler private as well.
		expect(peerConnectionOfTransport({ _handler: { _pc: pc } } as any)).toBe(pc);
	});

	it('yields nothing for a handler without a connection', () => {
		expect(peerConnectionOfTransport(new FakeTransport({}) as any)).toBeUndefined();
		expect(peerConnectionOfTransport(new FakeTransport({ _pc: { notAPeerConnection: true } }) as any)).toBeUndefined();
		expect(peerConnectionOfTransport(new FakeTransport(undefined) as any)).toBeUndefined();
	});

	it('captures each renegotiation mediasoup-client performs', () => {
		const pc = new FakePeerConnection();

		new MediasoupTransportBinding(new FakeTransport({ _pc: pc }) as any, pcMonitor).bind();

		// What a send transport's first produce() does.
		pc.setLocalDescription({ type: 'offer', sdp: CHROME_OFFER });
		pc.setRemoteDescription({ type: 'answer', sdp: SFU_ANSWER });

		expect(pcMonitor.negotiationRole).toBe('offerer');
		expect(pcMonitor.remoteIceLite).toBe(true);
		expect(pcMonitor.sdp.localDescriptionsCount).toBe(1);
		expect(pcMonitor.sdp.remoteDescriptionsCount).toBe(1);
	});

	it('picks up descriptions the transport negotiated before it was added', () => {
		const pc = new FakePeerConnection();

		pc.localDescription = { type: 'offer', sdp: CHROME_OFFER };
		pc.remoteDescription = { type: 'answer', sdp: SFU_ANSWER };
		new MediasoupTransportBinding(new FakeTransport({ _pc: pc }) as any, pcMonitor).bind();

		expect(pcMonitor.negotiationRole).toBe('offerer');
	});

	it('still binds, without SDP, when the connection cannot be reached', () => {
		const binding = new MediasoupTransportBinding(new FakeTransport({}) as any, pcMonitor);

		expect(() => binding.bind()).not.toThrow();
		expect(binding.peerConnection).toBeUndefined();
		expect(pcMonitor.sdp.localDescription).toBeUndefined();
	});

	it('stops listening once unbound', () => {
		const pc = new FakePeerConnection();
		const binding = new MediasoupTransportBinding(new FakeTransport({ _pc: pc }) as any, pcMonitor);

		binding.bind();
		binding.unbind();
		pc.setLocalDescription({ type: 'offer', sdp: CHROME_OFFER });

		expect(pcMonitor.sdp.localDescription).toBeUndefined();
	});
});
