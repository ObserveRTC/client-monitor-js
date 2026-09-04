import { DtlsHandshakeStalledDetector } from "../../src/detectors/DtlsHandshakeStalledDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        dtlsHandshakeStalledDetector: {
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
    /** Stats time between collections — this is the stall clock the detector reads. */
    public deltaTime: number | undefined = 2000;

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

describe('DtlsHandshakeStalledDetector', () => {
    let detector: DtlsHandshakeStalledDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    /** Runs `count` detector ticks, each carrying 2s of stats time on the transport. */
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = new MockIceTransport('transport-1', 'connected', 'connecting');
        mockPeerConnection.iceTransports = [ transport ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new DtlsHandshakeStalledDetector(mockPeerConnection as any);
    });

    it('raises when ICE is healthy and DTLS sits in connecting past the threshold', () => {
        ticks(4); // first tick is maturity, the stall clock accumulates from tick 2

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(1);
    });

    it('does not raise before the threshold', () => {
        ticks(2);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
    });

    it('measures the stall in stats time, not in ticks', () => {
        // one collection that covered 20s of stats time is a 20s stall, however
        // few times update() happened to run
        transport.deltaTime = 20_000;
        ticks(2);

        const [ issue ] = mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE);

        expect(issue.payload.stalledForMs).toBe(20_000);
    });

    it('never judges a transport on its first observed tick', () => {
        // the threshold could only be met if the first tick armed the clock
        mockClientMonitor.config.dtlsHandshakeStalledDetector.stalledThresholdInMs = 0;
        ticks(1);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
    });

    it('does not raise while ICE itself is not proven healthy', () => {
        transport.iceState = 'checking';
        ticks(6);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
    });

    it('proves ICE by the selected pair where the browser reports no iceState', () => {
        transport.iceState = undefined; // Safari / reconstructed Firefox transport
        ticks(4);

        const [ issue ] = mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE);

        expect(issue).toBeDefined();
        expect(issue.payload.iceEvidence).toBe('selected-pair-succeeded');
    });

    it('stays quiet without iceState and without a succeeded pair', () => {
        transport.iceState = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (transport.getSelectedCandidatePair() as any).state = 'in-progress';
        ticks(6);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
    });

    it('treats dtlsState closed as a shutdown, never a stall', () => {
        transport.dtlsState = 'closed';
        ticks(6);

        expect(mockClientMonitor.activeIssues.size).toBe(0);
    });

    it('says nothing about a handshake that failed outright — that is its sibling detector', () => {
        transport.dtlsState = 'failed';
        ticks(6);

        expect(mockClientMonitor.activeIssues.size).toBe(0);
    });

    it('resolves when the handshake completes', () => {
        ticks(4);
        transport.dtlsState = 'connected';
        ticks(1);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
        expect(mockClientMonitor.resolvedIssues.some(issue => issue.type === DtlsHandshakeStalledDetector.ISSUE_TYPE)).toBe(true);
    });

    it('resolves an open stall when the handshake then fails', () => {
        ticks(4);
        transport.dtlsState = 'failed';
        ticks(1);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
        expect(mockClientMonitor.resolvedIssues.some(issue => issue.comment === 'dtls handshake failed')).toBe(true);
    });

    it('restarts the stall clock when the ICE username fragment changes (ICE restart)', () => {
        ticks(3); // clock running, threshold not yet met
        transport.iceLocalUsernameFragment = 'ufrag-2'; // restart re-keys DTLS
        ticks(2); // would have crossed the threshold on the old clock

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeStalledDetector.ISSUE_TYPE)).toHaveLength(0);
    });

    it('resolves everything when the transport is gone', () => {
        ticks(4);
        mockPeerConnection.iceTransports = [];
        ticks(1);

        expect(mockClientMonitor.activeIssues.size).toBe(0);
        expect(mockClientMonitor.resolvedIssues.some(issue => issue.comment === 'ice transport is gone')).toBe(true);
    });
});
