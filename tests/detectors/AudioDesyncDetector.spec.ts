import { AudioDesyncDetector } from "../../src/detectors/AudioDesyncDetector";

// Types for test mocks
interface AudioDesyncConfig {
    disabled: boolean;
    fractionalCorrectionAlertOnThreshold: number;
    fractionalCorrectionAlertOffThreshold: number;
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
    kind?: string;
    insertedSamplesForDeceleration?: number | null | undefined;
    removedSamplesForAcceleration?: number | null | undefined;
    receivingAudioSamples?: number | null | undefined;
    desync?: boolean;
    trackIdentifier?: string;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        audioDesyncDetector: {
            disabled: false,
            fractionalCorrectionAlertOnThreshold: 0.1,
            fractionalCorrectionAlertOffThreshold: 0.05
        } as AudioDesyncConfig
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

describe('AudioDesyncDetector', () => {
    let detector: AudioDesyncDetector;
    let mockTrackMonitor: MockInboundTrackMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockTrackMonitor = new MockInboundTrackMonitor();
        mockClientMonitor = mockTrackMonitor.getPeerConnection().parent as MockClientMonitor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new AudioDesyncDetector(mockTrackMonitor as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('audio-desync-detector');
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

        it('should return early if not audio track', () => {
            mockTrackMonitor.setInboundRtp({
                kind: 'video',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 1000
            });

            expect(() => detector.update()).not.toThrow();
        });

        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 1000
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Desync detection logic', () => {
        beforeEach(() => {
            detector.disabled = false;
        });

        it('should not trigger on insufficient corrected samples', () => {
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 0,
                removedSamplesForAcceleration: 0,
                receivingAudioSamples: 1000,
                desync: false
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should not trigger on insufficient receiving samples', () => {
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 50,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 0,
                desync: false
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should trigger desync when fractional correction exceeds on threshold', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('audio-desync-track', eventSpy);

            // Setup: 150 corrected samples, 850 receiving samples = 15% correction rate (> 10% threshold)
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850,
                desync: false
            });

            detector.update();

            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.desync).toBe(true);
            expect(eventSpy).toHaveBeenCalledWith({
                clientMonitor: mockClientMonitor,
                trackMonitor: mockTrackMonitor
            });
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'audio-desync',
                payload: {
                    peerConnectionId: 'test-pc-id',
                    trackId: 'test-track-id',
                    dCorrectedSamples: 150,
                    fractionalCorrection: 0.15
                }
            });
        });

        // Regression: the 'audio-desync-track' event and the raised issue must
        // fire exactly once per desync episode. Re-detection while desync
        // persists is gated by the `wasDesync` transition.
        it('should emit the detector event and raise the issue only once per desync episode', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('audio-desync-track', eventSpy);

            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850, // 15% > 10%
                desync: false
            });
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // Subsequent ticks while desync persists must stay silent.
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 150,
                removedSamplesForAcceleration: 75,
                receivingAudioSamples: 800,
                desync: true,
            });
            detector.update();
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 200,
                removedSamplesForAcceleration: 100,
                receivingAudioSamples: 700,
                desync: true,
            });
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should clear desync when fractional correction falls below off threshold', () => {
            // First, set up a desync state by calling with high correction values
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850, // 150 corrected / 1000 total = 15% > 10% threshold
                desync: false
            });
            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.desync).toBe(true);

            // Now provide low correction rate (since _prevCorrectedSamples is never updated, 
            // we use raw values not deltas): 30 corrected, 970 receiving = 3% < 5% off threshold
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 20,
                removedSamplesForAcceleration: 10,
                receivingAudioSamples: 970, // 30/1000 = 3% < 5%
                desync: true
            });

            detector.update();

            const inboundRtp = mockTrackMonitor.getInboundRtp();
            expect(inboundRtp?.desync).toBe(false);
        });

        it('should use hysteresis - stay in desync state when between thresholds', () => {
            // First, trigger desync
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850, // 150/1000 = 15% > 10%
                desync: false
            });
            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.desync).toBe(true);

            // Now provide correction rate between thresholds: 7% (between 5% off and 10% on)
            // This should NOT clear desync since 7% > 5% off threshold
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 35,
                removedSamplesForAcceleration: 35,
                receivingAudioSamples: 930, // 70/1000 = 7%
                desync: true
            });

            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.desync).toBe(true); // Should stay in desync since 7% > 5%
        });
    });

    describe('update() - Duration tracking', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should track desync duration via the resolved issue payload', () => {
            const resolvedSpy = jest.fn();
            mockClientMonitor.on('issue-resolved', resolvedSpy);

            // Trigger desync
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850, // 150/1000 = 15% > 10%
                desync: false
            });
            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.desync).toBe(true);

            // Advance time by 5 seconds
            jest.advanceTimersByTime(5000);

            // Clear desync with low correction rate
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 20,
                removedSamplesForAcceleration: 10,
                receivingAudioSamples: 970, // 30/1000 = 3% < 5%
                desync: true // Was in desync state
            });
            detector.update();

            // The duration is now reported through the resolved issue's payload,
            // not via a separate field on the detector.
            expect(resolvedSpy).toHaveBeenCalledTimes(1);
            const resolved = resolvedSpy.mock.calls[0][0] as { payload: { durationInMs?: number } };
            expect(resolved.payload.durationInMs).toBe(5000);
        });
    });

    describe('update() - Configuration', () => {
        it('should use custom thresholds', () => {
            mockClientMonitor.config.audioDesyncDetector.fractionalCorrectionAlertOnThreshold = 0.2;  // 20%
            mockClientMonitor.config.audioDesyncDetector.fractionalCorrectionAlertOffThreshold = 0.1;  // 10%

            // 15% correction rate - should not trigger with 20% threshold
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850,
                desync: false
            });

            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.desync).toBe(false);

            // 25% correction rate - should trigger
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 150,
                removedSamplesForAcceleration: 100,
                receivingAudioSamples: 750,
                desync: false
            });

            detector.update();
            expect(mockTrackMonitor.getInboundRtp()?.desync).toBe(true);
        });
    });

    describe('Edge cases', () => {
        it('should handle undefined sample counts gracefully', () => {
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: undefined,
                removedSamplesForAcceleration: undefined,
                receivingAudioSamples: undefined,
                desync: false
            });

            expect(() => detector.update()).not.toThrow();
        });

        it('should handle null sample counts gracefully', () => {
            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: null,
                removedSamplesForAcceleration: null,
                receivingAudioSamples: null,
                desync: false
            });

            expect(() => detector.update()).not.toThrow();
        });
    });
}); 