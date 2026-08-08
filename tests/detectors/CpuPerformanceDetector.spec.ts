import { CpuPerformanceDetector } from "../../src/detectors/CpuPerformanceDetector";

// ---------------------------------------------------------------------------
// Test types & mocks
// ---------------------------------------------------------------------------

interface IncomingDecodedFramesRatioThresholds {
    alertOn: number;
    alertOff: number;
    minReceivedFrames: number;
}

interface DurationOfCollectingStatsThreshold {
    lowWatermark: number;
    highWatermark: number;
}

interface CpuConfig {
    incomingDecodedFramesRatioThresholds?: IncomingDecodedFramesRatioThresholds;
    durationOfCollectingStatsThreshold?: DurationOfCollectingStatsThreshold;
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
    qualityLimitationReason?: string;
}

interface MockInboundRtp {
    kind: 'audio' | 'video';
    deltaFramesReceived?: number;
    deltaFramesDecoded?: number;
}

class MockClientMonitor {
    public config: { cpuPerformanceDetector: CpuConfig | null } = {
        cpuPerformanceDetector: {
            incomingDecodedFramesRatioThresholds: {
                alertOn: 0.7,
                alertOff: 0.85,
                minReceivedFrames: 10,
            },
            durationOfCollectingStatsThreshold: {
                lowWatermark: 5000,
                highWatermark: 10000,
            },
        },
    };

    public cpuPerformanceAlertOn = false;
    public durationOfCollectingStatsInMs = 0;
    public outboundRtps: MockOutboundRtp[] = [];
    public inboundRtps: MockInboundRtp[] = [];

    public readonly activeIssues = new Map<string, TestIssue>();
    private eventHandlers: { [key: string]: EventHandler[] } = {};
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        (this.eventHandlers[eventName] || []).forEach(h => h(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        (this.eventHandlers[eventName] ??= []).push(handler);
    }

    raiseIssue(key: string, input: { type: string; payload?: Record<string, unknown> }) {
        const existing = this.activeIssues.get(key);
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
        this.activeIssues.set(key, issue);
        this.emit('issue', issue as unknown as Record<string, unknown>);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown>; resolvedAt?: number }) {
        const found = this.activeIssues.get(key);
        if (!found) return undefined;
        this.activeIssues.delete(key);
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
        return [...this.activeIssues.values()];
    }
}

// Convenience helpers ------------------------------------------------------

function videoInbound(received: number, decoded: number): MockInboundRtp {
    return { kind: 'video', deltaFramesReceived: received, deltaFramesDecoded: decoded };
}

function audioInbound(received: number, decoded: number): MockInboundRtp {
    return { kind: 'audio', deltaFramesReceived: received, deltaFramesDecoded: decoded };
}

