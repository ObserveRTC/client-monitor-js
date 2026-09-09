import { mockIssueRegistry } from "../helpers/detectorMocks";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { BlockedStunRequestsDetector } from "../../src/detectors/BlockedStunRequestsDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        blockedStunRequestsDetector: {
            responseReceivedTimeoutInMs: 10_000,
            requestsSentTimeoutInMs: 10_000,
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
            return existing;
        }
        const issue: TestIssue = { id: `iss_${this.nextId++}`, type: input.type, key, payload: input.payload ?? {} };
        this.activeIssues.set(key, issue);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown> }) {
        const found = this.activeIssues.get(key);
        if (!found) return undefined;
        this.activeIssues.delete(key);
        this.resolvedIssues.push({ ...found, payload: opts?.payload ?? found.payload, comment: opts?.comment });
        return found;
    }

    getIssues() {
        return [...this.activeIssues.values()];
    }

    getIssuesByType(type: string) {
        return this.getIssues().filter(issue => issue.type === type);
    }
}

class MockCandidatePair {
    public state: string | undefined = 'succeeded';
    /**
     * Interval deltas, not totals. The detector must read these: a pair only reaches
     * `succeeded` because a response arrived, so the cumulative `responsesReceived` is
     * >= 1 forever and testing it could never fire.
     */
    public deltaResponsesReceived: number | undefined = 0;
    public deltaRequestsSent: number | undefined = 0;
    /** After nomination the STUN still leaving is consent, counted separately by the spec. */
    public deltaConsentRequestsSent: number | undefined = 1;
    public currentRoundTripTime: number | undefined = 0.05;
    public pathKind = 'direct';
}

class MockIceTransport {
    /**
     * This mock's own issue registry, created lazily so it does not depend on field order.
     * It routes back into the local client mock, leaving every existing assertion intact.
     */
    private _issues?: IssueRegistry;
    public get issues(): IssueRegistry {
        return this._issues ??= mockIssueRegistry(this.getPeerConnection().parent);
    }

    /** Every clock in this detector accumulates stats time, so the specs advance this. */
    public deltaTime: number | undefined = 2000;
    /** Set by this detector while it has an open finding on this transport. */
    public blocked = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public peerConnection: any;

    public constructor(
        public id = 'transport-1',
        public pair: MockCandidatePair | undefined = new MockCandidatePair(),
    ) {
    }

    getSelectedCandidatePair() {
        return this.pair;
    }

    getPeerConnection() {
        return this.peerConnection;
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    /** Only the transports that still exist, as on the real monitor. */
    public iceTransports: MockIceTransport[] = [];

    /**
     * Derived exactly as the real monitor derives it, so a transport dropped from
     * `iceTransports` stops being counted.
     */
    public get blockedTransport(): boolean {
        return this.iceTransports.some((transport) => transport.blocked);
    }
}

describe('BlockedStunRequestsDetector', () => {
    let detector: BlockedStunRequestsDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;
    let pair: MockCandidatePair;

    /** Runs `count` ticks, each describing `transport.deltaTime` of stats time. */
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        pair = new MockCandidatePair();
        transport = new MockIceTransport('transport-1', pair);
        transport.peerConnection = mockPeerConnection;
        mockPeerConnection.iceTransports = [ transport ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new BlockedStunRequestsDetector(transport as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('blocked-stun-requests-detector');
        });
    });

