/* eslint-disable @typescript-eslint/no-explicit-any */
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { SliceConfig, SlicedWindow } from "../../src/utils/SlicedWindow";
import type { ClientWindowValues } from "../../src/ClientMonitor";
import { CpuPerformanceDetector } from "../../src/detectors/CpuPerformanceDetector";
import { runsOffCpu } from "../../src/utils/runsOffCpu";

// ---------------------------------------------------------------------------
// Test types & mocks
// ---------------------------------------------------------------------------

interface CpuConfig {
    utilizationThreshold: number;
    recoveryThreshold: number;
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

/**
 * A sending video stream. `utilization` is the share of each collection it spends encoding, which
 * the harness turns into that collection's codec time. `undefined` models a stream that reported
 * no codec time at all. The detector never sees this field — only the totals it accumulates into,
 * and the stream's own kind and implementation.
 */
interface MockOutboundRtp {
    kind: 'audio' | 'video';
    utilization?: number;
    encoderImplementation?: string;
    powerEfficientEncoder?: boolean;
}

interface MockInboundRtp {
    kind: 'audio' | 'video';
    utilization?: number;
    decoderImplementation?: string;
    powerEfficientDecoder?: boolean;
}

/** Two values a stretch, the smallest the window allows, so a test raises in two collections. */
const DETECTION_SAMPLES = 2;

class MockClientMonitor {
    public config: { cpuPerformanceDetector: CpuConfig | null } = {
        cpuPerformanceDetector: {
            utilizationThreshold: 0.15,
            recoveryThreshold: 0.15,
        },
    };

    public cpuPerformanceAlertOn = false;
    public cpuUtilization?: number;
    /** What `ClientMonitor` sums off the peer connections; the harness advances them by hand. */
    public totalVideoEncodeTimeInMs?: number;
    public totalVideoDecodeTimeInMs?: number;
    public activeTab = true;
    public outboundRtps: MockOutboundRtp[] = [];
    public inboundRtps: MockInboundRtp[] = [];

