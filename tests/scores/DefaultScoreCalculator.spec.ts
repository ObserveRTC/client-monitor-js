/* eslint-disable @typescript-eslint/no-explicit-any */
import { VIDEO_QP_THRESHOLDS } from '../../src/scores/CalculatedScore';
import { DefaultScoreCalculator } from "../../src/scores/DefaultScoreCalculator";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

const noDetectorsConfig = {
    dryOutboundTrackDetector: null,
    captureFailureDetector: null,
    codecChangeDetector: null,
    outboundFrameSupplyDetector: null,
    inboundFrameSupplyDetector: null,
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

    it('is settable explicitly through setContext', () => {
        const track = createMockTrack();
        const monitor = new InboundTrackMonitor(track as any, createMockInboundRtp() as any);

        expect(monitor.isScreenShare).toBe(false);

        monitor.setContext({ contentType: 'screenshare' });

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
                remoteInboundRtps: [ { jitter: 0.05, deltaFractionLost: 0, deltaPacketsReceived: 250 } ],
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
                    { jitter: 0, deltaFractionLost: 0.04, deltaPacketsReceived: 250 },
                    { jitter: 0, deltaFractionLost: 0.04, deltaPacketsReceived: 250 },
                    { jitter: 0, deltaFractionLost: 0.04, deltaPacketsReceived: 250 },
                ],
            });

            ticks(pc);

            expect((pc.calculatedStabilityScore as any).reasons['high-packetloss']).toBe(1.0);
        });

        it('ignores streams that carry no media, whatever their ratios say', () => {
            // An SFU's bandwidth-probation stream: a handful of deliberately
            // discardable packets, no frames, ~2 kbps — and therefore a loss
            // ratio and a jitter figure that are not measurements of anything.
            // Averaged in with equal weight it used to pin the whole connection
            // at the minimum score.
            const pc = createPcMock({
                inboundRtps: [
                    { jitter: 0.002, deltaFractionLost: 0, bitrate: 500_000, deltaPacketsReceived: 344, deltaFramesReceived: 150 },
                    { jitter: 0.493, deltaFractionLost: 0.5, bitrate: 1_900, deltaPacketsReceived: 8, deltaFramesReceived: 0 },
                ],
            });

            ticks(pc);

            const reasons = (pc.calculatedStabilityScore as any).reasons;

            expect(reasons['high-jitter']).toBeUndefined();
            expect(reasons['high-packetloss']).toBeUndefined();
        });

        it('still judges a thin stream that is delivering frames', () => {
            const pc = createPcMock({
                inboundRtps: [
                    { jitter: 0.12, deltaFractionLost: 0.08, bitrate: 2_000, deltaPacketsReceived: 5, deltaFramesReceived: 3 },
                ],
            });

            ticks(pc);

            const reasons = (pc.calculatedStabilityScore as any).reasons;

            expect(reasons['high-jitter']).toBe(2.0);
            expect(reasons['high-packetloss']).toBe(2.0);
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

        it('does not subtract packet loss — that belongs to the peer connection', () => {
            // Loss is a property of the path, shared by every stream on the
            // transport, so it is attributed once on the peer connection. What
            // the loss *did* to this audio is measured directly, and penalized,
            // as concealment and time-stretch below.
            const track = createAudioTrackMock({ inboundRtp: { deltaFractionLost: 0.03 } });

            calculator._calculateInboundAudioTrackScore(track);

            expect(track.calculatedScore.value).toBe(5.0);
            expect((track.calculatedScore as any).reasons['high-packetloss']).toBeUndefined();
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

        it('does not subtract remote loss — that belongs to the peer connection', () => {
            // The send side has no perception to measure, so a track score here
            // is what we chose to send; what the path then did to it is the
            // connection's story, and charging it twice took this track to ~0
            // on a path measured at 0% loss for 95% of a session.
            const track = createOutboundAudioTrackMock({ deltaFractionLost: 0.03 });

            calculator._calculateOutboundAudioTrackScore(track);

            expect(track.calculatedScore.value).toBe(5.0);
            expect((track.calculatedScore as any).reasons['high-packetloss']).toBeUndefined();
        });
    });

    describe('inbound video track score', () => {
        function createVideoTrackMock(
            inboundRtp: Record<string, unknown>,
            options: { isScreenShare?: boolean, motionType?: 'lowmotion' | 'standard' | 'highmotion' } = {},
        ) {
            return {
                track: { id: 'video-1', enabled: true, muted: false },
                isScreenShare: options.isScreenShare ?? false,
                motionType: options.motionType,
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

        const qpTrack = (
            inboundRtp: Record<string, unknown> = {},
            options: { isScreenShare?: boolean, motionType?: 'lowmotion' | 'standard' | 'highmotion' } = {},
        ) =>
            createVideoTrackMock({
                frameWidth: 640,
                frameHeight: 360,
                framesPerSecond: 30,
                lastNFramesPerSec: [30],
                bitrate: 500_000,
                getCodec: () => ({ mimeType: 'video/VP8' }),
                ...inboundRtp,
            }, options);
        const qpReason = (track: unknown) =>
            ((track as any).calculatedScore.reasons ?? {})['pixelated-video'];

        it('makes no judgement when the browser does not report qpSum', () => {
            // A starved-looking bitrate is NOT enough to conclude anything about
            // the picture, so no reason is emitted at all.
            const track = qpTrack();

            ticks(track, 1);

            expect(qpReason(track)).toBeUndefined();
        });

        it('does not penalize a finely quantized picture', () => {
            const track = qpTrack({ avgQpPerFrame: 20 }); // < vp8 activation 40

            ticks(track, 1);

            expect(qpReason(track)).toBeUndefined();
        });

        it('ramps the penalty between the codec activation and saturation QP', () => {
            const track = qpTrack({ avgQpPerFrame: 60 }); // (60-40)/(80-40) = 0.5

            ticks(track, 1);

            expect(qpReason(track)).toBe(0.5);
        });

        it('saturates the penalty for a coarsely quantized picture', () => {
            const track = qpTrack({ avgQpPerFrame: 90 }); // >= vp8 saturation 80

            ticks(track, 1);

            expect(qpReason(track)).toBe(1.0);
        });

        it('uses each codec its own QP scale rather than a shared range', () => {
            // QP 45 is past saturation on H.264's 0-51 scale but still healthy on
            // VP8's 0-127 scale - normalizing both to 0..1 would conflate them.
            const h264 = qpTrack({ avgQpPerFrame: 45, getCodec: () => ({ mimeType: 'video/H264' }) });
            const vp8 = qpTrack({ avgQpPerFrame: 45 });

            ticks(h264, 1);
            ticks(vp8, 1);

            expect(qpReason(h264)).toBe(1.0);
            expect(qpReason(vp8)).toBeLessThan(0.5);
        });

        it('makes no judgement for a codec it has no QP scale for', () => {
            const track = qpTrack({ avgQpPerFrame: 200, getCodec: () => ({ mimeType: 'video/H266' }) });

            ticks(track, 1);

            expect(qpReason(track)).toBeUndefined();
        });

        it('tolerates a coarser quantizer on high-motion content than on low', () => {
            // vp8 activation 40: lowmotion 32, standard 40, highmotion 50.
            // QP 45 is past the bar for static content and under it for motion.
            const low = qpTrack({ avgQpPerFrame: 45 }, { motionType: 'lowmotion' });
            const standard = qpTrack({ avgQpPerFrame: 45 });
            const high = qpTrack({ avgQpPerFrame: 45 }, { motionType: 'highmotion' });

            ticks(low, 1);
            ticks(standard, 1);
            ticks(high, 1);

            expect(qpReason(high)).toBeUndefined();
            expect(qpReason(standard)).toBeGreaterThan(0);
            expect(qpReason(low)).toBeGreaterThan(qpReason(standard));
        });

        it('judges undeclared screen share strictly, as low motion', () => {
            const screenShare = qpTrack({ avgQpPerFrame: 36 }, { isScreenShare: true });
            const camera = qpTrack({ avgQpPerFrame: 36 });

            ticks(screenShare, 1);
            ticks(camera, 1);

            // 36 is under the standard activation of 40 but over lowmotion's 32
            expect(qpReason(camera)).toBeUndefined();
            expect(qpReason(screenShare)).toBeGreaterThan(0);
        });

        it('lets an explicit motion type override the screen-share default', () => {
            const screenShare = qpTrack({ avgQpPerFrame: 36 }, { isScreenShare: true, motionType: 'standard' });

            ticks(screenShare, 1);

            expect(qpReason(screenShare)).toBeUndefined();
        });

        it('keeps every band inside its codec QP range', () => {
            // H.264 tops out at 51: a band reaching past it could never saturate.
            for (const [codec, bands] of Object.entries(VIDEO_QP_THRESHOLDS)) {
                const max = codec === 'h264' || codec === 'h265' ? 51 : codec === 'vp8' ? 127 : 255;

                for (const band of Object.values(bands!)) {
                    expect(band.activation).toBeLessThan(band.saturation);
                    expect(band.saturation).toBeLessThanOrEqual(max);
                }
            }
        });

        it('honours retuned thresholds', () => {
            const original = VIDEO_QP_THRESHOLDS.vp8!.highmotion;

            VIDEO_QP_THRESHOLDS.vp8!.highmotion = { activation: 100, saturation: 120 };
            try {
                const track = qpTrack({ avgQpPerFrame: 90 }, { motionType: 'highmotion' });

                ticks(track, 1);

                expect(qpReason(track)).toBeUndefined();
            } finally {
                VIDEO_QP_THRESHOLDS.vp8!.highmotion = original;
            }
        });

        it('honours retuned QP thresholds', () => {
            const original = VIDEO_QP_THRESHOLDS.vp8;

            VIDEO_QP_THRESHOLDS.vp8 = {
                lowmotion: { activation: 10, saturation: 20 },
                standard: { activation: 10, saturation: 20 },
                highmotion: { activation: 10, saturation: 20 },
            };
            try {
                const track = qpTrack({ avgQpPerFrame: 25 });

                ticks(track, 1);

                expect(qpReason(track)).toBe(1.0);
            } finally {
                VIDEO_QP_THRESHOLDS.vp8 = original;
            }
        });

        it('does not subtract jitter — that belongs to the peer connection', () => {
            // Same rule as loss: jitter is a path property. What it does to the
            // picture is measured as freezes, volatile fps and dropped frames.
            const jittery = createVideoTrackMock({ jitter: 0.04 });
            const saturated = createVideoTrackMock({ jitter: 0.25 });

            ticks(jittery, 1);
            ticks(saturated, 1);

            expect((jittery.calculatedScore as any).reasons['high-jitter']).toBeUndefined();
            expect((saturated.calculatedScore as any).reasons['high-jitter']).toBeUndefined();
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
