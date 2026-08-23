/* eslint-disable @typescript-eslint/no-explicit-any */
import { DefaultScoreCalculator } from "../../src/scores/DefaultScoreCalculator";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

const noDetectorsConfig = {
    dryOutboundTrackDetector: null,
    captureFailureDetector: null,
    codecChangeDetector: null,
    sourceEncoderBottleneckDetector: null,
    simulcastLayerDetector: null,
    videoResolutionChangeDetector: null,
};

function createMockMediaSource() {
    return {
        width: 1920,
        height: 1080,
        getPeerConnection: () => ({ parent: { config: noDetectorsConfig } }),
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

    it('is settable explicitly through setContentType', () => {
        const track = createMockTrack();
        const monitor = new OutboundTrackMonitor(track as any, createMockMediaSource() as any);

        expect(monitor.isScreenShare).toBe(false);

        monitor.setContentType('screenshare');

        expect(monitor.contentType).toBe('screenshare');
        expect(monitor.isScreenShare).toBe(true);
    });
});

describe('InboundTrackMonitor contentType', () => {
    const noInboundDetectorsConfig = {
        dryInboundTrackDetector: null,
        codecChangeDetector: null,
        videoFreezesDetector: null,
        videoRecoveryDetector: null,
        playoutDiscrepancyDetector: null,
        decoderPerformanceDetector: null,
        stuckDecoderDetector: null,
        videoResolutionChangeDetector: null,
        audioDesyncDetector: null,
        audioConcealmentDetector: null,
        jitterBufferStressDetector: null,
    };

    function createMockInboundRtp() {
        return {
            kind: 'video',
            getPeerConnection: () => ({ parent: { config: noInboundDetectorsConfig } }),
        };
    }

    it('stays undefined by default and is NOT inferred from the content hint', () => {
        const track = createMockTrack({ contentHint: 'detail' });
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.contentType).toBeUndefined();
        expect(monitor.isScreenShare).toBe(false);
    });

    it('is inferred from getSettings().displaySurface when present', () => {
        const track = createMockTrack({ getSettings: () => ({ displaySurface: 'monitor' }) });
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.contentType).toBe('screenshare');
        expect(monitor.isScreenShare).toBe(true);
    });

    it('is settable explicitly through setContentType', () => {
        const track = createMockTrack();
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.isScreenShare).toBe(false);

        monitor.setContentType('screenshare');

        expect(monitor.contentType).toBe('screenshare');
        expect(monitor.isScreenShare).toBe(true);
    });
});