    /** The window the detector reads, built as `ClientMonitor` builds it. */
    public readonly slicedWindow = new SlicedWindow<
        ClientWindowValues,
        Record<'detection' | 'recovery', SliceConfig>
    >({
        maxAllowedGapInMs: 8000,
        totals: { totalVideoEncodeTimeInMs: null, totalVideoDecodeTimeInMs: null },
        slices: {
            detection: { numberOfSamples: DETECTION_SAMPLES },
            recovery: { numberOfSamples: DETECTION_SAMPLES, offset: DETECTION_SAMPLES },
        },
    });

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

/** Stats time per collection. One second, so a utilization reads straight off the clock. */
const COLLECTION_IN_MS = 1000;

/**
 * A sending video stream at the given utilization: `0.2` spends a fifth of every collection
 * encoding. Software by default — the captured session was `libvpx` on every one of 4811 samples.
 */
function encoding(utilization: number): MockOutboundRtp {
    return {
        kind: 'video',
        utilization,
        encoderImplementation: 'libvpx',
        powerEfficientEncoder: false,
    };
}

/** A receiving video stream at the given utilization, software by default. */
function decoding(utilization: number): MockInboundRtp {
    return {
        kind: 'video',
        utilization,
        decoderImplementation: 'libvpx',
        powerEfficientDecoder: false,
    };
}

describe('CpuPerformanceDetector', () => {
    let detector: CpuPerformanceDetector;
    let monitor: MockClientMonitor;
    let now: number;

    beforeEach(() => {
        monitor = new MockClientMonitor();
        now = 1_700_000_000_000;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new CpuPerformanceDetector(monitor as any);
    });

    /**
     * One collection, as the library takes one: each stream's codec time for *this* stretch is
     * summed — off-CPU streams left out as the sum is taken — the running totals are advanced by
     * that sum, the window is fed from them, and the detector has its look.
     *
     * Deltas rather than the streams' own counters, which is what makes a stream appearing or
     * disappearing mid-call a change of what is being measured rather than a step in the total.
     *
     * Nothing is fed while the tab is backgrounded, which is what leaves the gap the window's own
     * guard trips on.
     */
    function collect(times = 1, elapsedInMs = COLLECTION_IN_MS) {
        for (let i = 0; i < times; ++i) {
            now += elapsedInMs;

            let deltaEncodeInMs: number | undefined;
            let deltaDecodeInMs: number | undefined;

            for (const rtp of monitor.outboundRtps) {
                if (rtp.kind !== 'video' || rtp.utilization === undefined) continue;
                if (runsOffCpu(rtp.encoderImplementation, rtp.powerEfficientEncoder)) continue;
                deltaEncodeInMs = (deltaEncodeInMs ?? 0) + rtp.utilization * elapsedInMs;
            }
            for (const rtp of monitor.inboundRtps) {
                if (rtp.kind !== 'video' || rtp.utilization === undefined) continue;
                if (runsOffCpu(rtp.decoderImplementation, rtp.powerEfficientDecoder)) continue;
                deltaDecodeInMs = (deltaDecodeInMs ?? 0) + rtp.utilization * elapsedInMs;
            }

            if (deltaEncodeInMs !== undefined) {
                monitor.totalVideoEncodeTimeInMs = (monitor.totalVideoEncodeTimeInMs ?? 0) + deltaEncodeInMs;
            }
            if (deltaDecodeInMs !== undefined) {
                monitor.totalVideoDecodeTimeInMs = (monitor.totalVideoDecodeTimeInMs ?? 0) + deltaDecodeInMs;
            }

            if (monitor.activeTab) {
                monitor.slicedWindow.add({
                    timestamp: now,
                    value: {
                        totalVideoEncodeTimeInMs: monitor.totalVideoEncodeTimeInMs ?? null,
                        totalVideoDecodeTimeInMs: monitor.totalVideoDecodeTimeInMs ?? null,
                    },
                });
            }

            detector.update();
        }
    }

    /** Enough collections for the detection slice to fill and the finding to be raised. */
    const TO_RAISE = DETECTION_SAMPLES;

    /**
     * Enough for the busy values to have left the detection slice *and* the recovery slice behind
     * it, which is what the finding is held open on.
     */
    const TO_CLEAR = DETECTION_SAMPLES * 2;

    /** Puts the detector in the alerting state, so a test can watch it come back out. */
    function raiseAlert() {
        monitor.outboundRtps = [encoding(0.6)];
        monitor.inboundRtps = [decoding(0.5)];
        collect(TO_RAISE);
        expect(monitor.cpuPerformanceAlertOn).toBe(true);
    }

    /** Drops the load right down and runs long enough for the finding to be cleared. */
    function goQuiet(collections = TO_CLEAR) {
        monitor.outboundRtps = [encoding(0.01)];
        monitor.inboundRtps = [decoding(0.01)];
        collect(collections);
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

    /**
     * Utilization swings collection to collection with whatever the encoder happens to be doing,
     * so a single reading over the bar says nothing. The window is what separates a busy moment
     * from a machine out of headroom, and it guards the way out as well as the way in.
     */
    describe('the detection window', () => {
        it('says nothing until the window has filled', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];

            collect(1);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('raises on the collection that fills it', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];

            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(monitor.getIssues()).toHaveLength(1);
        });

        /** One busy collection inside an otherwise quiet stretch averages away, as it should. */
        it('does not raise on a single busy collection', () => {
            monitor.outboundRtps = [encoding(0.01)];
            monitor.inboundRtps = [decoding(0.01)];
            collect(2);

            monitor.outboundRtps[0].utilization = 0.6;
            monitor.inboundRtps[0].utilization = 0.5;
            collect(1);

            monitor.outboundRtps[0].utilization = 0.01;
            monitor.inboundRtps[0].utilization = 0.01;
            collect(1);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('reports the stretch the reading was taken over', () => {
            raiseAlert();

            expect(monitor.getIssues()[0].payload.sustainedForInMs)
                .toBe((DETECTION_SAMPLES - 1) * COLLECTION_IN_MS);
        });

        /**
         * The totals are built from per-collection deltas, so a stream that joins brings only
         * what it does from then on. Summing the streams' own lifetime counters instead would
         * step the total the moment it appeared and read as a burst of work that never happened.
         */
        it('does not step the reading when a stream joins mid-window', () => {
            monitor.outboundRtps = [encoding(0.1)];
            monitor.inboundRtps = [decoding(0.1)];
            // A layer that has been encoding elsewhere for a while before this window sees it.
            collect(6);

            monitor.outboundRtps.push(encoding(0.1));
            collect(TO_RAISE);

            expect(monitor.cpuUtilization).toBeCloseTo(0.1, 6);
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        /** A window that filled with collections carrying no time between them measured nothing. */
        it('does not judge a window that spans no time', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];

            collect(TO_RAISE, 0);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });
    });

    /**
     * The recovery slice sits behind the detection slice, so clearing asks whether the machine was
     * quiet across that stretch too — the finding cannot be cleared on the same values that raised
     * it, and it stands long enough to be worth reporting.
     */
    describe('the recovery window', () => {
        it('holds the finding while the busy stretch is still behind it', () => {
            raiseAlert();

            goQuiet(1);

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });

        it('clears once both stretches are quiet', () => {
            raiseAlert();

            goQuiet();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('honours a recovery threshold under the raise threshold', () => {
            monitor.config.cpuPerformanceDetector = {
                utilizationThreshold: 0.5,
                recoveryThreshold: 0.2,
            };

            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.6)];
            collect(TO_RAISE);
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            // Under the raise bar but not under the recovery bar: still a finding.
            monitor.outboundRtps[0].utilization = 0.3;
            monitor.inboundRtps[0].utilization = 0.3;
            collect(TO_CLEAR);

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });

    describe('disabled', () => {
        it('does nothing while disabled, even with both codecs saturated', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);
            detector.disabled = true;

            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.9)];

            collect(TO_RAISE);

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

            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(eventSpy).not.toHaveBeenCalled();
        });

        it('resolves an open alert when the tab goes to the background', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.activeTab = false;

            collect(1);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(resolvedSpy.mock.calls[0][0].comment).toBe('tab in background');
        });
    });

