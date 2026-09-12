import { mockIssueRegistry } from "../helpers/detectorMocks";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { PlayoutDiscrepancyDetector } from "../../src/detectors/PlayoutDiscrepancyDetector";
import { SlicedWindow } from "../../src/utils/SlicedWindow";

// Types for test mocks
interface PlayoutDiscrepancyConfig {
    disabled: boolean;
    highSkewRatio: number;
    lowSkewRatio: number;
    minFramesReceived: number;
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
    public activeTab = true;
    public config = {
        playoutDiscrepancyDetector: {
            disabled: false,
            highSkewRatio: 0.25,
            lowSkewRatio: 0.1,
            minFramesReceived: 10
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
    /**
     * This mock's own issue registry, created lazily so it does not depend on field order.
     * It routes back into the local client mock, leaving every existing assertion intact.
     */
    private _issues?: IssueRegistry;
    public get issues(): IssueRegistry {
        return this._issues ??= mockIssueRegistry(this.parent);
    }

    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();

    getPeerConnection() {
        return this;
    }
}

/**
 * The detector reads its frame counters from the track's `slicedWindow` rather than from
 * one collection's deltas, so the mock turns each `setInboundRtp` into one collection's worth of
 * window entries: the running totals advance by the deltas the test names, and the window is sized
 * so its detection half holds exactly the last collection. That keeps every test below reading as
 * "this collection carried these frames", which is what they were written to say.
 */
const COLLECTION_MS = 1000;

class MockInboundTrackMonitor {
    /** This mock track's own registry, routed back into the local client mock. */
    private _issues?: IssueRegistry;
    public get issues(): IssueRegistry {
        return this._issues ??= mockIssueRegistry(this.getPeerConnection().parent);
    }

    public track = { id: 'test-track-id' };

    public readonly slicedWindow = new SlicedWindow({
        totals: { totalFramesReceived: null, totalFramesRendered: null } as {
            totalFramesReceived: number | null;
            totalFramesRendered: number | null;
        },
        slices: {
            detection: { numberOfSamples: 2 },
            recovery: { numberOfSamples: 2, offset: 2 },
        },
        maxAllowedGapInMs: COLLECTION_MS * 3,
    });

    private peerConnection = new MockPeerConnectionMonitor();
    private inboundRtp: InboundRtpStats | null = null;
    private _statsClockTime = 0;
    private _totalFramesReceived = 0;
    private _totalFramesRendered = 0;

    public constructor() {
        // One entry to difference the first collection against, as a real track always has.
        this._addWindowEntry();
    }

    getPeerConnection() {
        return this.peerConnection;
    }

    getInboundRtp() {
        return this.inboundRtp;
    }

    setInboundRtp(stats: InboundRtpStats | null) {
        this.inboundRtp = stats;

        // A collection reporting no counter leaves the totals unreported, which is what the window
        // sees when the browser stops carrying them.
        const received = stats?.deltaFramesReceived;
        const rendered = stats?.deltaFramesRendered;

        if (received === undefined || rendered === undefined) {
            this._addWindowEntry({ unreported: true });

            return;
        }

        this._totalFramesReceived += received;
        this._totalFramesRendered += rendered;
        this._addWindowEntry();
    }

    private _addWindowEntry(options: { unreported?: boolean } = {}) {
        this.slicedWindow.add({
            timestamp: this._statsClockTime,
            value: options.unreported
                ? { totalFramesReceived: null, totalFramesRendered: null }
                : {
                    totalFramesReceived: this._totalFramesReceived,
                    totalFramesRendered: this._totalFramesRendered,
                },
        });
        this._statsClockTime += COLLECTION_MS;
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

    /**
     * The number beside the flag: the share of arriving frames that never got painted, published on
     * every collection that was judged rather than only the ones past the threshold.
     */
    describe('the published skew', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const skew = () => (mockTrackMonitor as any).videoPlayoutSkew;

        it('is the share of arriving frames that went unpainted', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 40,
                deltaFramesRendered: 30,
                ewmaFps: 30,
            });

            detector.update();

            expect(skew()).toBeCloseTo(0.25, 6);
        });

        it('is zero for a renderer painting everything that arrives', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 40,
                deltaFramesRendered: 40,
                ewmaFps: 30,
            });

            detector.update();

            expect(skew()).toBe(0);
        });

        it('is published below the threshold, where no issue exists', () => {
            // 10% dropped, under the 25% that opens an episode.
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 40,
                deltaFramesRendered: 36,
                ewmaFps: 30,
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(skew()).toBeCloseTo(0.1, 6);
        });

        it('means the same at any frame rate, being a share rather than a count', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20, deltaFramesRendered: 15, ewmaFps: 15,
            });
            detector.update();
            const slow = skew();

            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 200, deltaFramesRendered: 150, ewmaFps: 60,
            });
            detector.update();

            // A quarter dropped either way, though one collection carried ten times the frames.
            expect(skew()).toBeCloseTo(slow, 6);
        });

        it('goes slightly negative when the renderer runs ahead of the counter', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 40,
                deltaFramesRendered: 42,
                ewmaFps: 30,
            });

            detector.update();

            // Noise around zero from the two counters advancing a moment apart, reported as it is
            // rather than clamped, so a consumer can see it for what it is.
            expect(skew()).toBeLessThan(0);
        });

        it('is blanked where the detector could not judge', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 40, deltaFramesRendered: 10, ewmaFps: 30,
            });
            detector.update();
            expect(skew()).toBeGreaterThan(0);

            mockClientMonitor.activeTab = false;
            detector.update();

            expect(skew()).toBeUndefined();
        });

        it('is blanked when the interval carried too few frames to judge', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 40, deltaFramesRendered: 10, ewmaFps: 30,
            });
            detector.update();
            expect(skew()).toBeGreaterThan(0);

            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 2, deltaFramesRendered: 0, ewmaFps: 30,
            });
            detector.update();

            expect(skew()).toBeUndefined();
        });
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

        it('still detects when ewmaFps is missing — it is payload, not evidence', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20,
                deltaFramesRendered: 5
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]?.payload?.ewmaFps).toBeUndefined();
        });

        it('detects the maximal case, where nothing rendered at all', () => {
            // `deltaFramesRendered: 0` is everything arriving and nothing
            // reaching the screen — a truthiness guard used to skip it
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 30,
                deltaFramesRendered: 0,
                ewmaFps: 30
            });

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });
    });

    describe('update() - Detection logic', () => {
        beforeEach(() => {
            detector.disabled = false;
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewRatio = 0.25;
            mockClientMonitor.config.playoutDiscrepancyDetector.lowSkewRatio = 0.1;
        });

        it('should not trigger when frame skew is below high threshold', () => {
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 20,
                deltaFramesRendered: 17, // skew 3 of 20 = 15%, under the 25% bar
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
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewRatio = 0.25;
            mockClientMonitor.config.playoutDiscrepancyDetector.lowSkewRatio = 0.1;
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
                deltaFramesReceived: 20,
                deltaFramesRendered: 19, // skew 1 of 20 = 5%, under the 10% bar
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
                deltaFramesReceived: 20,
                deltaFramesRendered: 19, // skew 1 of 20 = 5%, under the 10% bar
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
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewRatio = 0.25;
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
            mockClientMonitor.config.playoutDiscrepancyDetector.highSkewRatio = 0.7;
            mockClientMonitor.config.playoutDiscrepancyDetector.lowSkewRatio = 0.2;

            // skew 15 of 25 = 60%, under the raised 70% bar
            mockTrackMonitor.setInboundRtp({
                deltaFramesReceived: 25,
                deltaFramesRendered: 10,
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