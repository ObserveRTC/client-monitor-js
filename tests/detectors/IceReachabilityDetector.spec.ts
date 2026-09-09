import { mockIssueRegistry } from "../helpers/detectorMocks";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { IceReachabilityDetector } from "../../src/detectors/IceReachabilityDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        iceReachabilityDetector: {
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
    public closed = false;
    public connectionState: string | undefined = 'new';
    // Gathering has finished looking by default; that is what makes zero
    // candidates evidence rather than a work-in-progress observation.
    public iceGatheringState: string | undefined = 'complete';
    public localIceCandidates: unknown[] = [];
    public deltaTime: number | undefined = undefined;

    /**
     * Advances the peer connection's own stats clock — the gap between the two
     * reports this collection read, and the only clock the detector's threshold
     * accumulates. Advancing fake timers instead would drive nothing.
     */
    tick(elapsedInMs = 2000) {
        this.deltaTime = elapsedInMs;

        return this;
    }
}

describe('IceReachabilityDetector', () => {
    let detector: IceReachabilityDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    /** Runs `count` collections, each covering 2s of the peer connection's stats clock. */
    const ticks = (count: number, elapsedMs = 2000) => {
        for (let i = 0; i < count; ++i) {
            mockPeerConnection.tick(elapsedMs);
            detector.update();
        }
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceReachabilityDetector(mockPeerConnection as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('ice-reachability-detector');
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

        it('says nothing while gathering is still running', () => {
            mockPeerConnection.iceGatheringState = 'gathering';
            mockPeerConnection.connectionState = 'failed';

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('says nothing when the source reports no gathering state at all', () => {
            // a stats source that emits no candidate rows is not a source that
            // observed zero candidates
            mockPeerConnection.iceGatheringState = undefined;
            mockPeerConnection.connectionState = 'failed';

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
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

            ticks(4); // 8s of stats time > 6s threshold

            const issues = mockClientMonitor.getIssues();

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.sustainedForInMs).toBe(6000);
        });

        it('does not raise before the threshold', () => {
            mockPeerConnection.connectionState = 'connecting';

            ticks(2); // 4s of stats time < 6s threshold

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('never raises on wall-clock time alone, with no stats time behind it', () => {
            // The condition being timed is "the connection has gone this long without
            // a candidate", and a collection that never ran observed none of it. An
            // hour on the system clock with no advancing stats timestamps is a
            // suspended tab, not an hour of a client with no network.
            jest.useFakeTimers();
            jest.setSystemTime(0);
            mockPeerConnection.connectionState = 'connecting';

            for (let i = 0; i < 10; ++i) {
                jest.setSystemTime((i + 1) * 360_000);
                mockPeerConnection.deltaTime = 0;
                detector.update();
            }

            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            // and the very same detector still raises once stats time does move
            ticks(4);

            expect(mockClientMonitor.getIssues()).toHaveLength(1);
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
