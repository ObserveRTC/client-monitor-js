import { SynthesizedSamplesDetector } from "../../src/detectors/SynthesizedSamplesDetector";

// Types for test mocks
interface SyntheticSamplesConfig {
    disabled: boolean;
    createIssue: boolean;
    minSynthesizedSamplesDuration: number;
}

interface TestIssue {
    type: string;
    payload: Record<string, unknown>;
}

interface EventHandler {
    (event: Record<string, unknown>): void;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        syntheticSamplesDetector: {
            disabled: false,
            createIssue: true,
            minSynthesizedSamplesDuration: 100
        } as SyntheticSamplesConfig
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

class MockMediaPlayoutMonitor {
    private peerConnection = new MockPeerConnectionMonitor();
    public deltaSynthesizedSamplesDuration = 0;

    getPeerConnection() {
        return this.peerConnection;
    }

    setDeltaSynthesizedSamplesDuration(duration: number) {
        this.deltaSynthesizedSamplesDuration = duration;
    }
}

describe('SynthesizedSamplesDetector', () => {
    let detector: SynthesizedSamplesDetector;
    let mockMediaPlayout: MockMediaPlayoutMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockMediaPlayout = new MockMediaPlayoutMonitor();
        mockClientMonitor = mockMediaPlayout.getPeerConnection().parent as MockClientMonitor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new SynthesizedSamplesDetector(mockMediaPlayout as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('synthesized-samples-detector');
        });

        it('should store media playout reference', () => {
            expect(detector.mediaPlayout).toBe(mockMediaPlayout);
        });
    });

    describe('update() - Basic validation', () => {
        it('should return early if detector is disabled', () => {
            mockClientMonitor.config.syntheticSamplesDetector.disabled = true;
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(200); // Above threshold

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if synthesized samples duration is below threshold', () => {
            mockClientMonitor.config.syntheticSamplesDetector.minSynthesizedSamplesDuration = 100;
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(50); // Below threshold

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should return early if synthesized samples duration equals threshold', () => {
            mockClientMonitor.config.syntheticSamplesDetector.minSynthesizedSamplesDuration = 100;
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(100); // Equal to threshold

            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - Detection logic', () => {
        beforeEach(() => {
            mockClientMonitor.config.syntheticSamplesDetector.disabled = false;
            mockClientMonitor.config.syntheticSamplesDetector.minSynthesizedSamplesDuration = 100;
        });

        it('should detect synthesized samples when duration exceeds threshold', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('synthesized-audio', eventSpy);

            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(150); // Above threshold

            detector.update();

            expect(eventSpy).toHaveBeenCalledWith({
                mediaPlayoutMonitor: mockMediaPlayout,
                clientMonitor: mockClientMonitor
            });
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toEqual({
                type: 'synthesized-audio',
                payload: {
                    deltaSynthesizedSamplesDuration: 150
                }
            });
        });

        it('should detect synthesized samples with custom threshold', () => {
            mockClientMonitor.config.syntheticSamplesDetector.minSynthesizedSamplesDuration = 200;
            
            // Should not trigger at 150ms (below 200ms threshold)
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(150);
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // Should trigger at 250ms (above 200ms threshold)
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(250);
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should trigger multiple times for consecutive detections', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('synthesized-audio', eventSpy);

            // First detection
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(150);
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);

            // Second detection
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(200);
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(2);

            expect(mockClientMonitor.getIssues()).toHaveLength(2);
        });
    });

    describe('update() - Issue creation', () => {
        beforeEach(() => {
            mockClientMonitor.config.syntheticSamplesDetector.disabled = false;
            mockClientMonitor.config.syntheticSamplesDetector.minSynthesizedSamplesDuration = 100;
        });

        it('should not create issue when createIssue is false', () => {
            mockClientMonitor.config.syntheticSamplesDetector.createIssue = false;
            const eventSpy = jest.fn();
            mockClientMonitor.on('synthesized-audio', eventSpy);

            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(150);
            detector.update();

            // Event should still be emitted
            expect(eventSpy).toHaveBeenCalled();
            // But no issue should be created
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should create issue with correct payload', () => {
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(275);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toEqual({
                type: 'synthesized-audio',
                payload: {
                    deltaSynthesizedSamplesDuration: 275
                }
            });
        });
    });

    describe('Edge cases', () => {
        it('should handle zero synthesized samples duration', () => {
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(0);

            expect(() => detector.update()).not.toThrow();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should handle negative synthesized samples duration', () => {
            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(-50);

            expect(() => detector.update()).not.toThrow();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should handle very large synthesized samples duration', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('synthesized-audio', eventSpy);

            mockMediaPlayout.setDeltaSynthesizedSamplesDuration(999999);

            expect(() => detector.update()).not.toThrow();
            expect(eventSpy).toHaveBeenCalled();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0].payload.deltaSynthesizedSamplesDuration).toBe(999999);
        });
    });
}); 