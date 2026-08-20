import { BlockedTransportDetector } from "../../src/detectors/BlockedTransportDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

interface EventHandler {
    (event: Record<string, unknown>): void;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        blockedTransportDetector: {
            thresholdInMs: 5000,
            minMediaBitrateBps: 10_000,
            maxReturnBitrateBps: 2_000,
            maxSendShare: 0.1,
            stunFreshnessInMs: 10_000,
        },
    };

    private eventHandlers: { [key: string]: EventHandler[] } = {};
    public readonly activeIssues = new Map<string, TestIssue>();
    public readonly resolvedIssues: (TestIssue & { comment?: string })[] = [];
    public readonly emitted: { name: string; payload: Record<string, unknown> }[] = [];
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        this.emitted.push({ name: eventName, payload: eventData });
        (this.eventHandlers[eventName] ?? []).forEach(handler => handler(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        (this.eventHandlers[eventName] ??= []).push(handler);
    }

    raiseIssue(key: string, input: { type: string; payload?: Record<string, unknown> }) {
        const existing = this.activeIssues.get(key);
        if (existing) {
            existing.payload = input.payload ?? {};
            existing.type = input.type;
            return existing;
        }
        const issue: TestIssue = {
            id: `iss_${this.nextId++}`,
            type: input.type,
            key,
            payload: input.payload ?? {},
        };
        this.activeIssues.set(key, issue);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown>; resolvedAt?: number }) {
        const found = this.activeIssues.get(key);
        if (!found) return undefined;
        this.activeIssues.delete(key);
        const resolved = {
            ...found,
            payload: opts?.payload ?? found.payload,
            comment: opts?.comment,
        };
        this.resolvedIssues.push(resolved);
        return resolved;
    }

    getIssues() {
        return [...this.activeIssues.values()];
    }

    getIssuesByType(type: string) {
        return this.getIssues().filter(issue => issue.type === type);
    }
}

class MockCandidatePair {
    public id = 'pair-1';
    public state: string | undefined = 'succeeded';
    public deltaBytesSent: number | undefined = 0;
    public deltaBytesReceived: number | undefined = 0;
    public deltaResponsesReceived: number | undefined = 0;
    public currentRoundTripTime: number | undefined = 0.05;
    public pathKind = 'direct';
}

class MockIceTransport {
    public sendingBitrate: number | undefined = undefined;
    public receivingBitrate: number | undefined = undefined;

    public constructor(
        public id = 'transport-1',
        public iceState: string | undefined = 'connected',
        public pair: MockCandidatePair | undefined = new MockCandidatePair(),
    ) {
    }

    getSelectedCandidatePair() {
        return this.pair;
    }
}

