import { stubClientIssues } from "../helpers/detectorMocks";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";

const silentLogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const noDetectorsConfig = {
	dryOutboundTrackDetector: null,
	captureSourceLostDetector: null,
	captureTrackMutedDetector: null,
	silentAudioSourceDetector: null,
	codecChangeDetector: null,
	videoCaptureBottleneckDetector: null,
	decoderBottleneckDetector: null,
	simulcastLayerDetector: null,
	videoResolutionChangeDetector: null,
	inboundVideoFlowStateDetector: null,
	avDesyncPlayoutDetector: null,
	dryInboundTrackDetector: null,
	encoderBottleneckDetector: null,
	inboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3, flowDetection: 4, flowRecovery: 3 }, maxAllowedGapInMs: 60_000 },
	outboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3 }, maxAllowedGapInMs: 60_000 },
	playoutDiscrepancyDetector: null,
	inventedSpeechDetector: null,
	jitterBufferStressDetector: null,
	decoderPerformanceDetector: null,
	stuckDecoderDetector: null,
};

const peerConnectionStub = () => ({ parent: { config: noDetectorsConfig, activeIssues: stubClientIssues() } });

function createMockTrack(overrides: Record<string, unknown> = {}) {
	return {
		id: 'track-1',
		kind: 'video',
		contentHint: '',
		enabled: true,
		muted: false,
		readyState: 'live',
		getSettings: () => ({}),
		...overrides,
	};
}

function createInbound() {
	return new InboundTrackMonitor(
		createMockTrack() as any,
		{ getPeerConnection: peerConnectionStub } as any,
	);
}

function createOutbound() {
	return new OutboundTrackMonitor(
		createMockTrack() as any,
		{ width: 1920, height: 1080, getPeerConnection: peerConnectionStub } as any,
	);
}

function createClientMonitor() {
	return new ClientMonitor({
		logger: silentLogger,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
	});
}

describe('InboundTrackMonitor.setContext', () => {
	it('writes only the fields it was given', () => {
		const monitor = createInbound();

		monitor.setContext({ contentType: 'screenshare' });

		expect(monitor.contentType).toBe('screenshare');
		expect(monitor.motionType).toBeUndefined();
		expect(monitor.isScreenShare).toBe(true);
	});

	it('merges rather than replaces, so a later partial call keeps earlier fields', () => {
		const monitor = createInbound();

		monitor.setContext({ contentType: 'screenshare' });
		monitor.setContext({ motionType: 'highmotion' });

		expect(monitor.contentType).toBe('screenshare');
		expect(monitor.motionType).toBe('highmotion');
	});

	/**
	 * The two statements a context call can make about a field, and they are different: saying
	 * nothing about it leaves what was declared, and passing `undefined` un-declares it. An
	 * application assembling a context from its own optional state needs the second to be
	 * reachable — otherwise a field, once set, could never be taken back.
	 */
	it('keeps a field the call does not mention', () => {
		const monitor = createInbound();

		monitor.setContext({ contentType: 'screenshare' });
		monitor.setContext({ motionType: 'lowmotion' });

		expect(monitor.contentType).toBe('screenshare');
		expect(monitor.motionType).toBe('lowmotion');
	});

	it('clears a field passed as an explicit undefined', () => {
		const monitor = createInbound();

		monitor.setContext({ contentType: 'screenshare' });
		monitor.setContext({ contentType: undefined, motionType: 'lowmotion' });

		expect(monitor.contentType).toBeUndefined();
		expect(monitor.motionType).toBe('lowmotion');
	});

	// The reason the pause flags moved into the context: a receiver can be created already
	// paused, and the declaration has to be able to arrive before the track does.
	it('carries the pause flags', () => {
		const monitor = createInbound();

		expect(monitor.paused).toBe(false);
		expect(monitor.remoteOutboundTrackPaused).toBe(false);

		monitor.setContext({ paused: true, remoteOutboundTrackPaused: true });

		expect(monitor.paused).toBe(true);
		expect(monitor.remoteOutboundTrackPaused).toBe(true);

		monitor.setContext({ paused: false });

		expect(monitor.paused).toBe(false);
		expect(monitor.remoteOutboundTrackPaused).toBe(true);
	});

	/**
	 * The field stayed writable, so the way this was set before the flags moved into the context
	 * still works. Both spellings reach the same place, and a write is visible to a later merge
	 * rather than being shadowed by it.
	 */
	it('keeps the pause flags assignable, writing through to the context', () => {
		const monitor = createInbound();

		monitor.paused = true;
		monitor.remoteOutboundTrackPaused = true;

		expect(monitor.paused).toBe(true);
		expect(monitor.remoteOutboundTrackPaused).toBe(true);

		// A merge that says nothing about them leaves the assigned values alone ...
		monitor.setContext({ motionType: 'lowmotion' });

		expect(monitor.paused).toBe(true);

		// ... and clearing through the context is visible to the getter.
		monitor.setContext({ paused: undefined });

		expect(monitor.paused).toBe(false);
	});

	it('carries the presentation fields', () => {
		const monitor = createInbound();

		monitor.setContext({ presentedResolution: { width: 320, height: 180 } });

		expect(monitor.presentedResolution).toEqual({ width: 320, height: 180 });
	});
});