    describe('Raising', () => {
        it('raises once the path has answered nothing past the timeout', () => {
            ticks(6); // 12s of stats time > 10s

            const issues = mockClientMonitor.getIssuesByType('blocked-stun-requests');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.transportId).toBe('transport-1');
            expect(issues[0]!.payload.pathKind).toBe('direct');
        });

        it('does not raise before the timeout', () => {
            ticks(4); // 8s

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        /**
         * The counters are cumulative and monotonic, and a pair only reaches `succeeded`
         * because a response arrived. Reading totals rather than deltas made the raise
         * condition `0 < responsesReceived`, which is true forever from the first tick
         * this detector may run — it could never fire at all.
         */
        it('judges the interval, not the running totals', () => {
            // Whatever the pair has accumulated over the call, only this interval counts.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (pair as any).responsesReceived = 4_000;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (pair as any).requestsSent = 4_000;

            ticks(6);

            expect(mockClientMonitor.getIssuesByType('blocked-stun-requests')).toHaveLength(1);
        });

        // The issue dedupes on its key; the event does not. Without a raised-guard this
        // emitted once per collection for the whole life of the block.
        it('emits once, not once per tick', () => {
            ticks(30);

            expect(mockClientMonitor.emitted).toHaveLength(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('carries the window and the unanswered request count', () => {
            ticks(6);

            const [ issue ] = mockClientMonitor.getIssuesByType('blocked-stun-requests');

            // Raised on the fifth tick, the first at which 10s of stats time had accrued;
            // the payload is the snapshot taken then, not whatever the window grew to.
            expect(issue?.payload.silentForMs).toBe(10_000);
            expect(issue?.payload.requestsSent).toBe(5);
            expect(issue?.payload.currentRoundTripTime).toBe(0.05);
        });

        it('resolves when the path answers again', () => {
            ticks(6);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            pair.deltaResponsesReceived = 1;
            ticks(1);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
        });

        // Consent runs every 4-6s against a shorter collecting period, so most ticks
        // carry no request at all. The window accumulates silence and only needs some
        // request to have gone out during it.
        it('tolerates ticks that carry no request', () => {
            for (let i = 0; i < 6; ++i) {
                pair.deltaConsentRequestsSent = i % 3 === 0 ? 1 : 0;
                detector.update();
            }

            expect(mockClientMonitor.getIssuesByType('blocked-stun-requests')).toHaveLength(1);
        });

        /**
         * `requestsSent` is connectivity checks only; the spec counts consent separately.
         * After nomination consent is the only STUN still leaving, so requiring
         * `deltaRequestsSent` alone would be the same never-fires trap one counter along.
         */
        it('counts connectivity checks and consent requests alike', () => {
            pair.deltaConsentRequestsSent = 0;
            pair.deltaRequestsSent = 1;

            ticks(6);

            expect(mockClientMonitor.getIssuesByType('blocked-stun-requests')).toHaveLength(1);
        });
    });

    describe('Standing down', () => {
        it('returns early when disabled', () => {
            detector.disabled = true;

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing on a pair that has not succeeded', () => {
            pair.state = 'in-progress';

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            // Nothing to judge is not the same as nothing to see with.
            expect(detector.inputsUnavailable).toBe(false);
        });

        it('stands down when no STUN is going out at all', () => {
            pair.deltaConsentRequestsSent = 0;
            pair.deltaRequestsSent = 0;

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(detector.inputsUnavailable).toBe(false);
        });

        // A blocked path and a main thread too busy to collect on schedule are exactly
        // the pair that compounds: on wall-clock elapsed the second is counted as
        // evidence for the first.
        it("counts the transport's own time, not the time the collector was away", () => {
            jest.useFakeTimers();
            jest.setSystemTime(0);

            transport.deltaTime = 500;
            detector.update();

            jest.setSystemTime(60_000);
            ticks(4);

            // 2.5s of stats time against a minute of wall clock, under the 10s bar
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            jest.useRealTimers();
        });

        /**
         * Most ticks on a healthy transport answer STUN with no window open, and there
         * is nothing for the teardown to tear down. Every call site tests
         * `_silentForInMs` first so those ticks fall straight through.
         */
        it('never reaches for teardown while nothing is being tracked', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');
            pair.deltaResponsesReceived = 1;

            ticks(200);

            expect(clear).not.toHaveBeenCalled();
        });

        // ...and the guard must not swallow a real resolve: a raised issue is still
        // tracked, so recovery goes through teardown as it should.
        it('still tears down once something is being tracked', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');

            ticks(6);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            pair.deltaResponsesReceived = 1;
            detector.update();

            expect(clear).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        // The guard tests the window, not the raise — so a pair that stops succeeding
        // mid-window still resets rather than carrying stale silence forward. Testing
        // `_raisedAt` instead would have leaked it.
        it('tears down an open window that never raised', () => {
            ticks(2);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');
            pair.state = 'failed';
            detector.update();

            expect(clear).toHaveBeenCalledTimes(1);

            pair.state = 'succeeded';
            ticks(4); // 8s of a fresh window, under the bar

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        /**
         * `deltaTime` is 0 on a transport whose stats have not advanced, so the first
         * tick can legitimately open a window of zero length. The guard tests
         * `!== undefined` rather than truthiness for exactly this: a `0` window is open,
         * and treating it as absent would strand the state.
         */
        it('treats a zero-length window as open', () => {
            transport.deltaTime = 0;
            detector.update();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');
            pair.deltaResponsesReceived = 1;
            detector.update();

            expect(clear).toHaveBeenCalledTimes(1);
        });

        it('restarts the window after the path recovers', () => {
            ticks(4);
            pair.deltaResponsesReceived = 1;
            detector.update();

            pair.deltaResponsesReceived = 0;
            ticks(4); // 8s again, under the bar

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Issue lifecycle', () => {
        it('resolves with the reason it stood down', () => {
            ticks(6);

            pair.deltaResponsesReceived = 1;
            detector.update();

            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('stun is answering again');
        });

        it('can raise again after a recovery', () => {
            ticks(6);
            pair.deltaResponsesReceived = 1;
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            pair.deltaResponsesReceived = 0;
            ticks(6);

            expect(mockClientMonitor.getIssuesByType('blocked-stun-requests')).toHaveLength(1);
            expect(mockClientMonitor.emitted).toHaveLength(2);
        });

        it('marks the connection blocked while the finding is open, and clears it', () => {
            expect(mockPeerConnection.blockedTransport).toBe(false);

            ticks(6);
            expect(mockPeerConnection.blockedTransport).toBe(true);

            pair.deltaResponsesReceived = 1;
            detector.update();

            expect(mockPeerConnection.blockedTransport).toBe(false);
        });

        it('stops marking the connection once the blocked transport is replaced', () => {
            ticks(6);
            expect(mockPeerConnection.blockedTransport).toBe(true);

            // The transport went away and a new one took its place: the old monitor is
            // dropped and its detector with it, so nothing is left to clear a flag.
            mockPeerConnection.iceTransports = [ new MockIceTransport('transport-2') ];

            expect(mockPeerConnection.blockedTransport).toBe(false);
        });

        it('leaves the connection unmarked while the window is still open', () => {
            ticks(4); // under the bar, nothing raised yet

            expect(mockPeerConnection.blockedTransport).toBe(false);
        });

        it('keys the issue per peer connection and transport', () => {
            ticks(6);

            const [ issue ] = mockClientMonitor.getIssues();

            expect(issue!.key).toBe('blocked-stun-requests-pc-test-pc-id-transport-transport-1');
        });
    });

    describe('inputsUnavailable', () => {
        it('is set when the response counter is not reported', () => {
            pair.deltaResponsesReceived = undefined;

            ticks(10);

            expect(detector.inputsUnavailable).toBe(true);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('is set when neither request counter is reported', () => {
            pair.deltaRequestsSent = undefined;
            pair.deltaConsentRequestsSent = undefined;

            ticks(10);

            expect(detector.inputsUnavailable).toBe(true);
        });

        // Either counter alone is enough to say some STUN went out.
        it('is not set when only one request counter is missing', () => {
            pair.deltaRequestsSent = undefined;
            pair.deltaConsentRequestsSent = 1;

            ticks(6);

            expect(detector.inputsUnavailable).toBe(false);
            expect(mockClientMonitor.getIssuesByType('blocked-stun-requests')).toHaveLength(1);
        });
    });
});
