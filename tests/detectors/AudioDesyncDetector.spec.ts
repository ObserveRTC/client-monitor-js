import { AudioDesyncDetector } from "../../src/detectors/AudioDesyncDetector";

// Types for test mocks
interface AudioDesyncConfig {
    disabled: boolean;
    createIssue: boolean;
    fractionalCorrectionAlertOnThreshold: number;
    fractionalCorrectionAlertOffThreshold: number;
}

interface TestIssue {
    type: string;
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
            createIssue: true,
            fractionalCorrectionAlertOnThreshold: 0.1,
            fractionalCorrectionAlertOffThreshold: 0.05
        } as AudioDesyncConfig
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
            mockClientMonitor.config.audioDesyncDetector.disabled = true;
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
            mockClientMonitor.config.audioDesyncDetector.disabled = false;
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
            expect(mockClientMonitor.getIssues()[0]).toEqual({
                type: 'audio-desync',
                payload: {
                    peerConnectionId: 'test-pc-id',
                    trackId: 'test-track-id',
                    dCorrectedSamples: 150,
                    fractionalCorrection: 0.15
                }
            });
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

        it('should track desync duration', () => {
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

            expect(detector.lastDesyncDuration).toBe(5000);
        });
    });

    describe('update() - Configuration', () => {
        it('should not create issue when createIssue is false', () => {
            mockClientMonitor.config.audioDesyncDetector.createIssue = false;

            mockTrackMonitor.setInboundRtp({
                kind: 'audio',
                insertedSamplesForDeceleration: 100,
                removedSamplesForAcceleration: 50,
                receivingAudioSamples: 850,
                desync: false
            });

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

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