import { PlayoutDiscrepancyDetector } from "../../src/detectors/PlayoutDiscrepancyDetector";

// Types for test mocks
interface PlayoutDiscrepancyConfig {
    disabled: boolean;
    highSkewThreshold: number;
    lowSkewThreshold: number;
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
    deltaFramesReceived?: number;
    deltaFramesRendered?: number;
    ewmaFps?: number;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        playoutDiscrepancyDetector: {
            disabled: false,
            highSkewThreshold: 10,
            lowSkewThreshold: 3
        } as PlayoutDiscrepancyConfig
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

    getPeerConnection() {
        return this.peerConnection;
    }

    getInboundRtp() {
        return this.inboundRtp;
    }

    setInboundRtp(stats: InboundRtpStats | null) {
        this.inboundRtp = stats;
    }
}

describe('PlayoutDiscrepancyDetector', () => {
    let detector: PlayoutDiscrepancyDetector;
    let mockTrackMonitor: MockInboundTrackMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockTrackMonitor = new MockInboundTrackMonitor();
        mockClientMonitor = mockTrackMonitor.getPeerConnection().parent as MockClientMonitor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new PlayoutDiscrepancyDetector(mockTrackMonitor as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('playout-discrepancy-detector');
        });

        it('should store track monitor reference', () => {
            expect(detector.trackMonitor).toBe(mockTrackMonitor);
        });

        it('should initialize active state to false', () => {
            expect(detector.active).toBe(false);
        });
    });

    describe('update() - Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20,
                deltaFramesRendered: 5,
                ewmaFps: 30
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(detector.active).toBe(false);
        });

        it('should return early if no inbound RTP stats', () => {
            mockTrackMonitor.setInboundRtp(null);
            
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if missing deltaFramesReceived', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesRendered: 5,
                ewmaFps: 30
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if missing deltaFramesRendered', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20,
                ewmaFps: 30
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if missing ewmaFps', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20,
                deltaFramesRendered: 5
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Detection logic', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewThreshold = 10;
            mockClientMonitor.config.playoutDiscrepancyDetector.lowSkewThreshold = 3;
        });

        it('should not trigger when frame skew is below high threshold', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 15,
                deltaFramesRendered: 10, // Skew = 5, below threshold of 10
                ewmaFps: 30
            });

            detector.update();
            expect(detector.active).toBe(false);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should trigger when frame skew exceeds high threshold', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('inbound-video-playout-discrepancy', eventSpy);

            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10, // Skew = 15, above threshold of 10
                ewmaFps: 30
            });

            detector.update();

            expect(detector.active).toBe(true);
            expect(eventSpy).toHaveBeenCalledWith({
                trackMonitor: mockTrackMonitor,
                clientMonitor: mockClientMonitor
            });
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'inbound-video-playout-discrepancy',
                payload: {
                    trackId: 'test-track-id',
                    frameSkew: 15,
                    ewmaFps: 30
                }
            });
        });

        it('should trigger exactly at high threshold', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('inbound-video-playout-discrepancy', eventSpy);

            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20,
                deltaFramesRendered: 10, // Skew = 10, exactly at threshold
                ewmaFps: 25
            });

            detector.update();

            expect(detector.active).toBe(true);
            expect(eventSpy).toHaveBeenCalled();
        });
    });

    describe('update() - Hysteresis behavior', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewThreshold = 10;
            mockClientMonitor.config.playoutDiscrepancyDetector.lowSkewThreshold = 3;
        });

        it('should stay active when frame skew is between thresholds', () => {
            // First trigger the detector
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10, // Skew = 15, above high threshold
                ewmaFps: 30
            });
            detector.update();
            expect(detector.active).toBe(true);

            // Clear events/issues for clean test
            mockClientMonitor.clearIssues();

            // Now provide skew between thresholds (should stay active)
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 15,
                deltaFramesRendered: 10, // Skew = 5, between low (3) and high (10) thresholds
                ewmaFps: 30
            });
            detector.update();

            expect(detector.active).toBe(true); // Should remain active
            expect(mockClientMonitor.getIssues()).toHaveLength(0); // No new issues
        });

        it('should clear when frame skew drops below low threshold', () => {
            // First trigger the detector
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10, // Skew = 15, above high threshold
                ewmaFps: 30
            });
            detector.update();
            expect(detector.active).toBe(true);

            // Now provide skew below low threshold
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 12,
                deltaFramesRendered: 10, // Skew = 2, below low threshold of 3
                ewmaFps: 30
            });
            detector.update();

            expect(detector.active).toBe(false); // Should be cleared
        });

        it('should not trigger duplicate events while active', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('inbound-video-playout-discrepancy', eventSpy);

            // First trigger
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10, // Skew = 15
                ewmaFps: 30
            });
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);

            // Second update while active (should not trigger again)
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 30,
                deltaFramesRendered: 10, // Skew = 20, still high
                ewmaFps: 30
            });
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1); // Still only 1 event
            expect(mockClientMonitor.getIssues()).toHaveLength(1); // Still only 1 issue
        });

        // Regression: resolve must remove the issue from the active store,
        // emit 'issue-resolved', and enrich the payload with durationInMs.
        it('should emit issue-resolved with durationInMs when skew clears', () => {
            jest.useFakeTimers();
            const resolvedSpy = jest.fn();
            mockClientMonitor.on('issue-resolved', resolvedSpy);

            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10, // Skew = 15
                ewmaFps: 30
            });
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            jest.advanceTimersByTime(3000);

            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 12,
                deltaFramesRendered: 10, // Skew = 2, below low threshold
                ewmaFps: 30
            });
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(resolvedSpy).toHaveBeenCalledTimes(1);
            const resolved = resolvedSpy.mock.calls[0][0] as { payload: { durationInMs?: number }; comment?: string };
            expect(resolved.payload.durationInMs).toBe(3000);
            expect(resolved.comment).toBe('playout discrepancy ended');

            jest.useRealTimers();
        });
    });

    describe('update() - Issue creation', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewThreshold = 10;
        });

        it('should create issue with correct payload', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 35,
                deltaFramesRendered: 15,
                ewmaFps: 24
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'inbound-video-playout-discrepancy',
                payload: {
                    trackId: 'test-track-id',
                    frameSkew: 20, // 35 - 15
                    ewmaFps: 24
                }
            });
        });
    });

    describe('Edge cases', () => {
        it('should handle zero frame values', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 0,
                deltaFramesRendered: 0,
                ewmaFps: 30
            });

            expect(() => detector.update()).not.toThrow();
            expect(detector.active).toBe(false);
        });

        it('should handle negative frame skew', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 5,
                deltaFramesRendered: 10, // More rendered than received (skew = -5)
                ewmaFps: 30
            });

            expect(() => detector.update()).not.toThrow();
            expect(detector.active).toBe(false);
        });

        it('should handle custom thresholds', () => {
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewThreshold = 20;
            mockClientMonitor.config.playoutDiscrepancyDetector.lowSkewThreshold = 5;

            // Should not trigger at skew 15 (below new high threshold of 20)
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10, // Skew = 15
                ewmaFps: 30
            });
            detector.update();
            expect(detector.active).toBe(false);

            // Should trigger at skew 25 (above high threshold of 20)
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 35,
                deltaFramesRendered: 10, // Skew = 25
                ewmaFps: 30
            });
            detector.update();
            expect(detector.active).toBe(true);
        });
    });
}); 