class MockOutboundRtp {
    public constructor(
        public transportId: string | undefined = 'transport-1',
        public bitrate: number | undefined = 0,
    ) {
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    public iceTransports: MockIceTransport[] = [];
    public outboundRtps: MockOutboundRtp[] = [];
}

describe('BlockedTransportDetector', () => {
    let detector: BlockedTransportDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;
    let pair: MockCandidatePair;

    /** One healthy-looking tick: STUN answered, media produced. */
    const makeStunAlive = () => {
        pair.deltaResponsesReceived = 1;
    };

    const makeProducing = (bitrate = 500_000) => {
        mockPeerConnection.outboundRtps = [ new MockOutboundRtp('transport-1', bitrate) ];
    };

    /** Runs `count` detector ticks, each advancing the fake clock by 2s. */
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) {
            detector.update();
            jest.advanceTimersByTime(2000);
        }
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        pair = new MockCandidatePair();
        transport = new MockIceTransport('transport-1', 'connected', pair);
        mockPeerConnection.iceTransports = [ transport ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new BlockedTransportDetector(mockPeerConnection as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('blocked-transport-detector');
        });
    });

    describe('Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            makeStunAlive();
            makeProducing();
            transport.receivingBitrate = 0;

            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing while media traverses the transport', () => {
            makeStunAlive();
            makeProducing(500_000);
            transport.sendingBitrate = 480_000;
            transport.receivingBitrate = 20_000;

            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing when the transport is not connected', () => {
            transport.iceState = 'checking';
            makeStunAlive();
            makeProducing();
            transport.receivingBitrate = 0;

            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('no-return-traffic evidence', () => {
        beforeEach(() => {
            makeProducing(500_000);
            transport.sendingBitrate = 480_000; // media leaves fine
            transport.receivingBitrate = 500;   // ...but only STUN comes back
        });

        it('raises after the threshold when only STUN returns', () => {
            makeStunAlive();
            ticks(4); // 8s > 5s threshold, stun stays fresh (10s)

            const issues = mockClientMonitor.getIssuesByType('blocked-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.evidence).toBe('no-return-traffic');
            expect(issues[0]!.payload.transportId).toBe('transport-1');
            expect(issues[0]!.payload.pathKind).toBe('direct');
        });

        it('does not raise before the threshold', () => {
            makeStunAlive();
            ticks(2); // 4s < 5s threshold

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('emits the monitor event when raising', () => {
            makeStunAlive();
            ticks(4);

            const events = mockClientMonitor.emitted.filter(entry => entry.name === 'blocked-transport');

            expect(events).toHaveLength(1);
            expect(events[0]!.payload.evidence).toBe('no-return-traffic');
        });

        it('stays silent when STUN is not confirming the path', () => {
            pair.deltaResponsesReceived = 0; // never any STUN response observed

            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('stays silent when nothing significant is being produced', () => {
            makeStunAlive();
            makeProducing(5_000); // below minMediaBitrateBps

            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('resolves when return traffic resumes', () => {
            makeStunAlive();
            ticks(4);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            transport.receivingBitrate = 50_000;
            ticks(1);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues).toHaveLength(1);
            expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
        });

        it('resolves when the transport is gone', () => {
            makeStunAlive();
            ticks(4);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.iceTransports = [];
            ticks(1);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('resolves when production stops', () => {
            makeStunAlive();
            ticks(4);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            makeProducing(0);
            ticks(1);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('media-not-leaving-transport evidence', () => {
        it('raises when the transport sends a fraction of what is produced', () => {
            makeStunAlive();
            makeProducing(500_000);
            transport.sendingBitrate = 10_000; // 2% of produced < 10% maxSendShare
            transport.receivingBitrate = 50_000;

            ticks(4);

            const issues = mockClientMonitor.getIssuesByType('blocked-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.evidence).toBe('media-not-leaving-transport');
        });

        it('prefers send-blocked evidence over return-path evidence', () => {
            makeStunAlive();
            makeProducing(500_000);
            transport.sendingBitrate = 0;
            transport.receivingBitrate = 0;

            ticks(4);

            const issues = mockClientMonitor.getIssuesByType('blocked-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.evidence).toBe('media-not-leaving-transport');
        });
    });

    describe('STUN freshness', () => {
        it('keeps the verdict while consent responses arrive on some ticks only', () => {
            makeProducing(500_000);
            transport.sendingBitrate = 480_000;
            transport.receivingBitrate = 500;

            // consent responses arrive roughly every 5s -> every other 2s tick
            for (let i = 0; i < 6; ++i) {
                pair.deltaResponsesReceived = i % 2 === 0 ? 1 : 0;
                detector.update();
                jest.advanceTimersByTime(2000);
            }

            expect(mockClientMonitor.getIssuesByType('blocked-transport')).toHaveLength(1);
        });

        it('drops the verdict when STUN goes quiet for longer than the freshness window', () => {
            makeStunAlive();
            makeProducing(500_000);
            transport.sendingBitrate = 480_000;
            transport.receivingBitrate = 500;

            ticks(4);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            // STUN dies: no responses for > stunFreshnessInMs
            pair.deltaResponsesReceived = 0;
            ticks(6); // 12s > 10s freshness

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Fallback bitrates from pair deltas', () => {
        it('derives transport rates from the pair when the transport lacks byte counters', () => {
            makeStunAlive();
            makeProducing(500_000);
            transport.sendingBitrate = undefined;
            transport.receivingBitrate = undefined;
            pair.deltaBytesSent = 120_000;  // ~480 kbps at 2s ticks
            pair.deltaBytesReceived = 100;  // ~400 bps -> STUN only

            ticks(4);

            const issues = mockClientMonitor.getIssuesByType('blocked-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.evidence).toBe('no-return-traffic');
        });
    });
});
