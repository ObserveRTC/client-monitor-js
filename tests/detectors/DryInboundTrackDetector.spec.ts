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
    /**
     * The gap between the two stats reports this delta came from, as
     * `InboundRtpMonitor` derives it. The dry stretch is measured by accumulating
     * this rather than by reading the wall clock, so the specs below drive it
     * instead of advancing timers.
     */
    deltaTime?: number;
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
    public paused = false;
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
    });

    /** One collection, describing `deltaTime` milliseconds of the stream's own time. */
    const tick = (deltaTime = 0) => {
        const inboundRtp = mockTrackMonitor.getInboundRtp();

        if (inboundRtp) inboundRtp.deltaTime = deltaTime;

        detector.update();
    };

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

            // One collection describing 6s of dry stream time, past the 5s threshold
            tick(6000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if track is receiving data', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 1000, deltaBytesReceived: 100 });

            tick();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if remote track is paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });
            mockTrackMonitor.setRemoteOutboundTrackPaused(true);

            // One collection describing 6s of dry stream time, past the 5s threshold
            tick(6000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if this leg\'s consumer is paused (trackMonitor.paused)', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });
            // The local mediasoup consumer got pause()d: the producer may still be
            // sending to everyone else, but this leg deliberately opted out.
            mockTrackMonitor.paused = true;

            tick(6000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Dry track detection', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
        });

        it('should start accumulating when track stops receiving data', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            tick();

            // Should not trigger yet (under threshold)
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // More dry stream time, but still under the threshold
            tick(4000); // 4 seconds < 5 second threshold

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should trigger dry track detection after threshold duration', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-inbound-track', eventSpy);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Start the timer
            tick();

            // One collection describing 6s of dry stream time, past the 5s threshold
            tick(6000); // 6 seconds > 5 second threshold

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

        // The stretch is measured in the stream's own time. A device that slept, or a
        // main thread that blocked, is time the library spent not looking rather than
        // time the track spent silent, and only the stats timestamps can tell them apart.
        it('should not count wall-clock time the collector spent away', () => {
            jest.useFakeTimers();
            jest.setSystemTime(0);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            tick();

            // A minute passes with the collector blocked; when it comes back the two
            // reports it reads are only a second apart.
            jest.setSystemTime(60_000);
            tick(1000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            jest.useRealTimers();
        });

        it('should reset the accumulator when remote track becomes paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // 3s of dry time on the books
            tick();
            tick(3000);

            // Remote track becomes paused - discards the accumulated dry time
            mockTrackMonitor.setRemoteOutboundTrackPaused(true);
            tick(3000);

            // Track becomes unpaused, and the new stretch starts from zero
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
            tick();

            // Should not trigger even though the dry stretches total 7s
            tick(4000);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should resolve an active dry issue when the remote track becomes paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Raise the dry issue
            tick();
            tick(6000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // The producer/consumer gets paused - the silence is now explained,
            // so the active issue must be resolved instead of staying open.
            mockTrackMonitor.setRemoteOutboundTrackPaused(true);
            tick();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // After resume, a new dry episode needs the full threshold again
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
            tick();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            tick(6000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should resolve an active dry issue when the consumer gets paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Raise the dry issue
            tick();
            tick(6000);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // This leg's consumer gets paused - the silence is now explained
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

        it('should emit the detector event only once per dry episode', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-inbound-track', eventSpy);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            tick();
            tick(6000);

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // While the dry condition continues, the detector stays silent —
            // no new 'dry-inbound-track' event is fired, and the same active
            // issue keeps living in the store (deduped by key).
            tick(5000);

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should use custom threshold from configuration', () => {
            mockClientMonitor.config.dryInboundTrackDetector.thresholdInMs = 10000; // 10 seconds

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            tick();

            // Should not trigger at 8 seconds (< 10 second threshold)
            tick(8000);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // Should trigger at 12 seconds (> 10 second threshold)
            tick(4000); // Total 12 seconds
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should reset when track starts receiving data but not trigger new issue until recovered', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });

            // Open the dry stretch, then push it past the threshold
            tick();
            tick(6000); // Trigger the event

            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // Track starts receiving data - this resets the evented flag and resolves the issue
            mockTrackMonitor.setInboundRtp({ bytesReceived: 1000, deltaBytesReceived: 100 });
            tick();

            // Issue should be resolved
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // Later, track stops receiving data again
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0, deltaBytesReceived: 0 });
            tick();

            // Should not create new issue yet - needs to wait for threshold again
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // After threshold, should create new issue
            tick(6000);

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

            tick();
            tick(7500); // 7.5 seconds

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