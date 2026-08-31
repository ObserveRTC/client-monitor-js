import { DtlsHandshakeDetector } from "../../src/detectors/DtlsHandshakeDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        dtlsHandshakeDetector: {
            stalledThresholdInMs: 6000,
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
        const issue: TestIssue = {
            id: `iss_${this.nextId++}`,
            type: input.type,
            key,
            payload: input.payload ?? {},
        };
        this.activeIssues.set(key, issue);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown> }) {
        const found = this.activeIssues.get(key);
        if (!found) return undefined;
        this.activeIssues.delete(key);
        const resolved = { ...found, payload: opts?.payload ?? found.payload, comment: opts?.comment };
        this.resolvedIssues.push(resolved);
        return resolved;
    }

    getIssuesByType(type: string) {
        return [ ...this.activeIssues.values() ].filter(issue => issue.type === type);
    }
}

class MockCandidatePair {
    public state: string | undefined = 'succeeded';
    public localCandidate: { usernameFragment?: string } = {};

    getLocalCandidate() {
        return this.localCandidate;
    }
}

class MockIceTransport {
    public selectedCandidatePairId: string | undefined = 'pair-1';
    public iceLocalUsernameFragment: string | undefined = 'ufrag-1';

    constructor(
        public id: string,
        public iceState: string | undefined,
        public dtlsState: string | undefined,
        private pair: MockCandidatePair | undefined = new MockCandidatePair(),
    ) {}

    getSelectedCandidatePair() {
        return this.pair;
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    public iceTransports: MockIceTransport[] = [];
}

describe('DtlsHandshakeDetector', () => {
    let detector: DtlsHandshakeDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

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
        transport = new MockIceTransport('transport-1', 'connected', 'connecting');
        mockPeerConnection.iceTransports = [ transport ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new DtlsHandshakeDetector(mockPeerConnection as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('dtls-handshake-failed', () => {
        it('raises immediately on dtlsState failed', () => {
            transport.dtlsState = 'failed';
            ticks(1);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.FAILED_ISSUE_TYPE)).toHaveLength(1);
            expect(mockClientMonitor.emitted.map(entry => entry.name)).toContain('dtls-handshake-failed');
        });

        it('raises once, not per tick', () => {
            transport.dtlsState = 'failed';
            ticks(5);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.FAILED_ISSUE_TYPE)).toHaveLength(1);
        });

        it('resolves when a later handshake connects (post ICE restart re-key)', () => {
            transport.dtlsState = 'failed';
            ticks(1);
            transport.dtlsState = 'connected';
            ticks(1);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.FAILED_ISSUE_TYPE)).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues.some(issue => issue.type === DtlsHandshakeDetector.FAILED_ISSUE_TYPE)).toBe(true);
        });
    });

    describe('dtls-handshake-stalled', () => {
        it('raises when ICE is healthy and DTLS sits in connecting past the threshold', () => {
            ticks(5); // first tick is maturity, stall timer starts on tick 2

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(1);
        });

        it('does not raise before the threshold', () => {
            ticks(2);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(0);
        });

        it('never judges a transport on its first observed tick', () => {
            // the threshold could only be met if the first tick armed the timer
            mockClientMonitor.config.dtlsHandshakeDetector.stalledThresholdInMs = 0;
            ticks(1);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(0);
        });

        it('does not raise while ICE itself is not proven healthy', () => {
            transport.iceState = 'checking';
            ticks(6);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(0);
        });

        it('proves ICE by the selected pair where the browser reports no iceState', () => {
            transport.iceState = undefined; // Safari / reconstructed Firefox transport
            ticks(5);

            const [ issue ] = mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE);

            expect(issue).toBeDefined();
            expect(issue.payload.iceEvidence).toBe('selected-pair-succeeded');
        });

        it('stays quiet without iceState and without a succeeded pair', () => {
            transport.iceState = undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (transport.getSelectedCandidatePair() as any).state = 'in-progress';
            ticks(6);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(0);
        });

        it('treats dtlsState closed as a shutdown, never a stall', () => {
            transport.dtlsState = 'closed';
            ticks(6);

            expect(mockClientMonitor.activeIssues.size).toBe(0);
        });

        it('resolves when the handshake completes', () => {
            ticks(5);
            transport.dtlsState = 'connected';
            ticks(1);

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues.some(issue => issue.type === DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toBe(true);
        });

        it('restarts the stall timer when the ICE username fragment changes (ICE restart)', () => {
            ticks(3); // timer armed, threshold not yet met
            transport.iceLocalUsernameFragment = 'ufrag-2'; // restart re-keys DTLS
            ticks(2); // would have crossed the threshold on the old timer

            expect(mockClientMonitor.getIssuesByType(DtlsHandshakeDetector.STALLED_ISSUE_TYPE)).toHaveLength(0);
        });

        it('resolves everything when the transport is gone', () => {
            ticks(5);
            mockPeerConnection.iceTransports = [];
            ticks(1);

            expect(mockClientMonitor.activeIssues.size).toBe(0);
            expect(mockClientMonitor.resolvedIssues.some(issue => issue.comment === 'ice transport is gone')).toBe(true);
        });
    });
});
