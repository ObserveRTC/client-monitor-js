/* eslint-disable @typescript-eslint/no-explicit-any */
import { TransportDemuxStalledDetector } from "../../src/detectors/TransportDemuxStalledDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        transportDemuxStalledDetector: {
            thresholdInMs: 4000,
            minTransportReceiveBitrateBps: 20_000,
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
        const resolved = { ...found, payload: opts?.payload ?? found.payload, comment: opts?.comment };
        this.resolvedIssues.push(resolved);
        return resolved;
    }

    getIssuesByType(type: string) {
        return [...this.activeIssues.values()].filter(issue => issue.type === type);
    }
}

class MockInboundRtp {
    public constructor(
        public transportId: string | undefined = 'transport-1',
        public deltaBytesReceived: number | undefined = 0,
    ) {}
}

class MockIceTransport {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public peerConnection: any;

    public constructor(
        public id = 'transport-1',
        public receivingBitrate: number | undefined = 500_000,
        /** The stall clock is stats time, so the interval comes off the monitor. */
        public deltaTime: number | undefined = 2000,
    ) {}

    /** Mirrors `IceTransportMonitor`: a plain `transportId` lookup. */
    getInboundRtps(): MockInboundRtp[] {
        const rtps: MockInboundRtp[] = this.peerConnection?.inboundRtps ?? [];

        return rtps.filter(rtp => rtp.transportId === this.id);
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    public inboundRtps: MockInboundRtp[] = [];
    private _iceTransports: MockIceTransport[] = [];

    public get iceTransports(): MockIceTransport[] {
        return this._iceTransports;
    }

    /** Attaching a transport back-links it, so its RTP reader can resolve streams. */
    public set iceTransports(transports: MockIceTransport[]) {
        this._iceTransports = transports;

        for (const transport of transports) transport.peerConnection = this;
    }
}

describe('TransportDemuxStalledDetector', () => {
    let detector: TransportDemuxStalledDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    // Each tick carries 2000ms of stats time, so the 4000ms threshold is
    // crossed on the third consecutive broken tick.
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        detector = new TransportDemuxStalledDetector(mockPeerConnection as any);
        mockPeerConnection.iceTransports = [ new MockIceTransport() ];
        mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 0) ];
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('transport-demux-stalled-detector');
    });

    it('raises when the transport receives but nothing demuxes, sustained', () => {
        ticks(4);

        const issues = mockClientMonitor.getIssuesByType('transport-demux-stalled');

        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload.transportId).toBe('transport-1');
        expect(issues[0]!.payload.demuxedBytesDelta).toBe(0);
        expect(issues[0]!.payload.transportReceivingBitrate).toBe(500_000);
    });

    it('does not raise before the threshold', () => {
        ticks(2); // 2000ms of stats time, not yet past the threshold

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });

    it('measures the stall in stats time, not wall-clock', () => {
        mockPeerConnection.iceTransports = [ new MockIceTransport('transport-1', 500_000, 500) ];

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);

        ticks(4);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(1);
    });

    it('stays silent when the inbound rtp accounts for the traffic', () => {
        mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 120_000) ];

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });

    it('stays silent below the media-level receive rate (RTCP/STUN only)', () => {
        mockPeerConnection.iceTransports = [ new MockIceTransport('transport-1', 2_000) ];

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });

    it('stays silent without any inbound rtp (no demux expectation)', () => {
        mockPeerConnection.inboundRtps = [];

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });

    describe('inputsUnavailable', () => {
        // Firefox does not populate `RTCTransportStats.bytesReceived` as of 153, so
        // `receivingBitrate` is undefined there and this detector cannot see whether
        // anything arrived at all. The flag is what separates that from health.
        /** A default parameter would swallow an explicitly-passed `undefined`. */
        const transportWithoutBitrate = () => {
            const transport = new MockIceTransport('transport-1');

            transport.receivingBitrate = undefined;

            return transport;
        };

        it('is set when the transport reports no receiving bitrate and nothing demuxed', () => {
            mockPeerConnection.iceTransports = [ transportWithoutBitrate() ];

            ticks(6);

            expect(detector.inputsUnavailable).toBe(true);
            expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
        });

        it('is cleared once the bitrate is reported again', () => {
            mockPeerConnection.iceTransports = [ transportWithoutBitrate() ];
            ticks(1);
            expect(detector.inputsUnavailable).toBe(true);

            mockPeerConnection.iceTransports = [ new MockIceTransport('transport-1', 500_000) ];
            ticks(1);

            expect(detector.inputsUnavailable).toBe(false);
        });

        it('stays false while media is demuxing, bitrate or not', () => {
            mockPeerConnection.iceTransports = [ transportWithoutBitrate() ];
            mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 120_000) ];

            ticks(2);

            expect(detector.inputsUnavailable).toBe(false);
        });

        it('is not set where there is no demux expectation to violate', () => {
            mockPeerConnection.iceTransports = [ transportWithoutBitrate() ];
            mockPeerConnection.inboundRtps = [];

            ticks(2);

            expect(detector.inputsUnavailable).toBe(false);
        });
    });

    it('resolves when demuxing resumes', () => {
        ticks(4);
        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(1);

        mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 120_000) ];
        ticks(1);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
        expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
    });

    it('resolves when the transport is gone', () => {
        ticks(4);
        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(1);

        mockPeerConnection.iceTransports = [];
        ticks(1);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });

    it('reads no issue but its own', () => {
        // the predecessor annotated its payload with every other active issue on
        // the peer connection; that coupling is gone
        mockClientMonitor.activeIssues.set('other', {
            id: 'x',
            type: 'congestion',
            payload: { peerConnectionId: 'test-pc-id' },
        });

        ticks(4);

        const issue = mockClientMonitor.getIssuesByType('transport-demux-stalled')[0]!;

        expect(issue.payload.suspectedIssueTypes).toBeUndefined();
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });

    it('should return early on a closed peer connection', () => {
        mockPeerConnection.closed = true;

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('transport-demux-stalled')).toHaveLength(0);
    });
});
