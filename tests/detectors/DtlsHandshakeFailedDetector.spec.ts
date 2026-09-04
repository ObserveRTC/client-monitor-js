import { DtlsHandshakeFailedDetector } from "../../src/detectors/DtlsHandshakeFailedDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        // The detector reads nothing out of its block: `dtls-handshake-failed`
        // is a terminal state, so there is no threshold to wait out. The block
        // is present only because that is what registers the detector.
        dtlsHandshakeFailedDetector: {},
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
    /** Stats time between collections; the failed detector never reads it, its sibling does. */
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

describe('DtlsHandshakeFailedDetector', () => {
    let detector: DtlsHandshakeFailedDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = new MockIceTransport('transport-1', 'connected', 'connecting');
        mockPeerConnection.iceTransports = [ transport ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new DtlsHandshakeFailedDetector(mockPeerConnection as any);
    });

    it('raises immediately on dtlsState failed', () => {
        transport.dtlsState = 'failed';
        ticks(1);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeFailedDetector.ISSUE_TYPE)).toHaveLength(1);
        expect(mockClientMonitor.emitted.map(entry => entry.name)).toContain('dtls-handshake-failed');
    });

    it('raises once, not per tick', () => {
        transport.dtlsState = 'failed';
        ticks(5);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeFailedDetector.ISSUE_TYPE)).toHaveLength(1);
    });

    it('says nothing about a handshake that is merely still connecting', () => {
        ticks(5);

        expect(mockClientMonitor.activeIssues.size).toBe(0);
    });

    it('resolves when a later handshake connects (post ICE restart re-key)', () => {
        transport.dtlsState = 'failed';
        ticks(1);
        transport.dtlsState = 'connected';
        ticks(1);

        expect(mockClientMonitor.getIssuesByType(DtlsHandshakeFailedDetector.ISSUE_TYPE)).toHaveLength(0);
        expect(mockClientMonitor.resolvedIssues.some(issue => issue.type === DtlsHandshakeFailedDetector.ISSUE_TYPE)).toBe(true);
    });

    it('resolves when the transport is gone', () => {
        transport.dtlsState = 'failed';
        ticks(1);
        mockPeerConnection.iceTransports = [];
        ticks(1);

        expect(mockClientMonitor.activeIssues.size).toBe(0);
        expect(mockClientMonitor.resolvedIssues.some(issue => issue.comment === 'ice transport is gone')).toBe(true);
    });
});
