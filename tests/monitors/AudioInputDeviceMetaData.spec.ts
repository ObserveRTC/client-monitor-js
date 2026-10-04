/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { ClientMetaTypes } from "../../src/schema/ClientMetaTypes";

/**
 * The device label is the one fact an echo investigation needs that the stats never carry, so an
 * outbound audio track announces it as client metadata once, when it is first monitored.
 */
describe('AUDIO_INPUT_DEVICE metadata', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;
	let meta: any[];

	const makeTrack = (id: string, kind: string, label: string) => Object.assign(new EventTarget(), {
		id, kind, label, readyState: 'live', muted: false, enabled: true, contentHint: '',
		getSettings: () => ({ deviceId: 'dev-1', groupId: 'grp-1' }),
	}) as any;

	const createOutboundTrackMonitor = (track: any) => (pc as any)._createOutboundTrackMonitor(
		track,
		{ getPeerConnection: () => pc, kind: track.kind },
	);

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			bufferingEventsForSamples: true,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		meta = [];
		monitor.on('meta', (item) => meta.push(item));
	});

	afterEach(() => {
		monitor.close();
	});

	it('sends the label of an outbound audio track', () => {
		createOutboundTrackMonitor(makeTrack('a-1', 'audio', 'Monitor of Built-in Audio Analog Stereo'));

		expect(meta).toHaveLength(1);
		expect(meta[0]).toMatchObject({
			type: ClientMetaTypes.AUDIO_INPUT_DEVICE,
			payload: {
				peerConnectionId: 'pc-1',
				trackId: 'a-1',
				label: 'Monitor of Built-in Audio Analog Stereo',
				deviceId: 'dev-1',
				groupId: 'grp-1',
			},
		});
		// ...and it travels in the sample, which is what the observer reads.
		expect(monitor.createSample()?.clientMetaItems).toContainEqual(
			expect.objectContaining({ type: 'AUDIO_INPUT_DEVICE' }),
		);
	});

	it('sends nothing for a video track', () => {
		createOutboundTrackMonitor(makeTrack('v-1', 'video', 'Integrated Webcam'));

		expect(meta).toHaveLength(0);
	});

	it('sends once per track, not once per lookup', () => {
		const track = makeTrack('a-1', 'audio', 'Shure MV7');

		createOutboundTrackMonitor(track);
		createOutboundTrackMonitor(track);

		expect(meta).toHaveLength(1);
	});
});
