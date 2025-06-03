import { DryInboundTrackDetector } from "../../src/detectors/DryInboundTrackDetector";

// Types for test mocks
interface DryInboundTrackConfig {
    disabled: boolean;
    createIssue: boolean;
    thresholdInMs: number;
}

interface TestIssue {
    type: string;
    payload: Record<string, unknown>;
}

interface EventHandler {
    (event: Record<string, unknown>): void;
}

interface InboundRtpStats {
    bytesReceived?: number;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        dryInboundTrackDetector: {
            disabled: false,
            createIssue: true,
            thresholdInMs: 5000
        } as DryInboundTrackConfig
    };
    
    private eventHandlers: { [key: string]: EventHandler[] } = {};
    private issues: TestIssue[] = [];

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

    addIssue(issue: TestIssue) {
        this.issues.push(issue);
    }

    getIssues() {
        return this.issues;
    }

    clearIssues() {
        this.issues = [];
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
            mockClientMonitor.config.dryInboundTrackDetector.disabled = true;
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

            // Advance time beyond threshold
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if track is receiving data', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 1000 });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if remote track is paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });
            mockTrackMonitor.setRemoteOutboundTrackPaused(true);

            // Advance time beyond threshold
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Dry track detection', () => {
        beforeEach(() => {
            mockClientMonitor.config.dryInboundTrackDetector.disabled = false;
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
        });

        it('should start timing when track stops receiving data', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

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

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

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
            expect(mockClientMonitor.getIssues()[0]).toEqual({
                type: 'dry-inbound-track',
                payload: {
                    trackId: 'test-track-id',
                    duration: 6000
                }
            });
        });

        it('should reset timer when remote track becomes paused', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

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

        it('should only trigger once per dry period', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-inbound-track', eventSpy);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);

            // Additional calls should not trigger events
            jest.advanceTimersByTime(5000);
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should use custom threshold from configuration', () => {
            mockClientMonitor.config.dryInboundTrackDetector.thresholdInMs = 10000; // 10 seconds

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

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

        it('should not reset timer when track starts receiving data - once evented, stays evented', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

            // Start timing
            detector.update();
            jest.advanceTimersByTime(6000); // Trigger the event
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // Track starts receiving data
            mockTrackMonitor.setInboundRtp({ bytesReceived: 1000 });
            detector.update();

            // Later, track stops receiving data again
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });
            detector.update();

            // Should not trigger again since detector is already evented
            jest.advanceTimersByTime(10000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1); // Still only 1 issue
        });
    });

    describe('update() - Issue creation', () => {
        beforeEach(() => {
            mockClientMonitor.config.dryInboundTrackDetector.disabled = false;
            mockTrackMonitor.setRemoteOutboundTrackPaused(false);
        });

        it('should not create issue when createIssue is false', () => {
            mockClientMonitor.config.dryInboundTrackDetector.createIssue = false;
            const eventSpy = jest.fn();
            mockClientMonitor.on('dry-inbound-track', eventSpy);

            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();

            // Event should still be emitted
            expect(eventSpy).toHaveBeenCalled();
            // But no issue should be created
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should create issue with correct duration', () => {
            mockTrackMonitor.setInboundRtp({ bytesReceived: 0 });

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