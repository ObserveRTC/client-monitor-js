/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { RtcPeerConnectionBinding } from "../../src/sources/RtcPeerConnectionBinding";
import { CHROME_OFFER, SFU_ANSWER } from "../helpers/sdpFixtures";

/**
 * Just enough of an `RTCPeerConnection` for the binding: listeners, the two description
 * getters, and set*Description moving `signalingState` the way the spec does.
 */
class FakePeerConnection extends EventTarget {
	public signalingState: RTCSignalingState = 'stable';
	public iceConnectionState = 'new';
	public iceGatheringState = 'new';
	public connectionState = 'new';
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

describe('RtcPeerConnectionBinding session descriptions', () => {
	let monitor: ClientMonitor;
	let pcMonitor: PeerConnectionMonitor;
	let meta: any[];

	const bindTo = (pc: FakePeerConnection) => {
		const binding = new RtcPeerConnectionBinding(pc as any, pcMonitor);

		binding.bind();

		return binding;
	};

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
			bufferingEventsForSamples: true,
		} as any);
		pcMonitor = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pcMonitor);
		meta = [];
		monitor.on('meta', (item: any) => {
			if (item.type.endsWith('_SDP')) meta.push(item);
		});
	});

	afterEach(() => {
		monitor.close();
	});

	it('captures an offer/answer exchange without the application calling anything', () => {
		const pc = new FakePeerConnection();

		bindTo(pc);
		pc.setLocalDescription({ type: 'offer', sdp: CHROME_OFFER });

		expect(pcMonitor.sdp.localDescription?.type).toBe('offer');
		expect(pcMonitor.negotiationRole).toBeUndefined();

		pc.setRemoteDescription({ type: 'answer', sdp: SFU_ANSWER });

		expect(pcMonitor.negotiationRole).toBe('offerer');
		expect(pcMonitor.remoteIceLite).toBe(true);
		// The unchanged local description, read again on the second transition, is not re-reported.
		expect(meta.map((item) => item.type)).toEqual([ 'LOCAL_SDP', 'REMOTE_SDP' ]);
	});

	it('picks up descriptions a connection already had when it was added', () => {
		const pc = new FakePeerConnection();

		pc.localDescription = { type: 'offer', sdp: CHROME_OFFER };
		pc.remoteDescription = { type: 'answer', sdp: SFU_ANSWER };
		bindTo(pc);

		expect(pcMonitor.negotiationRole).toBe('offerer');
		expect(meta).toHaveLength(2);
	});

	it('captures a renegotiation', () => {
		const pc = new FakePeerConnection();

		bindTo(pc);
		pc.setLocalDescription({ type: 'offer', sdp: CHROME_OFFER });
		pc.setRemoteDescription({ type: 'answer', sdp: SFU_ANSWER });
		pc.setLocalDescription({ type: 'offer', sdp: CHROME_OFFER.replace('o=- 4611731400430051336 2', 'o=- 4611731400430051336 3') });

		expect(pcMonitor.sdp.localDescriptionsCount).toBe(2);
		expect(pcMonitor.sdp.localDescription?.parsed.sessionVersion).toBe(3);
	});

	it('stops listening once unbound', () => {
		const pc = new FakePeerConnection();
		const binding = bindTo(pc);

		binding.unbind();
		pc.setLocalDescription({ type: 'offer', sdp: CHROME_OFFER });

		expect(pcMonitor.sdp.localDescription).toBeUndefined();
	});
});
