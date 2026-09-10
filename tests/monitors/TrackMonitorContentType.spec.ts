/**
 * `contentType` / `isScreenShare` on both track monitors.
 *
 * Content type decides which detectors stand down and how strictly a picture is judged, so it is
 * pinned here rather than being an incidental of whichever scoring spec happened to need it.
 */
import { stubClientIssues } from "../helpers/detectorMocks";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

const noDetectorsConfig = {
    inboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3, flowDetection: 4, flowRecovery: 3 }, maxAllowedGapInMs: 60_000 },
    outboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3 }, maxAllowedGapInMs: 60_000 },
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
};

function createMockMediaSource() {
    return {
        width: 1920,
        height: 1080,
        getPeerConnection: () => ({ parent: { config: noDetectorsConfig, activeIssues: stubClientIssues() } }),
    };
}

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

describe('OutboundTrackMonitor contentType', () => {
    it('stays undefined by default and is NOT inferred from the content hint', () => {
        const track = createMockTrack({ contentHint: 'detail' });
        const monitor = new OutboundTrackMonitor(track as any, createMockMediaSource() as any);

        expect(monitor.contentType).toBeUndefined();
        expect(monitor.isScreenShare).toBe(false);
    });

    it('is inferred from getSettings().displaySurface (display capture only)', () => {
        const track = createMockTrack({ getSettings: () => ({ displaySurface: 'monitor' }) });
        const monitor = new OutboundTrackMonitor(track as any, createMockMediaSource() as any);

        expect(monitor.contentType).toBe('screenshare');
        expect(monitor.isScreenShare).toBe(true);
    });

    it('is settable explicitly through setContext', () => {
        const track = createMockTrack();
        const monitor = new OutboundTrackMonitor(track as any, createMockMediaSource() as any);

        expect(monitor.isScreenShare).toBe(false);

        monitor.setContext({ contentType: 'screenshare' });

        expect(monitor.contentType).toBe('screenshare');
        expect(monitor.isScreenShare).toBe(true);
    });
});

describe('InboundTrackMonitor contentType', () => {
    const noInboundDetectorsConfig = {
        dryInboundTrackDetector: null,
        encoderBottleneckDetector: null,
        inboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3, flowDetection: 4, flowRecovery: 3 }, maxAllowedGapInMs: 60_000 },
        outboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3 }, maxAllowedGapInMs: 60_000 },
        codecChangeDetector: null,
        videoRecoveryFailedDetector: null,
        playoutDiscrepancyDetector: null,
        decoderPerformanceDetector: null,
        stuckDecoderDetector: null,
        videoResolutionChangeDetector: null,
        avDesyncPlayoutDetector: null,
        inventedSpeechDetector: null,
        jitterBufferStressDetector: null,
    };

    function createMockInboundRtp() {
        return {
            kind: 'video',
            getPeerConnection: () => ({ parent: { config: noInboundDetectorsConfig, activeIssues: stubClientIssues() } }),
        };
    }

    it('stays undefined by default and is NOT inferred from the content hint', () => {
        const track = createMockTrack({ contentHint: 'detail' });
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.contentType).toBeUndefined();
        expect(monitor.isScreenShare).toBe(false);
    });

    /**
     * The outbound side infers this from `displaySurface`, and the inbound side deliberately does
     * not. `displaySurface` is a capture constraint: it exists on a locally captured track and
     * never on a received one, so the inbound inference could only ever have been dead code that
     * implied a capability the class does not have. Detectors that exempt screen shares —
     * `PixelatedVideoDetector`, `InboundVideoFlowStateDetector` — therefore judge inbound screen
     * content by camera rules until the application declares it.
     */
    it('is NOT inferred from getSettings().displaySurface, which a received track never carries', () => {
        const track = createMockTrack({ getSettings: () => ({ displaySurface: 'monitor' }) });
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.contentType).toBeUndefined();
        expect(monitor.isScreenShare).toBe(false);
    });

    it('is settable explicitly through setContext', () => {
        const track = createMockTrack();
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.isScreenShare).toBe(false);

        monitor.setContext({ contentType: 'screenshare' });

        expect(monitor.contentType).toBe('screenshare');
        expect(monitor.isScreenShare).toBe(true);
    });
});
