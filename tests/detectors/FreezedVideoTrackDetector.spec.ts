import { FreezedVideoTrackDetector } from "../../src/detectors/FreezedVideoTrackDetector";

// Types for test mocks
interface VideoFreezesConfig {
    disabled: boolean;
    createIssue: boolean;
}

interface TestIssue {
    type: string;
    payload: Record<string, unknown>;
}

interface EventHandler {
    (event: Record<string, unknown>): void;
}

interface InboundRtpStats {
    freezeCount?: number;
    isFreezed?: boolean;
    trackIdentifier?: string;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        videoFreezesDetector: {
            disabled: false,
            createIssue: true
        } as VideoFreezesConfig
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

    resolveActiveIssues(type: string, filter: (issue: TestIssue) => boolean) {
        // Mock implementation for resolving active issues
        this.issues = this.issues.filter(issue => !(issue.type === type && filter(issue)));
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

describe('FreezedVideoTrackDetector', () => {
    let detector: FreezedVideoTrackDetector;
    let mockTrackMonitor: MockInboundTrackMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockTrackMonitor = new MockInboundTrackMonitor();
        mockClientMonitor = mockTrackMonitor.getPeerConnection().parent as MockClientMonitor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new FreezedVideoTrackDetector(mockTrackMonitor as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('freezed-video-track-detector');
        });

        it('should store track monitor reference', () => {
            expect(detector.trackMonitor).toBe(mockTrackMonitor);
        });
    });

    describe('update() - Basic validation', () => {
        it('should return early if no inbound RTP stats', () => {
            mockTrackMonitor.setInboundRtp(null);
            
            expect(() => detector.update()).not.toThrow();
        });

        it('should return early if no freeze count', () => {
            mockTrackMonitor.setInboundRtp({
                trackIdentifier: 'test-track'
            });

            expect(() => detector.update()).not.toThrow();
        });

        it('should return early if detector is disabled', () => {
            mockClientMonitor.config.videoFreezesDetector.disabled = true;
            mockTrackMonitor.setInboundRtp({
                freezeCount: 5,
                trackIdentifier: 'test-track'
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Freeze detection logic', () => {
        beforeEach(() => {
            mockClientMonitor.config.videoFreezesDetector.disabled = false;
        });

        it('should detect new freeze when freeze count increases', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);

            // Start with freeze count of 0
            mockTrackMonitor.setInboundRtp({
                freezeCount: 0,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });
            detector.update();

            // Increase freeze count to 2
            mockTrackMonitor.setInboundRtp({
                freezeCount: 2,
                isFreezed: false, // Initially not frozen
                trackIdentifier: 'test-track'
            });
            detector.update();

            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.isFreezed).toBe(true);
            expect(eventSpy).toHaveBeenCalledWith({
                clientMonitor: mockClientMonitor,
                trackMonitor: mockTrackMonitor
            });
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toEqual({
                type: 'freezed-video-track',
                payload: {
                    trackId: 'test-track'
                }
            });
        });

        it('should not detect freeze when freeze count stays the same', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);

            // Start with freeze count of 3 - this will trigger since _lastFreezeCount starts at 0
            mockTrackMonitor.setInboundRtp({
                freezeCount: 3,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });
            detector.update();

            // Keep freeze count at 3 (no new freezes)
            mockTrackMonitor.setInboundRtp({
                freezeCount: 3,
                isFreezed: true, // Now it was frozen from previous call
                trackIdentifier: 'test-track'
            });
            detector.update();

            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.isFreezed).toBe(false); // No new freezes, so should be false
            expect(eventSpy).toHaveBeenCalledTimes(1); // Only the first call should trigger event
            expect(mockClientMonitor.getIssues()).toHaveLength(1); // Only one issue from first call
        });

        it('should detect freeze when count increases from previous run', () => {
            // First update with freeze count of 1
            mockTrackMonitor.setInboundRtp({
                freezeCount: 1,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });
            detector.update();

            const inboundRtp1 = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp1?.isFreezed).toBe(true); // New freeze detected

            // Second update with freeze count of 3 (2 new freezes)
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);
            mockClientMonitor.clearIssues();