    describe('the continuous measurement', () => {
        it('is published well below the threshold', () => {
            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.04)];

            collect(TO_RAISE);

            expect(monitor.cpuUtilization).toBeCloseTo(0.04, 6);
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('is published while the alert is on too', () => {
            raiseAlert();

            expect(monitor.cpuUtilization).toBeCloseTo(0.5, 6);
        });

        it('is blanked in a background tab, where nothing was measured', () => {
            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];
            collect(TO_RAISE);
            expect(monitor.cpuUtilization).toBeDefined();

            monitor.activeTab = false;
            collect(1);

            expect(monitor.cpuUtilization).toBeUndefined();
        });

        it('is blanked when no video is encoded or decoded on the cpu', () => {
            monitor.outboundRtps = [];
            monitor.inboundRtps = [];

            collect(TO_RAISE);

            expect(monitor.cpuUtilization).toBeUndefined();
        });
    });

    describe('the two utilizations', () => {
        it('alerts when both halves of the pipeline are past the threshold', () => {
            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3)];

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
            expect(payload.minUtilization).toBeCloseTo(0.3, 6);
        });

        it('stays quiet when only the encoder is busy', () => {
            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.02)];

            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('stays quiet when only the decoder is busy', () => {
            monitor.outboundRtps = [encoding(0.02)];
            monitor.inboundRtps = [decoding(0.9)];

            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('scores the lower of the two', () => {
            monitor.outboundRtps = [encoding(0.8)];
            monitor.inboundRtps = [decoding(0.2)];

            collect(TO_RAISE);

            expect(monitor.getIssues()[0].payload.minUtilization).toBeCloseTo(0.2, 6);
        });

        it('alerts at the threshold and not a hair under it', () => {
            monitor.outboundRtps = [encoding(0.15)];
            monitor.inboundRtps = [decoding(0.15)];
            collect(TO_RAISE);
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            monitor = new MockClientMonitor();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            detector = new CpuPerformanceDetector(monitor as any);
            monitor.outboundRtps = [encoding(0.149)];
            monitor.inboundRtps = [decoding(0.149)];
            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });
    });