describe('DefaultScoreCalculator', () => {
    let calculator: any;

    beforeEach(() => {
        calculator = new DefaultScoreCalculator({} as any);
    });

    describe('peer connection stability score', () => {
        function createPcMock(overrides: Record<string, unknown> = {}) {
            return {
                avgRttInSec: 0.05,
                inboundRtps: [],
                remoteInboundRtps: [],
                calculatedStabilityScore: { weight: 1, value: undefined as number | undefined },
                ...overrides,
            };
        }

        const ticks = (pc: unknown, count = 6) => {
            for (let i = 0; i < count; ++i) calculator._calculatePeerConnectionStabilityScore(pc);
        };

        it('penalizes a long path as high-rtt without a jitter penalty', () => {
            const pc = createPcMock({ avgRttInSec: 0.2 });

            ticks(pc);

            const reasons = (pc.calculatedStabilityScore as any).reasons;

            expect(reasons['high-rtt']).toBe(1.0);
            expect(reasons['high-jitter']).toBeUndefined();
        });

        it('penalizes a jittery path as high-jitter without an rtt penalty', () => {
            const pc = createPcMock({
                avgRttInSec: 0.05,
                remoteInboundRtps: [ { jitter: 0.05, deltaFractionLost: 0 } ],
            });

            ticks(pc);

            const reasons = (pc.calculatedStabilityScore as any).reasons;

            expect(reasons['high-jitter']).toBe(1.0);
            expect(reasons['high-rtt']).toBeUndefined();
        });

        it('averages the delta loss fractions across streams instead of summing them', () => {
            // three streams at 4% each: the average (4%) is one penalty tier,
            // the old sum (12%) would have been two tiers
            const pc = createPcMock({
                remoteInboundRtps: [
                    { jitter: 0, deltaFractionLost: 0.04 },
                    { jitter: 0, deltaFractionLost: 0.04 },
                    { jitter: 0, deltaFractionLost: 0.04 },
                ],
            });

            ticks(pc);

            expect((pc.calculatedStabilityScore as any).reasons['high-packetloss']).toBe(1.0);
        });

        it('produces a smoothed score value after enough ticks', () => {
            const pc = createPcMock();

            ticks(pc);

            expect(pc.calculatedStabilityScore.value).toBe(5.0);
        });
    });

    describe('inbound audio track score', () => {
        function createAudioTrackMock(overrides: {
            bitrate?: number,
            inboundRtp?: Record<string, unknown>,
            activeIssueKeys?: string[],
        } = {}) {
            const activeIssueKeys = new Set(overrides.activeIssueKeys ?? []);

            return {
                track: { id: 'audio-1', enabled: true, muted: false },
                bitrate: overrides.bitrate ?? DefaultScoreCalculator.TARGET_AUDIO_BITRATE,
                calculatedScore: { weight: 1, value: undefined as number | undefined },
                getInboundRtp: () => ({ deltaFractionLost: 0, ...overrides.inboundRtp }),
                getPeerConnection: () => ({
                    parent: { isIssueActive: (key: string) => activeIssueKeys.has(key) },
                }),
            };
        }

        it('gives full score for clean audio at the target bitrate', () => {
            const track = createAudioTrackMock();

            calculator._calculateInboundAudioTrackScore(track);

            expect(track.calculatedScore.value).toBe(5.0);
        });

        it('decays on the per-interval loss fraction when no detector issue is active', () => {
            const track = createAudioTrackMock({ inboundRtp: { deltaFractionLost: 0.03 } });

            calculator._calculateInboundAudioTrackScore(track);

            // exp(-0.03/0.03) ≈ 0.37 -> ≈ 1.84
            expect(track.calculatedScore.value!).toBeLessThan(2.0);
            expect(track.calculatedScore.value!).toBeGreaterThan(1.5);
            // the decay is attributed on the track itself
            expect((track.calculatedScore as any).reasons['high-packetloss']).toBeGreaterThan(3.0);
        });

        it('records no loss reason for clean audio', () => {
            const track = createAudioTrackMock();

            calculator._calculateInboundAudioTrackScore(track);

            expect((track.calculatedScore as any).reasons['high-packetloss']).toBeUndefined();
        });

        it('scales the audio-concealment penalty with the audible concealment rate', () => {
            const track = createAudioTrackMock({
                activeIssueKeys: [ 'audio-concealment-track-audio-1' ],
                inboundRtp: { concealmentRate: 0.065 },
            });

            calculator._calculateInboundAudioTrackScore(track);

            // (0.065 - 0.03) / (0.1 - 0.03) = 0.5
            expect((track.calculatedScore as any).reasons['audio-concealment']).toBe(0.5);
            expect(track.calculatedScore.value).toBe(4.5);
        });

        it('saturates the audio-concealment penalty at 1.0', () => {
            const track = createAudioTrackMock({
                activeIssueKeys: [ 'audio-concealment-track-audio-1' ],
                inboundRtp: { concealmentRate: 0.2 },
            });

            calculator._calculateInboundAudioTrackScore(track);

            expect((track.calculatedScore as any).reasons['audio-concealment']).toBe(1.0);
            expect(track.calculatedScore.value).toBe(4.0);
        });

        it('adds no concealment penalty on a tick where the rate fell back under the threshold', () => {
            // hysteresis keeps the issue open, but this tick sounds fine
            const track = createAudioTrackMock({
                activeIssueKeys: [ 'audio-concealment-track-audio-1' ],
                inboundRtp: { concealmentRate: 0.01 },
            });

            calculator._calculateInboundAudioTrackScore(track);

            expect((track.calculatedScore as any).reasons['audio-concealment']).toBeUndefined();
            expect(track.calculatedScore.value).toBe(5.0);
        });

        it('stacks jitter-buffer-stress and desync issue penalties, each scaled by its metric', () => {
            const track = createAudioTrackMock({
                activeIssueKeys: [
                    'audio-jitter-buffer-stress-track-audio-1',
                    'audio-desync-track-audio-1',
                ],
                inboundRtp: {
                    jitterBufferTargetDelayInMs: 350, // (350 - 200) / (500 - 200) = 0.5
                    timeStretchRate: 0.2, // (0.2 - 0.1) / (0.3 - 0.1) = 0.5
                },
            });

            calculator._calculateInboundAudioTrackScore(track);

            expect((track.calculatedScore as any).reasons['high-jitter-buffer-delay']).toBe(0.5);
            expect((track.calculatedScore as any).reasons['audio-time-stretch']).toBe(0.5);
            expect(track.calculatedScore.value).toBe(4.0);
        });
    });

    describe('outbound audio track score', () => {
        function createOutboundAudioTrackMock(remoteInboundRtp?: Record<string, unknown>) {
            const outboundRtp = {
                bitrate: DefaultScoreCalculator.TARGET_AUDIO_BITRATE,
                getMediaSource: () => ({ audioLevel: 0.5 }),
                getRemoteInboundRtp: () => remoteInboundRtp,
            };

            return {
                track: { id: 'audio-out-1', enabled: true, muted: false },
                calculatedScore: { weight: 1, value: undefined as number | undefined },
                getOutboundRtps: () => [ outboundRtp ],
            };
        }

        it('gives full score without remote loss', () => {
            const track = createOutboundAudioTrackMock({ deltaFractionLost: 0 });

            calculator._calculateOutboundAudioTrackScore(track);

            expect(track.calculatedScore.value).toBe(5.0);
            expect((track.calculatedScore as any).reasons['high-packetloss']).toBeUndefined();
        });

        it('attributes remote loss on this stream as a track-level reason', () => {
            const track = createOutboundAudioTrackMock({ deltaFractionLost: 0.03 });

            calculator._calculateOutboundAudioTrackScore(track);

            expect(track.calculatedScore.value!).toBeLessThan(2.0);
            expect((track.calculatedScore as any).reasons['high-packetloss']).toBeGreaterThan(3.0);
        });
    });

    describe('inbound video track score', () => {
        function createVideoTrackMock(inboundRtp: Record<string, unknown>, options: { isScreenShare?: boolean } = {}) {
            return {
                track: { id: 'video-1', enabled: true, muted: false },
                isScreenShare: options.isScreenShare ?? false,
                calculatedScore: { weight: 2, value: undefined as number | undefined },
                getInboundRtp: () => ({
                    lastNFramesPerSec: [],
                    getCodec: () => undefined,
                    ...inboundRtp,
                }),
            };
        }

        const ticks = (track: unknown, count = 6) => {
            for (let i = 0; i < count; ++i) calculator._calculateInboundVideoTrackScore(track);
        };

        it('penalizes a frozen track', () => {
            const track = createVideoTrackMock({ isFreezed: true });

            ticks(track);

            expect((track.calculatedScore as any).reasons['frozen-video']).toBe(2.0);
            expect(track.calculatedScore.value!).toBeLessThan(5.0);
        });

        it('penalizes sustained low fps only while frames are flowing', () => {
            const flowing = createVideoTrackMock({ ewmaFps: 5, deltaFramesReceived: 10 });
            const dry = createVideoTrackMock({ ewmaFps: 5, deltaFramesReceived: 0 });

            ticks(flowing, 1);
            ticks(dry, 1);

            expect((flowing.calculatedScore as any).reasons['low-fps']).toBe(1.0);
            expect((dry.calculatedScore as any).reasons['low-fps']).toBeUndefined();
        });

        it('saturates the bitrate-per-pixel penalty at half the codec floor', () => {
            const track = createVideoTrackMock({
                bitPerPixel: 0.03, // < 0.5 * 0.15 (vp8 standard low)
                getCodec: () => ({ mimeType: 'video/VP8' }),
            });

            ticks(track, 1);

            expect((track.calculatedScore as any).reasons['low-bitrate-per-pixel']).toBe(1.0);
        });

        it('ramps the bitrate-per-pixel penalty between the floor and half of it', () => {
            const track = createVideoTrackMock({
                bitPerPixel: 0.1125, // (0.15 - 0.1125) / (0.15 * 0.5) = 0.5
                getCodec: () => ({ mimeType: 'video/VP8' }),
            });

            ticks(track, 1);

            expect((track.calculatedScore as any).reasons['low-bitrate-per-pixel']).toBe(0.5);
        });

        it('penalizes jitter only beyond one sampling interval, normalized to 1', () => {
            const clean = createVideoTrackMock({ jitter: 0.015 }); // 15ms < 20ms
            const jittery = createVideoTrackMock({ jitter: 0.04 }); // (40 - 20) / (100 - 20) = 0.25
            const saturated = createVideoTrackMock({ jitter: 0.25 }); // 250ms >= 100ms

            ticks(clean, 1);
            ticks(jittery, 1);
            ticks(saturated, 1);

            expect((clean.calculatedScore as any).reasons['high-jitter']).toBeUndefined();
            expect((jittery.calculatedScore as any).reasons['high-jitter']).toBe(0.25);
            expect((saturated.calculatedScore as any).reasons['high-jitter']).toBe(1.0);
        });

        it('normalizes the volatile-fps penalty from the activation threshold', () => {
            const track = createVideoTrackMock({
                framesPerSecond: 20,
                ewmaFps: 20,
                // mean 20, stdDev 3, volatility 0.15 -> (0.15 - 0.1) / (0.2 - 0.1) = 0.5
                lastNFramesPerSec: [ 17, 23 ],
            });

            ticks(track, 1);

            expect((track.calculatedScore as any).reasons['volatile-fps']).toBe(0.5);
        });

        it('skips low-fps and volatile-fps for inbound screen share', () => {
            const track = createVideoTrackMock({
                ewmaFps: 2,
                deltaFramesReceived: 4,
                framesPerSecond: 2,
                lastNFramesPerSec: [ 1, 8 ], // wildly volatile, normal for a screen share
            }, { isScreenShare: true });

            ticks(track, 1);

            const reasons = (track.calculatedScore as any).reasons;

            expect(reasons['low-fps']).toBeUndefined();
            expect(reasons['volatile-fps']).toBeUndefined();
        });
    });

    describe('outbound video track score', () => {
        function createOutboundTrackMock(options: {
            isScreenShare: boolean,
            outboundRtp: Record<string, unknown>,
            sourceSize?: { width: number, height: number },
        }) {
            const outboundRtp = options.outboundRtp;

            return {
                track: { id: 'video-out-1', enabled: true, muted: false },
                isScreenShare: options.isScreenShare,
                calculatedScore: { weight: 2, value: undefined as number | undefined },
                mappedOutboundRtps: new Map([ [ 1, outboundRtp ] ]),
                getHighestLayer: () => outboundRtp,
                getMediaSource: () => ({ width: 1920, height: 1080, ...options.sourceSize }),
            };
        }

        const ticks = (track: unknown, count = 6) => {
            for (let i = 0; i < count; ++i) calculator._calculateOutboundVideoTrackScore(track);
        };

        it('penalizes via quality limitation duration shares on camera tracks', () => {
            const track = createOutboundTrackMock({
                isScreenShare: false,
                outboundRtp: {
                    qualityLimitationDurationShares: { none: 0.1, cpu: 0.4, bandwidth: 0.5, other: 0 },
                },
            });

            ticks(track);

            const reasons = (track.calculatedScore as any).reasons;

            expect(reasons['cpu-limitation']).toBe(2.0);
            expect(reasons['bandwidth-limitation']).toBe(1.0);
            expect(track.calculatedScore.value!).toBeLessThan(5.0);
        });

        it('falls back to the instantaneous reason when shares are unavailable', () => {
            const track = createOutboundTrackMock({
                isScreenShare: false,
                outboundRtp: { qualityLimitationReason: 'cpu' },
            });

            ticks(track);

            expect((track.calculatedScore as any).reasons['cpu-limitation']).toBe(2.0);
        });

        it('normalizes the target-bitrate deviation penalty', () => {
            const track = createOutboundTrackMock({
                isScreenShare: false,
                outboundRtp: {
                    targetBitrate: 1_000_000,
                    bitrate: 900_000,
                    payloadBitrate: 900_000, // 10% under target -> (0.1 - 0.05) / (0.15 - 0.05) = 0.5
                },
            });

            ticks(track, 1);

            expect((track.calculatedScore as any).reasons['high-deviation-from-target-bitrate']).toBe(0.5);
        });

        it('penalizes a downscaled screen share and skips volatility/deviation', () => {
            const track = createOutboundTrackMock({
                isScreenShare: true,
                outboundRtp: {
                    frameWidth: 640,
                    frameHeight: 360,
                    targetBitrate: 2_000_000,
                    bitrate: 100_000, // would trip deviation/volatility on camera path
                    payloadBitrate: 100_000,
                },
            });

            ticks(track);

            const reasons = (track.calculatedScore as any).reasons;

            // (640*360) / (1920*1080) ≈ 0.11 < 0.25
            expect(reasons['downscaled-screenshare']).toBe(2.0);
            expect(reasons['high-deviation-from-target-bitrate']).toBeUndefined();
            expect(reasons['high-volatile-bitrate']).toBeUndefined();
        });

        it('does not penalize a screen share sent at (near) source resolution', () => {
            const track = createOutboundTrackMock({
                isScreenShare: true,
                outboundRtp: { frameWidth: 1920, frameHeight: 1080 },
            });

            ticks(track);

            expect((track.calculatedScore as any).reasons['downscaled-screenshare']).toBeUndefined();
            expect(track.calculatedScore.value).toBe(5.0);
        });
    });
});
