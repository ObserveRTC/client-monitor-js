import { mockIssueRegistry } from "../helpers/detectorMocks";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RtpSenderStalledDetector } from "../../src/detectors/RtpSenderStalledDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        rtpSenderStalledDetector: {
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
    /** The stall clock is stats time, so the interval comes off the monitor. */
    public deltaTime: number | undefined = 2000;
    public trackState = { id: 'video-out-1', muted: false, readyState: 'live' };

    public constructor(public ssrc = 1111) {}

    getTrack() {
        return { track: this.trackState };
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
    public outboundRtps: MockOutboundRtp[] = [];
}

describe('RtpSenderStalledDetector', () => {
    let detector: RtpSenderStalledDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let outboundRtp: MockOutboundRtp;

    // Each tick carries 2000ms of stats time, so the 4000ms threshold is
    // crossed on the third consecutive broken tick.
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        detector = new RtpSenderStalledDetector(mockPeerConnection as any);
        outboundRtp = new MockOutboundRtp();
        mockPeerConnection.outboundRtps = [ outboundRtp ];
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('rtp-sender-stalled-detector');
    });

    it('raises when frames encode but no packet leaves, sustained', () => {
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;

        ticks(4);

        const issues = mockClientMonitor.getIssuesByType('rtp-sender-stalled');

        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload.ssrc).toBe(1111);
        expect(issues[0]!.payload.trackId).toBe('video-out-1');
        expect(issues[0]!.payload.framesEncodedDelta).toBe(30);
        expect(issues[0]!.payload.packetsSentDelta).toBe(0);
    });

    it('does not raise before the threshold', () => {
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;

        ticks(2); // 2000ms of stats time, not yet past the threshold

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
    });

    it('measures the stall in stats time, not wall-clock', () => {
        // the collections are 500ms of media time apart, however long the wall
        // clock says the page was away
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;
        outboundRtp.deltaTime = 500;

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);

        ticks(4);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(1);
    });

    it('stays silent while the encoder is also idle (paused sender)', () => {
        outboundRtp.deltaFramesEncoded = 0;
        outboundRtp.deltaPacketsSent = 0;

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
    });

    it('stays silent on muted tracks and inactive layers', () => {
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;
        outboundRtp.trackState.muted = true;

        ticks(6);
        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);

        outboundRtp.trackState.muted = false;
        outboundRtp.active = false;

        ticks(6);
        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
    });

    it('resolves when packets flow again', () => {
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;
        ticks(4);
        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(1);

        outboundRtp.deltaPacketsSent = 100;
        ticks(1);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
        expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
    });

    it('resolves when the outbound rtp is gone', () => {
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;
        ticks(4);
        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(1);

        mockPeerConnection.outboundRtps = [];
        ticks(1);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
    });

    it('keeps a separate verdict per ssrc', () => {
        const other = new MockOutboundRtp(2222);

        other.deltaFramesEncoded = 30;
        other.deltaPacketsSent = 500;
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;
        mockPeerConnection.outboundRtps = [ outboundRtp, other ];

        ticks(4);

        const issues = mockClientMonitor.getIssuesByType('rtp-sender-stalled');

        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload.ssrc).toBe(1111);
    });

    it('reads no issue but its own', () => {
        // the predecessor annotated its payload with every other active issue on
        // the peer connection; that coupling is gone
        mockClientMonitor.activeIssues.set('other', {
            id: 'x',
            type: 'congestion',
            payload: { peerConnectionId: 'test-pc-id' },
        });
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;

        ticks(4);

        const issue = mockClientMonitor.getIssuesByType('rtp-sender-stalled')[0]!;

        expect(issue.payload.suspectedIssueTypes).toBeUndefined();
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
    });

    it('should return early on a closed peer connection', () => {
        mockPeerConnection.closed = true;
        outboundRtp.deltaFramesEncoded = 30;
        outboundRtp.deltaPacketsSent = 0;

        ticks(6);

        expect(mockClientMonitor.getIssuesByType('rtp-sender-stalled')).toHaveLength(0);
    });
});