describe('CpuPerformanceDetector', () => {
    let detector: CpuPerformanceDetector;
    let monitor: MockClientMonitor;

    beforeEach(() => {
        monitor = new MockClientMonitor();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new CpuPerformanceDetector(monitor as any);
    });

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
        it('does nothing while disabled, even with a clear CPU signal', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);
            detector.disabled = true;

            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            monitor.inboundRtps = [videoInbound(100, 10)];

            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(eventSpy).not.toHaveBeenCalled();
            expect(monitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Outbound RTP quality limitation', () => {
        it('alerts when an outbound stream is CPU limited', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ clientMonitor: monitor }));
            expect(monitor.getIssues()).toHaveLength(1);
            expect(monitor.getIssues()[0]).toMatchObject({ type: 'cpulimitation' });
        });

        it('does not alert for bandwidth or none limitation reasons', () => {
            monitor.outboundRtps = [
                { qualityLimitationReason: 'bandwidth' },
                { qualityLimitationReason: 'none' },
                { qualityLimitationReason: 'other' },
            ];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('alerts if any one of several outbound streams is CPU limited', () => {
            monitor.outboundRtps = [
                { qualityLimitationReason: 'none' },
                { qualityLimitationReason: 'bandwidth' },
                { qualityLimitationReason: 'cpu' },
            ];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });

    describe('Inbound decoded/received frames ratio', () => {
        it('alerts when the decoded ratio is at or below alertOn (decoder falling behind)', () => {
            // 50 / 100 = 0.5 <= 0.7
            monitor.inboundRtps = [videoInbound(100, 50)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(monitor.getIssues()).toHaveLength(1);
        });

        it('does not alert when the decoder keeps up (ratio above alertOn)', () => {
            // 90 / 100 = 0.9 > 0.7
            monitor.inboundRtps = [videoInbound(100, 90)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('treats the alertOn boundary as triggering (ratio === alertOn)', () => {
            // 70 / 100 = 0.7, and the check is `<= alertOn`
            monitor.inboundRtps = [videoInbound(100, 70)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });

        it('ignores audio tracks even with a terrible ratio', () => {
            monitor.inboundRtps = [audioInbound(100, 0)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('clamps the ratio to 1.0 when decoded exceeds received (counter timing)', () => {
            // decoded > received would be ratio 1.2 -> clamped to 1.0 -> no alert
            monitor.inboundRtps = [videoInbound(100, 120)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('alerts if any one of several video tracks is decode-limited', () => {
            monitor.inboundRtps = [
                videoInbound(100, 95),
                videoInbound(100, 30), // 0.3 <= 0.7
            ];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });

    describe('minReceivedFrames guard (screen-share regression)', () => {
        it('skips intervals with fewer than minReceivedFrames received frames', () => {
            // Only 5 frames received this interval, 0 decoded -> ratio 0 but below the
            // 10-frame guard, so it must NOT alert.
            monitor.inboundRtps = [videoInbound(5, 0)];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('does not raise a false CPU alert when screen-share fps legitimately collapses 15 -> 1', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            // Simulate a screen share whose frame rate swings as content goes
            // static. Received and decoded stay equal each interval (decoder keeps
            // up); low-frame intervals fall under the guard. None should alert.
            const intervals: Array<[number, number]> = [
                [15, 15], [12, 12], [3, 3], [1, 1], [1, 1], [2, 2], [8, 8], [1, 1],
            ];
            for (const [received, decoded] of intervals) {
                monitor.inboundRtps = [videoInbound(received, decoded)];
                detector.update();
            }

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(eventSpy).not.toHaveBeenCalled();
            expect(monitor.getIssues()).toHaveLength(0);
        });

        it('treats minReceivedFrames as 0 when omitted (still evaluates the ratio)', () => {
            monitor.config.cpuPerformanceDetector!.incomingDecodedFramesRatioThresholds = {
                alertOn: 0.7,
                alertOff: 0.85,
                // @ts-expect-error intentionally omitted to test the `?? 0` fallback
                minReceivedFrames: undefined,
            };
            monitor.inboundRtps = [videoInbound(4, 1)]; // 0.25, would be skipped if min was 10
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });

    describe('Hysteresis', () => {
        it('stays alerting while the ratio is between alertOff and alertOn', () => {
            // Trigger first.
            monitor.inboundRtps = [videoInbound(100, 50)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            // 0.8 is below alertOff (0.85) but above alertOn (0.7): stay alerting.
            monitor.inboundRtps = [videoInbound(100, 80)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });

        it('clears only once the ratio recovers to alertOff or above', () => {
            monitor.inboundRtps = [videoInbound(100, 50)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            // 0.9 >= 0.85 -> recovered.
            monitor.inboundRtps = [videoInbound(100, 90)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('does not flap: a single mid-band reading keeps the alert on', () => {
            monitor.inboundRtps = [videoInbound(100, 40)];
            detector.update();
            // 0.84 < alertOff -> still limited
            monitor.inboundRtps = [videoInbound(100, 84)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });
    });

    describe('Stats collection duration', () => {
        beforeEach(() => {
            // Isolate this signal: no inbound/outbound contributions.
            monitor.outboundRtps = [];
            monitor.inboundRtps = [];
        });

        it('alerts when collection duration exceeds the high watermark', () => {
            monitor.durationOfCollectingStatsInMs = 12000; // > 10000
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });

        it('does not alert below the high watermark', () => {
            monitor.durationOfCollectingStatsInMs = 8000; // < 10000
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('keeps the alert while duration stays above the low watermark (hysteresis)', () => {
            monitor.durationOfCollectingStatsInMs = 12000;
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            monitor.durationOfCollectingStatsInMs = 7000; // between low (5000) and high (10000)
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);
        });

        it('clears once duration drops below the low watermark', () => {
            monitor.durationOfCollectingStatsInMs = 12000;
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            monitor.durationOfCollectingStatsInMs = 4000; // < 5000
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });
    });

    describe('Issue lifecycle', () => {
        it('raises the issue and emits the event only once per episode', () => {
            const eventSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);

            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            detector.update();
            detector.update();
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(monitor.getIssues()).toHaveLength(1);
        });

        it('resolves the issue and emits issue-resolved when the limitation clears', () => {
            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            detector.update();
            expect(monitor.getIssues()).toHaveLength(1);

            monitor.outboundRtps = [{ qualityLimitationReason: 'none' }];
            detector.update();

            expect(monitor.cpuPerformanceAlertOn).toBe(false);
            expect(monitor.getIssues()).toHaveLength(0);
            expect(resolvedSpy).toHaveBeenCalledTimes(1);
            expect(resolvedSpy.mock.calls[0][0]).toMatchObject({
                type: 'cpulimitation',
                comment: 'cpu limitation ended',
            });
        });

        it('includes a non-negative durationInMs in the resolved payload', () => {
            const resolvedSpy = jest.fn();
            monitor.on('issue-resolved', resolvedSpy);

            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            detector.update();

            monitor.outboundRtps = [{ qualityLimitationReason: 'none' }];
            detector.update();

            const payload = resolvedSpy.mock.calls[0][0].payload as { durationInMs?: number };
            expect(typeof payload.durationInMs).toBe('number');
            expect(payload.durationInMs).toBeGreaterThanOrEqual(0);
        });

        it('does nothing when already clear and still clear', () => {
            const eventSpy = jest.fn();
            const resolvedSpy = jest.fn();
            monitor.on('cpulimitation', eventSpy);
            monitor.on('issue-resolved', resolvedSpy);

            monitor.outboundRtps = [{ qualityLimitationReason: 'none' }];
            detector.update();

            expect(eventSpy).not.toHaveBeenCalled();
            expect(resolvedSpy).not.toHaveBeenCalled();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });
    });

    describe('Combined signals', () => {
        it('a recovered inbound ratio does not clear the alert while outbound is still CPU limited', () => {
            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            monitor.inboundRtps = [videoInbound(100, 95)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            // Inbound is fine now, but outbound remains CPU-limited.
            monitor.inboundRtps = [videoInbound(100, 99)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);
            expect(monitor.getIssues()).toHaveLength(1);
        });

        it('clears only when every signal is healthy', () => {
            monitor.outboundRtps = [{ qualityLimitationReason: 'cpu' }];
            monitor.durationOfCollectingStatsInMs = 12000;
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(true);

            monitor.outboundRtps = [{ qualityLimitationReason: 'none' }];
            monitor.durationOfCollectingStatsInMs = 1000;
            monitor.inboundRtps = [videoInbound(100, 100)];
            detector.update();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });
    });

    describe('Config edge cases', () => {
        it('skips the inbound ratio analysis when thresholds are not configured', () => {
            monitor.config.cpuPerformanceDetector!.incomingDecodedFramesRatioThresholds = undefined;
            monitor.inboundRtps = [videoInbound(100, 0)]; // would alert if evaluated

            expect(() => detector.update()).not.toThrow();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });

        it('skips the duration analysis when the threshold is not configured', () => {
            monitor.config.cpuPerformanceDetector!.durationOfCollectingStatsThreshold = undefined;
            monitor.durationOfCollectingStatsInMs = 999999;

            expect(() => detector.update()).not.toThrow();
            expect(monitor.cpuPerformanceAlertOn).toBe(false);
        });
    });
});