    describe('summing across streams', () => {
        /**
         * Three simulcast layers at a fifth of the stretch each cost the machine the same
         * as one stream at three fifths, so the utilizations add rather than average.
         */
        it('adds the encoders together', () => {
            monitor.outboundRtps = [encoding(0.2), encoding(0.2), encoding(0.2)];
            monitor.inboundRtps = [decoding(0.5)];

            collect(TO_RAISE);

            expect(monitor.getIssues()[0].payload.encoderUtilization).toBeCloseTo(0.6, 6);
        });

        it('adds the decoders together', () => {
            monitor.outboundRtps = [encoding(0.9)];
            monitor.inboundRtps = [decoding(0.1), decoding(0.1), decoding(0.1)];

            collect(TO_RAISE);

            expect(monitor.getIssues()[0].payload.decoderUtilization).toBeCloseTo(0.3, 6);
        });

        it('ignores audio streams on both sides', () => {
            monitor.outboundRtps = [
                encoding(0.4),
                { kind: 'audio', utilization: 0.9 },
            ];
            monitor.inboundRtps = [
                decoding(0.3),
                { kind: 'audio', utilization: 0.9 },
            ];

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
        });

        /**
         * The denominator is the stretch the window spans, not a sum of per-stream intervals, so
         * adding a stream raises the reading instead of averaging it back down.
         */
        it('measures the sum against the stretch the window spans', () => {
            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3)];

            collect(TO_RAISE, 500);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
        });

