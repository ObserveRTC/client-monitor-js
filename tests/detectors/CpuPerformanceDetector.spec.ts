/* eslint-disable @typescript-eslint/no-explicit-any */
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { CpuPerformanceDetector } from "../../src/detectors/CpuPerformanceDetector";

// ---------------------------------------------------------------------------
// Test types & mocks
// ---------------------------------------------------------------------------

interface CpuConfig {
    utilizationThreshold: number;
}

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

interface EventHandler {
    (event: Record<string, unknown>): void;
}

interface MockOutboundRtp {
    kind: 'audio' | 'video';
    deltaEncodeTime?: number;
    deltaTime?: number;
    encoderImplementation?: string;
    powerEfficientEncoder?: boolean;
}

interface MockInboundRtp {
    kind: 'audio' | 'video';
    deltaTotalDecodeTime?: number;
    deltaTime?: number;
    decoderImplementation?: string;
    powerEfficientDecoder?: boolean;
}

class MockClientMonitor {
    public config: { cpuPerformanceDetector: CpuConfig | null } = {
        cpuPerformanceDetector: {
            utilizationThreshold: 0.15,
        },
    };

    public cpuPerformanceAlertOn = false;
    public activeTab = true;
    public outboundRtps: MockOutboundRtp[] = [];
    public inboundRtps: MockInboundRtp[] = [];

    /**
     * The store the assertions read. `activeIssues` below is the real registry the detector
     * writes through; this map is what its sink lands in, so `getIssues()` keeps working.
     */
    private readonly _store = new Map<string, TestIssue>();

    /** The terminal registry, as `ClientMonitor` owns it. */
    public readonly activeIssues = new IssueRegistry({
        notify: (issue: any) => { this.raiseIssue(issue.type, issue); },
        raise: (issue: any) => { this.raiseIssue(issue.key, issue); },
        update: (issue: any) => { this.raiseIssue(issue.key, issue); },
        resolve: (issue: any) => { this.resolveIssue(issue.key, issue); },
    });
    private eventHandlers: { [key: string]: EventHandler[] } = {};
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        (this.eventHandlers[eventName] || []).forEach(h => h(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        (this.eventHandlers[eventName] ??= []).push(handler);
    }

    raiseIssue(key: string, input: { type: string; payload?: Record<string, unknown> }) {
        const existing = this._store.get(key);
        if (existing) {
            existing.payload = input.payload ?? {};
            existing.type = input.type;
            this.emit('issue-updated', existing as unknown as Record<string, unknown>);
            return existing;
        }
        const issue: TestIssue = {
            id: `iss_${this.nextId++}`,
            type: input.type,
            key,
            payload: input.payload ?? {},
        };
        this._store.set(key, issue);
        this.emit('issue', issue as unknown as Record<string, unknown>);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown>; resolvedAt?: number }) {
        const found = this._store.get(key);
        if (!found) return undefined;
        this._store.delete(key);
        const resolved = {
            ...found,
            payload: opts?.payload ?? found.payload,
            resolvedAt: opts?.resolvedAt ?? Date.now(),
            comment: opts?.comment,
        };
        this.emit('issue-resolved', resolved as unknown as Record<string, unknown>);
        return resolved;
    }

    getIssues() {
        return [...this._store.values()];
    }
}

// Convenience helpers ------------------------------------------------------

/** Codec times are seconds in the stats, elapsed time is milliseconds. One second of stats time by default. */
const COLLECTION_IN_MS = 1000;

/**
 * A sending video stream at the given utilization: `0.2` spends a fifth of the interval encoding.
 * Software by default — the captured session was `libvpx` on every one of 4811 samples.
 */
function encoding(utilization: number, elapsedInMs = COLLECTION_IN_MS): MockOutboundRtp {
    return {
        kind: 'video',
        deltaEncodeTime: (utilization * elapsedInMs) / 1000,
        deltaTime: elapsedInMs,
        encoderImplementation: 'libvpx',
        powerEfficientEncoder: false,
    };
}

/** A receiving video stream at the given utilization, software by default. */
function decoding(utilization: number, elapsedInMs = COLLECTION_IN_MS): MockInboundRtp {
    return {
        kind: 'video',
        deltaTotalDecodeTime: (utilization * elapsedInMs) / 1000,
        deltaTime: elapsedInMs,
        decoderImplementation: 'libvpx',
        powerEfficientDecoder: false,
    };
}