            mockTrackMonitor.setInboundRtp({
                freezeCount: 3,
                isFreezed: false, // Reset for test
                trackIdentifier: 'test-track'
            });
            detector.update();

            const inboundRtp2 = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp2?.isFreezed).toBe(true);
            expect(eventSpy).toHaveBeenCalled();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should clear freeze state when no new freezes occur', () => {
            // First, detect a freeze
            mockTrackMonitor.setInboundRtp({
                freezeCount: 2,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });
            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.isFreezed).toBe(true);

            // Then, no new freezes (count stays the same)
            mockTrackMonitor.setInboundRtp({
                freezeCount: 2,
                isFreezed: true, // Was frozen
                trackIdentifier: 'test-track'
            });
            detector.update();

            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.isFreezed).toBe(false); // Should clear freeze state
        });
    });

    describe('update() - Issue creation', () => {
        beforeEach(() => {
            mockClientMonitor.config.videoFreezesDetector.disabled = false;
        });

        it('should not create issue when createIssue is false', () => {
            mockClientMonitor.config.videoFreezesDetector.createIssue = false;
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);

            mockTrackMonitor.setInboundRtp({
                freezeCount: 1,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });

            detector.update();

            // Event should still be emitted
            expect(eventSpy).toHaveBeenCalled();
            // But no issue should be created
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should create issue with correct track identifier', () => {
            mockTrackMonitor.setInboundRtp({
                freezeCount: 3,
                isFreezed: false,
                trackIdentifier: 'custom-track-id'
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toEqual({
                type: 'freezed-video-track',
                payload: {
                    trackId: 'custom-track-id'
                }
            });
        });
    });

    describe('update() - Event emission timing', () => {
        beforeEach(() => {
            mockClientMonitor.config.videoFreezesDetector.disabled = false;
        });

        it('should only emit event on freeze start, not on freeze end', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);

            // Start freeze
            mockTrackMonitor.setInboundRtp({
                freezeCount: 1,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);

            // End freeze (no new freeze count increase)
            mockTrackMonitor.setInboundRtp({
                freezeCount: 1,
                isFreezed: true, // Was frozen
                trackIdentifier: 'test-track'
            });
            detector.update();

            // Should not emit additional events when freeze ends
            expect(eventSpy).toHaveBeenCalledTimes(1);
        });

        it('should not emit duplicate events for continued freeze state', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);

            // Initial freeze detection (count goes from 0 to 2)
            mockTrackMonitor.setInboundRtp({
                freezeCount: 2,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);

            // More freezes (count goes from 2 to 4, so 2 new freezes)
            // But since track was already frozen, no new event should be emitted
            mockTrackMonitor.setInboundRtp({
                freezeCount: 4,
                isFreezed: true, // Was frozen before
                trackIdentifier: 'test-track'
            });
            detector.update();

            // Should NOT emit another event since track was already frozen (!wasFreezed condition fails)
            expect(eventSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('Edge cases', () => {
        it('should handle zero freeze count gracefully', () => {
            mockTrackMonitor.setInboundRtp({
                freezeCount: 0,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });

            expect(() => detector.update()).not.toThrow();
            
            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.isFreezed).toBe(false);
        });

        it('should handle undefined track identifier', () => {
            mockTrackMonitor.setInboundRtp({
                freezeCount: 1,
                isFreezed: false
                // trackIdentifier undefined
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0].payload.trackId).toBeUndefined();
        });

        it('should handle large freeze count increases', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('freezed-video-track', eventSpy);

            mockTrackMonitor.setInboundRtp({
                freezeCount: 1000,
                isFreezed: false,
                trackIdentifier: 'test-track'
            });

            expect(() => detector.update()).not.toThrow();
            
            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.isFreezed).toBe(true);
            expect(eventSpy).toHaveBeenCalled();
        });
    });
}); 