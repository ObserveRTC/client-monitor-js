import { DryOutboundTrackDetector } from "../../src/detectors/DryOutboundTrackDetector";

// Types for test mocks
interface DryOutboundTrackConfig {
    disabled: boolean;
    thresholdInMs: number;
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

interface OutboundRtpStats {
    bytesSent?: number;
    deltaBytesSent?: number;
    /**
     * The gap between the two stats reports this delta came from, as
     * `OutboundRtpMonitor` derives it. The dry stretch is measured by accumulating
     * this rather than by reading the wall clock, so the specs below drive it
     * instead of advancing timers.
     */
    deltaTime?: number;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        dryOutboundTrackDetector: {
            disabled: false,
            thresholdInMs: 5000
        } as DryOutboundTrackConfig
    };

    private eventHandlers: { [key: string]: EventHandler[] } = {};
    public readonly activeIssues = new Map<string, TestIssue>();
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        const handlers = this.eventHandlers[eventName] || [];
        handlers.forEach(handler => handler(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        if (!this.eventHandlers[eventName]) {
            this.eventHandlers[eventName] = [];
        }
        this.eventHandlers[eventName].push(handler);
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

    // Compatibility helpers used by the assertions below.
    getIssues() {
        return [...this.activeIssues.values()];
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();

    getPeerConnection() {
        return this;
    }
}

class MockOutboundTrackMonitor {
    public track = {
        id: 'test-track-id',
        muted: false,
        readyState: 'live' as 'live' | 'ended',
    };
    public paused = false;
    private peerConnection = new MockPeerConnectionMonitor();
    private outboundRtps: OutboundRtpStats[] = [];

    getPeerConnection() {
        return this.peerConnection;
    }

    getOutboundRtps() {
        return this.outboundRtps;
    }

    setOutboundRtp(stats: OutboundRtpStats | null) {
        this.outboundRtps = stats ? [stats] : [];
    }
}

describe('DryOutboundTrackDetector', () => {
    let detector: DryOutboundTrackDetector;
    let mockTrackMonitor: MockOutboundTrackMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockTrackMonitor = new MockOutboundTrackMonitor();
        mockClientMonitor = mockTrackMonitor.getPeerConnection().parent as MockClientMonitor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new DryOutboundTrackDetector(mockTrackMonitor as any);
    });

    /** One collection, describing `deltaTime` milliseconds of the sender's own time. */
    const tick = (deltaTime = 0) => {
        const outboundRtp = mockTrackMonitor.getOutboundRtps()[0];

        if (outboundRtp) outboundRtp.deltaTime = deltaTime;

        detector.update();
    };

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('dry-outbound-track-detector');
        });

        it('should store track monitor reference', () => {
            expect(detector.trackMonitor).toBe(mockTrackMonitor);
        });
    });

    describe('update() - Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            tick(6000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if track is sending data', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 1000, deltaBytesSent: 100 });

            tick();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should not fire while the track is paused (e.g. paused mediasoup producer)', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });
            mockTrackMonitor.paused = true;

            tick();
            tick(60000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should not fire while the track is muted', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });
            mockTrackMonitor.track.muted = true;

            tick();
            tick(60000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should not fire while the track is not live', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });
            mockTrackMonitor.track.readyState = 'ended';

            tick();
            tick(60000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Dry track detection', () => {
        it('should trigger dry track detection after threshold duration', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-outbound-track', eventSpy);

            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            tick();
            tick(6000);

            expect(eventSpy).toHaveBeenCalledWith({
                trackMonitor: mockTrackMonitor,
                clientMonitor: mockClientMonitor
            });
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'dry-outbound-track',
                payload: {
                    trackId: 'test-track-id',
                    duration: 6000
                }
            });
        });

        it('should reset the accumulator when the track gets paused mid-count', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            // 3s of dry time on the books
            tick();
            tick(3000);

            // Producer paused - discards the accumulated dry time
            mockTrackMonitor.paused = true;
            tick(3000);

            // Producer resumed, and the new stretch starts from zero
            mockTrackMonitor.paused = false;
            tick();

            // The dry stretches total 7s, but only 4s of them are the current one
            tick(4000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        // A stalled encoder and a main thread too busy to collect on schedule tend to
        // arrive together; on wall-clock elapsed the second was counted as evidence
        // for the first.
        it('should not count wall-clock time the collector spent away', () => {
            jest.useFakeTimers();
            jest.setSystemTime(0);

            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            tick();

            // A minute passes with the collector blocked; the reports it reads when it
            // comes back are only a second apart.
            jest.setSystemTime(60_000);
            tick(1000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            jest.useRealTimers();
        });

        it('should emit the detector event only once per dry episode', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-outbound-track', eventSpy);

            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            tick();
            tick(6000);

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            tick(5000);

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should resolve the issue when the track starts sending again', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            tick();
            tick(6000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockTrackMonitor.setOutboundRtp({ bytesSent: 1000, deltaBytesSent: 100 });
            tick();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should resolve an active dry issue when the track gets paused', () => {
            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            // Raise the dry issue
            tick();
            tick(6000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // The producer gets paused - the silence is now explained, so the
            // active issue must be resolved instead of staying open.
            mockTrackMonitor.paused = true;
            tick();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // After resume, a new dry episode needs the full threshold again
            mockTrackMonitor.paused = false;
            tick();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            tick(6000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should use custom threshold from configuration', () => {
            mockClientMonitor.config.dryOutboundTrackDetector.thresholdInMs = 10000;

            mockTrackMonitor.setOutboundRtp({ bytesSent: 0, deltaBytesSent: 0 });

            tick();
            tick(8000);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            tick(4000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });
    });

    describe('Edge cases', () => {
        it('should handle a track without outbound rtp gracefully', () => {
            mockTrackMonitor.setOutboundRtp(null);

            expect(() => detector.update()).not.toThrow();
        });

        it('should handle undefined deltaBytesSent gracefully', () => {
            mockTrackMonitor.setOutboundRtp({});

            expect(() => detector.update()).not.toThrow();
        });
    });
});
