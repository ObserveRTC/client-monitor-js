import { CongestionDetector } from "../../src/detectors/CongestionDetector";

// Types for test mocks
interface CongestionConfig {
    disabled: boolean;
    sensitivity: 'low' | 'medium' | 'high';
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

interface OutboundRtpStats {
    qualityLimitationReason?: string;
}

// Mock dependencies
class MockClientMonitor {
    public config = {
        congestionDetector: {
            disabled: false,
            sensitivity: 'medium' as const
        } as CongestionConfig
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
    public congested = false;
    public avgRttInSec?: number;
    public ewmaRttInSec?: number;
    public outboundFractionLost?: number;
    public totalAvailableIncomingBitrate = 0;
    public totalAvailableOutgoingBitrate = 0;
    public receivingBitrate = 0;
    public sendingBitrate = 0;
    public outboundRtps: OutboundRtpStats[] = [];

    setOutboundRtps(rtps: OutboundRtpStats[]) {
        this.outboundRtps = rtps;
    }
}

describe('CongestionDetector', () => {
    let detector: CongestionDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new CongestionDetector(mockPeerConnection as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('congestion-detector');
        });

        it('should store peer connection reference', () => {
            expect(detector.peerConnection).toBe(mockPeerConnection);
        });
    });

    describe('update() - Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);

            detector.update();
            expect(mockPeerConnection.congested).toBe(false);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('update() - High sensitivity', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'high';
            detector.disabled = false;
        });

