/* eslint-disable @typescript-eslint/no-explicit-any */
import { MediaPipelineDetector } from "../../src/detectors/MediaPipelineDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        mediaPipelineDetector: {
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

class MockOutboundRtp {
    public active: boolean | undefined = true;
    public deltaFramesEncoded: number | undefined = 0;
    public deltaPacketsSent: number | undefined = 0;
    public trackState = { id: 'video-out-1', muted: false, readyState: 'live' };

    public constructor(public ssrc = 1111) {}

    getTrack() {
        return { track: this.trackState };
    }
}

class MockInboundRtp {
    public constructor(
        public transportId: string | undefined = 'transport-1',
        public deltaBytesReceived: number | undefined = 0,
    ) {}
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    public outboundRtps: MockOutboundRtp[] = [];
    public inboundRtps: MockInboundRtp[] = [];
    public iceTransports: { id: string, receivingBitrate: number | undefined }[] = [];
    public mappedInboundTracks = new Map<string, unknown>();
    public mappedOutboundTracks = new Map<string, unknown>();
}

describe('MediaPipelineDetector', () => {
    let detector: MediaPipelineDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) {
            detector.update();
            jest.advanceTimersByTime(2000);
        }
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        detector = new MediaPipelineDetector(mockPeerConnection as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('media-pipeline-detector');
    });

    describe('rtp-sender boundary (send)', () => {
        let outboundRtp: MockOutboundRtp;

        beforeEach(() => {
            outboundRtp = new MockOutboundRtp();
            mockPeerConnection.outboundRtps = [ outboundRtp ];
        });

        it('raises when frames encode but no packet leaves, sustained', () => {
            outboundRtp.deltaFramesEncoded = 30;
            outboundRtp.deltaPacketsSent = 0;

            ticks(4); // 8s > 4s threshold

            const issues = mockClientMonitor.getIssuesByType('media-pipeline-stalled');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.stage).toBe('rtp-sender');
            expect(issues[0]!.payload.direction).toBe('send');
            expect(issues[0]!.payload.ssrc).toBe(1111);
        });

        it('does not raise before the threshold', () => {
            outboundRtp.deltaFramesEncoded = 30;
            outboundRtp.deltaPacketsSent = 0;

            ticks(2); // 4s, not yet past threshold at raise-check time

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('stays silent while the encoder is also idle (paused sender)', () => {
            outboundRtp.deltaFramesEncoded = 0;
            outboundRtp.deltaPacketsSent = 0;

            ticks(6);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('stays silent on muted tracks and inactive layers', () => {
            outboundRtp.deltaFramesEncoded = 30;
            outboundRtp.deltaPacketsSent = 0;
            outboundRtp.trackState.muted = true;

            ticks(6);
            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);

            outboundRtp.trackState.muted = false;
            outboundRtp.active = false;

            ticks(6);
            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('resolves when packets flow again', () => {
            outboundRtp.deltaFramesEncoded = 30;
            outboundRtp.deltaPacketsSent = 0;
            ticks(4);
            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(1);

            outboundRtp.deltaPacketsSent = 100;
            ticks(1);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
        });

        it('links the specialist issues active on this peer connection', () => {
            mockClientMonitor.activeIssues.set('other', {
                id: 'x',
                type: 'congestion',
                payload: { peerConnectionId: 'test-pc-id' },
            });
            outboundRtp.deltaFramesEncoded = 30;
            outboundRtp.deltaPacketsSent = 0;

            ticks(4);

            const issue = mockClientMonitor.getIssuesByType('media-pipeline-stalled')[0]!;

            // schema 3.5.0 payloads are flat records: comma-separated string
            expect(issue.payload.suspectedIssueTypes).toBe('congestion');
        });
    });

    describe('transport-demux boundary (receive)', () => {
        beforeEach(() => {
            mockPeerConnection.iceTransports = [ { id: 'transport-1', receivingBitrate: 500_000 } ];
            mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 0) ];
        });

        it('raises when the transport receives but nothing demuxes, sustained', () => {
            ticks(4);

            const issues = mockClientMonitor.getIssuesByType('media-pipeline-stalled');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.stage).toBe('transport-demux');
            expect(issues[0]!.payload.direction).toBe('receive');
            expect(issues[0]!.payload.transportId).toBe('transport-1');
        });

        it('stays silent when the inbound rtp accounts for the traffic', () => {
            mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 120_000) ];

            ticks(6);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('stays silent below the media-level receive rate (RTCP/STUN only)', () => {
            mockPeerConnection.iceTransports = [ { id: 'transport-1', receivingBitrate: 2_000 } ];

            ticks(6);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('stays silent without any inbound rtp (no demux expectation)', () => {
            mockPeerConnection.inboundRtps = [];

            ticks(6);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('resolves when demuxing resumes', () => {
            ticks(4);
            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(1);

            mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 120_000) ];
            ticks(1);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });

        it('resolves when the transport is gone', () => {
            ticks(4);
            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(1);

            mockPeerConnection.iceTransports = [];
            ticks(1);

            expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
        });
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;
        mockPeerConnection.iceTransports = [ { id: 'transport-1', receivingBitrate: 500_000 } ];
        mockPeerConnection.inboundRtps = [ new MockInboundRtp('transport-1', 0) ];

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('media-pipeline-stalled')).toHaveLength(0);
    });
});