describe('OutboundTrackMonitor.setContext', () => {
	it('sets the content type when no displaySurface auto-detected one', () => {
		const monitor = createOutbound();

		expect(monitor.isScreenShare).toBe(false);

		monitor.setContext({ contentType: 'screenshare' });

		expect(monitor.contentType).toBe('screenshare');
		expect(monitor.isScreenShare).toBe(true);
	});
});

describe('ClientMonitor pending track contexts', () => {
	it('holds an inbound declaration until a track monitor claims it', () => {
		const monitor = createClientMonitor();

		monitor.setInboundTrackContext('abc-123', { contentType: 'screenshare' });

		expect(monitor.takePendingInboundTrackContext('abc-123')).toEqual({ contentType: 'screenshare' });
		// taking it forgets it — a later track reusing the id must not inherit
		// a declaration that was already consumed
		expect(monitor.takePendingInboundTrackContext('abc-123')).toBeUndefined();

		monitor.close();
	});

	it('merges successive pending declarations for the same track', () => {
		const monitor = createClientMonitor();

		monitor.setInboundTrackContext('abc-123', { contentType: 'screenshare' });
		monitor.setInboundTrackContext('abc-123', { motionType: 'lowmotion' });

		expect(monitor.takePendingInboundTrackContext('abc-123')).toEqual({
			contentType: 'screenshare',
			motionType: 'lowmotion',
		});

		monitor.close();
	});

	it('lets a later declaration overwrite an earlier one for the same field', () => {
		const monitor = createClientMonitor();

		monitor.setInboundTrackContext('abc-123', { contentType: 'screenshare' });
		monitor.setInboundTrackContext('abc-123', { contentType: 'camera' });

		expect(monitor.takePendingInboundTrackContext('abc-123')).toEqual({ contentType: 'camera' });

		monitor.close();
	});

	it('keeps inbound and outbound declarations apart', () => {
		const monitor = createClientMonitor();

		monitor.setInboundTrackContext('abc-123', { contentType: 'screenshare' });
		monitor.setOutboundTrackContext('abc-123', { contentType: 'camera' });

		expect(monitor.takePendingOutboundTrackContext('abc-123')).toEqual({ contentType: 'camera' });
		expect(monitor.takePendingInboundTrackContext('abc-123')).toEqual({ contentType: 'screenshare' });

		monitor.close();
	});

	it('reports nothing pending for a track never declared', () => {
		const monitor = createClientMonitor();

		expect(monitor.takePendingInboundTrackContext('nobody')).toBeUndefined();
		expect(monitor.takePendingOutboundTrackContext('nobody')).toBeUndefined();

		monitor.close();
	});
});