describe('CpuPerformanceDetector', () => {
    let detector: CpuPerformanceDetector;
    let monitor: MockClientMonitor;

    beforeEach(() => {
        monitor = new MockClientMonitor();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new CpuPerformanceDetector(monitor as any);
    });

    /** Puts the detector in the alerting state, so a test can watch it come back out. */
    function raiseAlert() {
        monitor.outboundRtps = [encoding(0.6)];
        monitor.inboundRtps = [decoding(0.5)];
        detector.update();
        expect(monitor.cpuPerformanceAlertOn).toBe(true);
    }

    describe('Constructor', () => {
        it('has the correct name', () => {
            expect(detector.name).toBe('cpu-performance-detector');
        });

        it('exposes the issue type constant', () => {
            expect(CpuPerformanceDetector.ISSUE_TYPE).toBe('cpulimitation');
        });

        it('keeps a reference to the client monitor', () => {
            expect(detector.clientMonitor).toBe(monitor);
        });
    });

    describe('disabled', () => {
        it('does nothing while disabled, even with both codecs saturated', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);
            detector.disabled = true;

            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.9)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(eventSpy).not.toHaveBeenCalled();
            expect(monitor.getIssues()).toHaveLength(0);
        });
    });

    describe('background tab', () => {
        it('does not alert while the tab is in the background', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);
            monitor.activeTab = false;

            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.9)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(eventSpy).not.toHaveBeenCalled();
        });

        /**
         * Throttled timers stretch the interval without stretching the codec work, so a
         * backgrounded tab reads as idle anyway. Resolving is about not leaving a stale
         * alert open across a tab switch.
         */
        it('resolves an open alert when the tab goes to the background', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.activeTab = false;

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(resolvedSpy).toHaveBeenCalledTimes(1);
            expect(resolvedSpy.mock.calls[0][0].comment).toBe('tab in background');
        });
    });

    /**
     * The number beside `cpuPerformanceAlertOn`: how occupied the machine was, published on every
     * collection it could be measured rather than only the ones that alert.
     */
    describe('the continuous measurement', () => {
        it('is published well below the threshold', () => {
            monitor.outboundRtps = [encoding(0.10)];
            monitor.inboundRtps = [decoding(0.08)];

            detector.update();

            // The lower of the two, and no alert at all at this level.
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect((monitor as any).cpuUtilization).toBeCloseTo(0.08, 6);
        });

        it('is published while the alert is on too', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect((monitor as any).cpuUtilization).toBeCloseTo(0.5, 6);
        });

        it('is blanked in a background tab, where nothing was measured', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];
            detector.update();
            expect((monitor as any).cpuUtilization).toBeGreaterThan(0);

            monitor.activeTab = false;
            detector.update();

            expect((monitor as any).cpuUtilization).toBeUndefined();
        });

        it('is blanked when no video is encoded or decoded on the cpu', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];
            detector.update();

            monitor.outboundRtps = [];
            monitor.inboundRtps = [];
            detector.update();

            expect((monitor as any).cpuUtilization).toBeUndefined();
        });
    });

    describe('the two utilizations', () => {
        it('alerts when both halves of the pipeline are past the threshold', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(eventSpy).toHaveBeenCalledTimes(1);
        });

        /**
         * The whole point of `min()`: an encoder working hard on an otherwise idle machine
         * is a busy stream, not a busy CPU. Only both at once says the machine is the problem.
         */
        it('stays quiet when only the encoder is busy', () => {
            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.02)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('stays quiet when only the decoder is busy', () => {
            monitor.outboundRtps = [encoding(0.02)];
            monitor.inboundRtps = [decoding(0.9)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('scores the lower of the two', () => {
            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.25)];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.25, 6);
            expect(payload.minUtilization).toBeCloseTo(0.25, 6);
        });

        it('alerts at the threshold and not a hair under it', () => {
            monitor.outboundRtps = [encoding(0.2)];
            monitor.inboundRtps = [decoding(0.1499)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);

            monitor.inboundRtps = [decoding(0.15)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });

    describe('summing across streams', () => {
        /**
         * Three simulcast layers at a fifth of the interval each cost the machine the same
         * as one stream at three fifths, so the utilizations add rather than average.
         */
        it('adds the encoders together', () => {
            monitor.outboundRtps = [encoding(0.2), encoding(0.2), encoding(0.2)];
            monitor.inboundRtps = [decoding(0.5)];

            detector.update();

            expect(monitor.getIssues()[0].payload.encoderUtilization).toBeCloseTo(0.6, 6);
        });

        it('adds the decoders together', () => {
            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.1), decoding(0.1), decoding(0.1)];

            detector.update();

            expect(monitor.getIssues()[0].payload.decoderUtilization).toBeCloseTo(0.3, 6);
        });

        it('ignores audio streams on both sides', () => {
            monitor.outboundRtps = [
                encoding(0.4),
                { kind: 'audio', deltaEncodeTime: 0.9, deltaTime: COLLECTION_IN_MS },
            ];
            monitor.inboundRtps = [
                decoding(0.3),
                { kind: 'audio', deltaTotalDecodeTime: 0.9, deltaTime: COLLECTION_IN_MS },
            ];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
        });

        it('measures each stream against its own elapsed time', () => {
            // Half a second of stats time, a fifth of a second of encoding: 40%.
            monitor.outboundRtps = [encoding(0.4, 500)];
            monitor.inboundRtps = [decoding(0.3, 2000)];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
        });

        it('skips streams with no elapsed time rather than dividing by zero', () => {
            monitor.outboundRtps = [encoding(0.4), { kind: 'video', deltaEncodeTime: 0.5, deltaTime: 0 }];
            monitor.inboundRtps = [decoding(0.3)];

            detector.update();

            expect(monitor.getIssues()[0].payload.encoderUtilization).toBeCloseTo(0.4, 6);
        });

        it('skips streams that reported no codec time', () => {
            monitor.outboundRtps = [encoding(0.4), { kind: 'video', deltaTime: COLLECTION_IN_MS }];
            monitor.inboundRtps = [decoding(0.3)];

            detector.update();

            expect(monitor.getIssues()[0].payload.encoderUtilization).toBeCloseTo(0.4, 6);
        });
    });

    /**
     * `totalEncodeTime` and `totalDecodeTime` measure elapsed time inside the codec call, not CPU
     * time, so a hardware codec waiting on the GPU would read as a busy processor. This is the
     * gate that keeps a detector named for the CPU from reporting on silicon that isn't it.
     */
    describe('hardware acceleration', () => {
        const hardwareEncoding = (utilization: number, implementation: string): MockOutboundRtp =>
            ({ ...encoding(utilization), encoderImplementation: implementation });
        const hardwareDecoding = (utilization: number, implementation: string): MockInboundRtp =>
            ({ ...decoding(utilization), decoderImplementation: implementation });

        it.each([
            ['MediaFoundationVideoEncodeAccelerator'],
            ['VaapiVideoEncodeAccelerator'],
            ['V4L2VideoEncodeAccelerator'],
            ['ExternalEncoder'],
            ['VideoToolbox'],
            // Matched case-insensitively, so casing drift in a vendor string cannot slip through.
            ['nvenc h264'],
        ])('leaves a %s encoder out of the sum', (implementation) => {
            monitor.outboundRtps = [encoding(0.4), hardwareEncoding(0.9, implementation)];
            monitor.inboundRtps = [decoding(0.3)];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.hardwareAcceleratedEncoders).toBe(1);
        });

        it('leaves a hardware decoder out of the sum', () => {
            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3), hardwareDecoding(0.9, 'VaapiVideoDecodeAccelerator')];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
            expect(payload.hardwareAcceleratedDecoders).toBe(1);
        });

        /** The name is a blocklist and cannot be complete; the browser's own hint covers the rest. */
        it('leaves out a stream the browser calls power efficient whatever its name', () => {
            monitor.outboundRtps = [
                encoding(0.4),
                { ...encoding(0.9), encoderImplementation: 'SomeUncataloguedEncoder', powerEfficientEncoder: true },
            ];
            monitor.inboundRtps = [decoding(0.3)];

            detector.update();

            expect(monitor.getIssues()[0].payload.encoderUtilization).toBeCloseTo(0.4, 6);
        });

        /**
         * The deliberate direction to fail in: an implementation we do not recognise keeps
         * contributing, rather than silencing the detector on every browser we have not catalogued.
         */
        it('counts an unrecognised implementation as cpu work', () => {
            monitor.outboundRtps = [{ ...encoding(0.4), encoderImplementation: 'SomeNewSoftwareCodec' }];
            monitor.inboundRtps = [{ ...decoding(0.3), decoderImplementation: undefined }];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
            expect(payload.hardwareAcceleratedEncoders).toBe(0);
        });

        /**
         * A wholly hardware client is not a healthy one — it is one whose CPU cost we cannot see.
         * Saying so through `inputsUnavailable` keeps it out of any "machines that were fine" count.
         */
        it('goes blind rather than healthy when the whole pipeline is hardware', () => {
            monitor.outboundRtps = [hardwareEncoding(0.9, 'MediaFoundationVideoEncodeAccelerator')];
            monitor.inboundRtps = [hardwareDecoding(0.9, 'VaapiVideoDecodeAccelerator')];

            detector.update();

            expect(detector.inputsUnavailable).toBe(true);
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('resolves an open alert with the hardware reason when the codecs switch', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.outboundRtps = [hardwareEncoding(0.9, 'ExternalEncoder')];
            monitor.inboundRtps = [hardwareDecoding(0.9, 'ExternalDecoder')];

            detector.update();

            expect(resolvedSpy.mock.calls[0][0].comment).toBe('all video is encoded and decoded off the cpu');
        });

        /** A hardware encoder alongside a software decoder still leaves one usable clue. */
        it('judges the remaining side when only one half is hardware', () => {
            monitor.outboundRtps = [hardwareEncoding(0.9, 'VideoToolbox')];
            monitor.inboundRtps = [decoding(0.4)];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.minUtilization).toBeCloseTo(0.4, 6);
            expect(payload.encoderUtilization).toBe(0);
            expect(payload.hardwareAcceleratedEncoders).toBe(1);
        });
    });

    describe('one-sided clients', () => {
        /** A presenter with nothing on screen has no decoder clue, so the encoder stands alone. */
        it('judges a send-only client on the encoder alone', () => {
            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.minUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeUndefined();
        });

        it('judges a receive-only client on the decoder alone', () => {
            monitor.outboundRtps = [];
            monitor.inboundRtps = [decoding(0.4)];

            detector.update();

            const payload = monitor.getIssues()[0].payload;

            expect(payload.minUtilization).toBeCloseTo(0.4, 6);
            expect(payload.encoderUtilization).toBe(0);
        });

        /** Audio-only streams on both sides leave nothing to measure, which is not the same as idle. */
        it('reports inputs unavailable with no video at all', () => {
            monitor.outboundRtps = [{ kind: 'audio', deltaEncodeTime: 0.5, deltaTime: COLLECTION_IN_MS }];
            monitor.inboundRtps = [{ kind: 'audio', deltaTotalDecodeTime: 0.5, deltaTime: COLLECTION_IN_MS }];

            detector.update();

            expect(detector.inputsUnavailable).toBe(true);
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('resolves an open alert when the video goes away', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.outboundRtps = [];
            monitor.inboundRtps = [];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(resolvedSpy.mock.calls[0][0].comment).toBe('no video is being encoded or decoded');
        });
    });

    describe('the alert lifecycle', () => {
        it('raises one issue and one event for a stretch of limitation', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            monitor.outboundRtps = [encoding(0.5)];
            monitor.inboundRtps = [decoding(0.4)];

            detector.update();
            detector.update();
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(monitor.getIssues()).toHaveLength(1);
        });

        it('resolves once the load drops back under the threshold', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.05)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(resolvedSpy.mock.calls[0][0].comment).toBe('cpu limitation ended');
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('does not resolve repeatedly on a machine that was never loaded', () => {
            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.05)];

            detector.update();
            detector.update();

            expect(resolvedSpy).not.toHaveBeenCalled();
        });

        it('can alert again after resolving', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            raiseAlert();

            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.05)];
            detector.update();

            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(eventSpy).toHaveBeenCalledTimes(2);
        });

        it('carries the utilizations and a duration onto the resolved issue', () => {
            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            raiseAlert();

            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.05)];
            detector.update();

            const payload = resolvedSpy.mock.calls[0][0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.6, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.5, 6);
            expect(payload.durationInMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('the config', () => {
        it('honours a raised threshold', () => {
            monitor.config.cpuPerformanceDetector = { utilizationThreshold: 0.5 };

            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('honours a lowered threshold', () => {
            monitor.config.cpuPerformanceDetector = { utilizationThreshold: 0.02 };

            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.03)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });
});