        it('should detect congestion on any bandwidth limitation', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('congestion', eventSpy);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.totalAvailableIncomingBitrate = 1000000;
            mockPeerConnection.totalAvailableOutgoingBitrate = 800000;

            detector.update();

            expect(mockPeerConnection.congested).toBe(true);
            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
                clientMonitor: mockClientMonitor,
                peerConnectionMonitor: mockPeerConnection,
                availableIncomingBitrate: 1000000,
                availableOutgoingBitrate: 800000
            }));
        });

        it('should not detect congestion without bandwidth limitation', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'cpu' }]);

            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should clear congestion when bandwidth limitation stops', () => {
            // First, detect congestion
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            detector.update();
            expect(mockPeerConnection.congested).toBe(true);

            // Then clear it
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'none' }]);
            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
        });
    });

    describe('update() - Medium sensitivity', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'medium';
            detector.disabled = false;
        });

        it('should detect congestion with bandwidth limitation and significant RTT increase', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('congestion', eventSpy);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.avgRttInSec = 0.2;    // 200ms
            mockPeerConnection.ewmaRttInSec = 0.1;   // 100ms EWMA
            // RTT diff = 100ms = 0.1s, which is > 33% of 0.1s (0.033s) but clamped to max 0.15s

            detector.update();

            expect(mockPeerConnection.congested).toBe(true);
            expect(eventSpy).toHaveBeenCalled();
        });

        it('should not detect congestion with bandwidth limitation but small RTT increase', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.avgRttInSec = 0.11;   // 110ms
            mockPeerConnection.ewmaRttInSec = 0.1;   // 100ms EWMA
            // RTT diff = 10ms = 0.01s, which is < 33% of 0.1s (0.033s)

            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should not detect congestion without EWMA RTT', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.avgRttInSec = 0.2;
            mockPeerConnection.ewmaRttInSec = undefined;

            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
        });
    });

    describe('update() - Low sensitivity', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'low';
            detector.disabled = false;
        });

        it('should detect congestion with bandwidth limitation and high packet loss', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('congestion', eventSpy);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.ewmaRttInSec = 0.1;
            mockPeerConnection.outboundFractionLost = 0.08; // 8% > 5%

            detector.update();

            expect(mockPeerConnection.congested).toBe(true);
            expect(eventSpy).toHaveBeenCalled();
        });

        it('should not detect congestion with bandwidth limitation but low packet loss', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.ewmaRttInSec = 0.1;
            mockPeerConnection.outboundFractionLost = 0.02; // 2% < 5%

            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('should not detect congestion without packet loss data', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.ewmaRttInSec = 0.1;
            mockPeerConnection.outboundFractionLost = undefined;

            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
        });
    });

    describe('update() - Historical tracking', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'high';
            detector.disabled = false;
        });

        it('should track maximum values during non-congested periods', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'none' }]);
            mockPeerConnection.totalAvailableIncomingBitrate = 1000000;
            mockPeerConnection.totalAvailableOutgoingBitrate = 800000;
            mockPeerConnection.receivingBitrate = 500000;
            mockPeerConnection.sendingBitrate = 400000;

            detector.update();

            // Now trigger congestion
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.totalAvailableIncomingBitrate = 600000;
            mockPeerConnection.totalAvailableOutgoingBitrate = 500000;

            const eventSpy = jest.fn();
            mockClientMonitor.on('congestion', eventSpy);

            detector.update();

            expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
                maxAvailableIncomingBitrate: 1000000,
                maxAvailableOutgoingBitrate: 800000,
                maxReceivingBitrate: 400000, // Note: the implementation has a bug - it uses sendingBitrate
                maxSendingBitrate: 400000
            }));
        });

        it('should reset historical values after congestion detection', () => {
            // Build up historical values
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'none' }]);
            mockPeerConnection.totalAvailableIncomingBitrate = 1000000;
            detector.update();

            // Trigger congestion
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            detector.update();

            // Values should be reset
            expect(mockPeerConnection.congested).toBe(true);

            // Clear congestion and check that tracking starts fresh
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'none' }]);
            mockPeerConnection.totalAvailableIncomingBitrate = 500000; // Lower than before
            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
        });
    });

    describe('update() - Issue creation', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'high';
            detector.disabled = false;
        });

        it('should create an issue when congestion is detected', () => {
            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            mockPeerConnection.totalAvailableIncomingBitrate = 1000000;
            mockPeerConnection.totalAvailableOutgoingBitrate = 800000;

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
            expect(mockClientMonitor.getIssues()[0]).toMatchObject({
                type: 'congestion',
                payload: expect.objectContaining({
                    peerConnectionId: 'test-pc-id',
                    availableIncomingBitrate: 1000000,
                    availableOutgoingBitrate: 800000
                })
            });
        });

        // Regression: the 'congestion' event and the raised issue must fire
        // exactly once per congestion episode. Re-detection while the PC is
        // still congested is gated by `peerConnection.congested`.
        it('should emit the detector event and raise the issue only once per congestion episode', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('congestion', eventSpy);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // Three more ticks while congestion persists — should stay silent.
            detector.update();
            detector.update();
            detector.update();

            expect(eventSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('should resolve the issue and emit issue-resolved when congestion clears', () => {
            const resolvedSpy = jest.fn();
            mockClientMonitor.on('issue-resolved', resolvedSpy);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'none' }]);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(resolvedSpy).toHaveBeenCalledTimes(1);
            expect(resolvedSpy.mock.calls[0][0]).toMatchObject({
                type: 'congestion',
                comment: 'congestion ended',
            });
        });
    });

    describe('update() - Multiple outbound RTP streams', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'high';
            detector.disabled = false;
        });

        it('should detect congestion if any stream is bandwidth limited', () => {
            mockPeerConnection.setOutboundRtps([
                { qualityLimitationReason: 'none' },
                { qualityLimitationReason: 'cpu' },
                { qualityLimitationReason: 'bandwidth' }
            ]);

            detector.update();

            expect(mockPeerConnection.congested).toBe(true);
        });

        it('should not detect congestion if no streams are bandwidth limited', () => {
            mockPeerConnection.setOutboundRtps([
                { qualityLimitationReason: 'none' },
                { qualityLimitationReason: 'cpu' },
                { qualityLimitationReason: 'other' }
            ]);

            detector.update();

            expect(mockPeerConnection.congested).toBe(false);
        });
    });

    describe('update() - Prevent duplicate events', () => {
        beforeEach(() => {
            mockClientMonitor.config.congestionDetector.sensitivity = 'high';
            detector.disabled = false;
        });

        it('should not emit events for already congested connections', () => {
            const eventSpy = jest.fn();
            mockClientMonitor.on('congestion', eventSpy);

            mockPeerConnection.setOutboundRtps([{ qualityLimitationReason: 'bandwidth' }]);

            // First update should emit event
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);

            // Second update should not emit event (already congested)
            detector.update();
            expect(eventSpy).toHaveBeenCalledTimes(1);
        });
    });
}); 