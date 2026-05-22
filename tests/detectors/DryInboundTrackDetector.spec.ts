import { DryInboundTrackDetector } from "../../src/detectors/DryInboundTrackDetector";

// Types for test mocks
interface DryInboundTrackConfig {
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

interface InboundRtpStats {
    bytesReceived?: number;
    deltaBytesReceived?: number;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        dryInboundTrackDetector: {
            disabled: false,
            thresholdInMs: 5000
        } as DryInboundTrackConfig
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

    addIssue(input: { type: string; payload?: Record<string, unknown> }) {
        const issue: TestIssue = {
            id: `iss_${this.nextId++}`,
            type: input.type,
            payload: input.payload ?? {},
        };
        this.emit('issue', issue as unknown as Record<string, unknown>);
        return issue;
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

    // Compatibility helpers used by existing test assertions.
    getIssues() {
        return [...this.activeIssues.values()];
    }

    clearIssues() {
        this.activeIssues.clear();
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();

    getPeerConnection() {
        return this;
    }
}

class MockInboundTrackMonitor {
    public track = { id: 'test-track-id' };
    private peerConnection = new MockPeerConnectionMonitor();
    private inboundRtp: InboundRtpStats | null = null;
    public remoteOutboundTrackPaused = false;

    getPeerConnection() {
        return this.peerConnection;
    }

    getInboundRtp() {
        return this.inboundRtp;
    }

    setInboundRtp(stats: InboundRtpStats | null) {
        this.inboundRtp = stats;
    }

    setRemoteOutboundTrackPaused(paused: boolean) {
        this.remoteOutboundTrackPaused = paused;
    }
}

describe('DryInboundTrackDetector', () => {
    let detector: DryInboundTrackDetector;
    let mockTrackMonitor: MockInboundTrackMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockTrackMonitor = new MockInboundTrackMonitor();
        mockClientMonitor = mockTrackMonitor.getPeerConnection().parent as MockClientMonitor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new DryInboundTrackDetector(mockTrackMonitor as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('dry-inbound-track-detector');
        });

        it('should store track monitor reference', () => {
            expect(detector.trackMonitor).toBe(mockTrackMonitor);
        });
    });

    describe('update() - Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Advance time beyond threshold
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if track is receiving data', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 1000, deltaBytesReceived: 100 });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if remote track is paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });
            mockTrackMonitor.setRemoteOutboundTrackPaused(true);

            // Advance time beyond threshold
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Dry track detection', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
        });

        it('should start timing when track stops receiving data', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            detector.update();

            // Should not trigger yet (under threshold)
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // Advance time but stay under threshold
            jest.advanceTimersByTime(4000); // 4 seconds < 5 second threshold
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should trigger dry track detection after threshold duration', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-inbound-track', eventSpy);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Start the timer
            detector.update();

            // Advance time beyond threshold
            jest.advanceTimersByTime(6000); // 6 seconds > 5 second threshold
            detector.update();

            expect(eventSpy).toHaveBeenCalledWith({
                trackMonitor: mockTrackMonitor,
                clientMonitor: mockClientMonitor
            });
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'dry-inbound-track',
                payload: {
                    trackId: 'test-track-id',
                    duration: 6000
                }
            });
        });

        it('should reset timer when remote track becomes paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Start timing
            detector.update();
            jest.advanceTimersByTime(3000);

            // Remote track becomes paused - should reset timer
            mockTrackMonitor.setRemoteOutboundTrackPaused(true);
            detector.update();

            // Track becomes unpaused
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
            detector.update();

            // Should not trigger even after total time > threshold
            jest.advanceTimersByTime(4000); // Total time would be 7s, but timer was reset
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should emit the detector event only once per dry episode', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-inbound-track', eventSpy);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // While the dry condition continues, the detector stays silent —
            // no new 'dry-inbound-track' event is fired, and the same active
            // issue keeps living in the store (deduped by key).
            jest.advanceTimersByTime(5000);
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should use custom threshold from configuration', () => {
            mockClientMonitor.config.dryInboundTrackDetector.thresholdInMs = 10000; // 10 seconds

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            detector.update();

            // Should not trigger at 8 seconds (< 10 second threshold)
            jest.advanceTimersByTime(8000);
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // Should trigger at 12 seconds (> 10 second threshold)
            jest.advanceTimersByTime(4000); // Total 12 seconds
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should reset when track starts receiving data but not trigger new issue until recovered', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Start timing
            detector.update();
            jest.advanceTimersByTime(6000); // Trigger the event
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // Track starts receiving data - this resets the evented flag and resolves the issue
            mockTrackMonitor.setInboundRtp({ bytesReceived: 1000, deltaBytesReceived: 100 });
            detector.update();

            // Issue should be resolved
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // Later, track stops receiving data again
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });
            detector.update();

            // Should not create new issue yet - needs to wait for threshold again
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // After threshold, should create new issue
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });
    });

    describe('update() - Issue creation', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
        });

        it('should create issue with correct duration', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            detector.update();
            jest.advanceTimersByTime(7500); // 7.5 seconds
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0].payload).toEqual({
                trackId: 'test-track-id',
                duration: 7500
            });
        });
    });

    describe('Edge cases', () => {
        it('should handle undefined bytesReceived gracefully', () => {
            mockTrackMonitor.setInboundRtp({});

            expect(() => detector.update()).not.toThrow();
        });

        it('should handle null inbound RTP stats gracefully', () => {
            mockTrackMonitor.setInboundRtp(null);

            expect(() => detector.update()).not.toThrow();
        });
    });
}); 