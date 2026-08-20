import { NoAvailableIceCandidateDetector } from "../../src/detectors/NoAvailableIceCandidateDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        noAvailableIceCandidateDetector: {
            thresholdInMs: 6000,
        },
    };

    public readonly activeIssues = new Map<string, TestIssue>();
    public readonly resolvedIssues: (TestIssue & { comment?: string })[] = [];
    public readonly emitted: { name: string; payload: Record<string, unknown> }[] = [];
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        this.emitted.push({ name: eventName, payload: eventData });
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
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    public connectionState: string | undefined = 'new';
    public iceGatheringState: string | undefined = 'new';
    public localIceCandidates: unknown[] = [];
}

describe('NoAvailableIceCandidateDetector', () => {
    let detector: NoAvailableIceCandidateDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new NoAvailableIceCandidateDetector(mockPeerConnection as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('no-available-ice-candidate-detector');
        });
    });

    describe('Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            mockPeerConnection.connectionState = 'failed';

            ticks(5);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing when local candidates exist', () => {
            mockPeerConnection.localIceCandidates = [ { id: 'candidate-1' } ];
            mockPeerConnection.connectionState = 'failed';

            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Immediate raise on failure with zero candidates', () => {
        it('raises when the connection jumps new -> disconnected with no candidate', () => {
            ticks(1); // observed in 'new'
            mockPeerConnection.connectionState = 'disconnected';
            ticks(1);

            const issues = mockClientMonitor.getIssues();

            expect(issues).toHaveLength(1);
            expect(issues[0]!.type).toBe('no-available-ice-candidate');
            expect(issues[0]!.payload.connectionState).toBe('disconnected');
            expect(issues[0]!.payload.previousConnectionState).toBe('new');
            expect(issues[0]!.payload.localIceCandidateCount).toBe(0);
        });

        it('raises when the connection goes to failed with no candidate', () => {
            mockPeerConnection.connectionState = 'connecting';
            ticks(1);
            mockPeerConnection.connectionState = 'failed';
            ticks(1);

            const issues = mockClientMonitor.getIssues();

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.previousConnectionState).toBe('connecting');
        });

        it('emits the monitor event when raising', () => {
            mockPeerConnection.connectionState = 'failed';
            ticks(1);

            const events = mockClientMonitor.emitted.filter(entry => entry.name === 'no-available-ice-candidate');

            expect(events).toHaveLength(1);
        });

        it('records the gathering state in the payload', () => {
            mockPeerConnection.iceGatheringState = 'complete';
            mockPeerConnection.connectionState = 'failed';
            ticks(1);

            expect(mockClientMonitor.getIssues()[0]!.payload.iceGatheringState).toBe('complete');
        });
    });

    describe('Sustained raise while stuck without candidates', () => {
        it('raises after the threshold when stuck in connecting with no candidate', () => {
            mockPeerConnection.connectionState = 'connecting';

            ticks(4); // 8s > 6s threshold

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('does not raise before the threshold', () => {
            mockPeerConnection.connectionState = 'connecting';

            ticks(2); // 4s < 6s threshold

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Resolution and suppression', () => {
        it('resolves when a local candidate appears', () => {
            mockPeerConnection.connectionState = 'disconnected';
            ticks(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.localIceCandidates = [ { id: 'candidate-1' } ];
            ticks(1);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues).toHaveLength(1);
            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('local ice candidate appeared');
            expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
        });

        it('resolves when the connection establishes', () => {
            mockPeerConnection.connectionState = 'disconnected';
            ticks(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.connectionState = 'connected';
            ticks(1);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('connection established');
        });

        it('never judges a connection that once connected', () => {
            mockPeerConnection.localIceCandidates = [ { id: 'candidate-1' } ];
            mockPeerConnection.connectionState = 'connected';
            ticks(1);

            // mid-call network loss: candidates age out of stats, state falls over
            mockPeerConnection.localIceCandidates = [];
            mockPeerConnection.connectionState = 'disconnected';
            ticks(10);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('does not raise twice for the same episode', () => {
            mockPeerConnection.connectionState = 'failed';
            ticks(5);

            const events = mockClientMonitor.emitted.filter(entry => entry.name === 'no-available-ice-candidate');

            expect(events).toHaveLength(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });
    });
});
