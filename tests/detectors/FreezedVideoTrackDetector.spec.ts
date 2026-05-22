import { FreezedVideoTrackDetector } from "../../src/detectors/FreezedVideoTrackDetector";

// Types for test mocks
interface VideoFreezesConfig {
    disabled: boolean;
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
    freezeCount?: number;
    isFreezed?: boolean;
    trackIdentifier?: string;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        videoFreezesDetector: {
            disabled: false,
        } as VideoFreezesConfig
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
            detector.disabled = true;
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
            detector.disabled = false;
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
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
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
            // The freeze ended on the second update so the issue is resolved out of the active set.
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
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
            detector.disabled = false;
        });

        it('should create issue with correct track identifier', () => {
            mockTrackMonitor.setInboundRtp({
                freezeCount: 3,
                isFreezed: false,
                trackIdentifier: 'custom-track-id'
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'freezed-video-track',
                payload: {
                    trackId: 'custom-track-id'
                }
            });
        });
    });

    describe('update() - Event emission timing', () => {
        beforeEach(() => {
            detector.disabled = false;
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