        it('skips streams that reported no codec time', () => {
            monitor.outboundRtps = [encoding(0.4), { kind: 'video', encoderImplementation: 'libvpx' }];
            monitor.inboundRtps = [decoding(0.3)];

            collect(TO_RAISE);

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

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.hardwareAcceleratedEncoders).toBe(1);
        });

        it('leaves a hardware decoder out of the sum', () => {
            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3), hardwareDecoding(0.9, 'VaapiVideoDecodeAccelerator')];

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.decoderUtilization).toBeCloseTo(0.3, 6);
            expect(payload.hardwareAcceleratedDecoders).toBe(1);
        });

        it('leaves out a stream the browser calls power efficient whatever its name', () => {
            monitor.outboundRtps = [
                encoding(0.4),
                { ...encoding(0.9), encoderImplementation: 'libvpx', powerEfficientEncoder: true },
            ];
            monitor.inboundRtps = [decoding(0.3)];

            collect(TO_RAISE);

            expect(monitor.getIssues()[0].payload.encoderUtilization).toBeCloseTo(0.4, 6);
        });

        it('counts an unrecognised implementation as cpu work', () => {
            monitor.outboundRtps = [{ ...encoding(0.4), encoderImplementation: 'SomeVendorThing' }];
            monitor.inboundRtps = [decoding(0.3)];

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.4, 6);
            expect(payload.hardwareAcceleratedEncoders).toBe(0);
        });

        it('goes blind rather than healthy when the whole pipeline is hardware', () => {
            monitor.outboundRtps = [hardwareEncoding(0.9, 'MediaFoundationVideoEncodeAccelerator')];
            monitor.inboundRtps = [hardwareDecoding(0.9, 'VaapiVideoDecodeAccelerator')];

            collect(TO_RAISE);

            expect(detector.inputsUnavailable).toBe(true);
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('resolves an open alert with the hardware reason when the codecs switch', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.outboundRtps = [hardwareEncoding(0.9, 'ExternalEncoder')];
            monitor.inboundRtps = [hardwareDecoding(0.9, 'ExternalDecoder')];

            collect(TO_RAISE);

            expect(resolvedSpy.mock.calls[0][0].comment).toBe('all video is encoded and decoded off the cpu');
        });

        /** A hardware encoder alongside a software decoder still leaves one usable clue. */
        it('judges the remaining side when only one half is hardware', () => {
            monitor.outboundRtps = [hardwareEncoding(0.9, 'VideoToolbox')];
            monitor.inboundRtps = [decoding(0.4)];

            collect(TO_RAISE);

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

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.minUtilization).toBeCloseTo(0.4, 6);
            expect(payload.decoderUtilization).toBeUndefined();
        });

        it('judges a receive-only client on the decoder alone', () => {
            monitor.outboundRtps = [];
            monitor.inboundRtps = [decoding(0.4)];

            collect(TO_RAISE);

            const payload = monitor.getIssues()[0].payload;

            expect(payload.minUtilization).toBeCloseTo(0.4, 6);
            expect(payload.encoderUtilization).toBe(0);
        });

        /** Audio-only streams on both sides leave nothing to measure, which is not the same as idle. */
        it('reports inputs unavailable with no video at all', () => {
            monitor.outboundRtps = [{ kind: 'audio', utilization: 0.5 }];
            monitor.inboundRtps = [{ kind: 'audio', utilization: 0.5 }];

            collect(TO_RAISE);

            expect(detector.inputsUnavailable).toBe(true);
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('resolves an open alert when the video goes away', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);
            monitor.outboundRtps = [];
            monitor.inboundRtps = [];

            collect(TO_RAISE);

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

            collect(TO_RAISE + 3);

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(monitor.getIssues()).toHaveLength(1);
        });

        it('resolves once the load drops back under the threshold', () => {
            raiseAlert();

            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            goQuiet();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(resolvedSpy.mock.calls[0][0].comment).toBe('cpu limitation ended');
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('does not resolve repeatedly on a machine that was never loaded', () => {
            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            goQuiet();

            expect(resolvedSpy).not.toHaveBeenCalled();
        });

        it('can alert again after resolving', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            raiseAlert();
            goQuiet();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);

            monitor.outboundRtps = [encoding(0.6)];
            monitor.inboundRtps = [decoding(0.5)];
            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(eventSpy).toHaveBeenCalledTimes(2);
        });

        /**
         * The reading that raised the finding and the one that cleared it, side by side, so
         * whoever reads the resolved issue can see the improvement rather than only that
         * something stopped.
         */
        it('carries the raise and the recovery onto the resolved issue', () => {
            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            raiseAlert();
            goQuiet();

            const payload = resolvedSpy.mock.calls[0][0].payload;

            expect(payload.encoderUtilization).toBeCloseTo(0.6, 6);
            expect(payload.decoderUtilization).toBeCloseTo(0.5, 6);
            expect(payload.minUtilization).toBeCloseTo(0.5, 6);
            expect(payload.recoveredMinUtilization).toBeCloseTo(0.01, 6);
            expect(payload.durationInMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('the config', () => {
        it('honours a raised threshold', () => {
            monitor.config.cpuPerformanceDetector = {
                utilizationThreshold: 0.5,
                recoveryThreshold: 0.5,
            };

            monitor.outboundRtps = [encoding(0.4)];
            monitor.inboundRtps = [decoding(0.3)];

            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('honours a lowered threshold', () => {
            monitor.config.cpuPerformanceDetector = {
                utilizationThreshold: 0.02,
                recoveryThreshold: 0.02,
            };

            monitor.outboundRtps = [encoding(0.05)];
            monitor.inboundRtps = [decoding(0.03)];

            collect(TO_RAISE);

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });
});
