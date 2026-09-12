import { IceTransportStalledDetector } from "../../src/detectors/IceTransportStalledDetector";
import { MockCandidatePair, MockIceTransport, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('IceTransportStalledDetector', () => {
    let detector: IceTransportStalledDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;
    let pair: MockCandidatePair;

    /** One collection: set this tick's byte deltas, advance stats time, judge. */
    const tick = (sent: number | undefined, received: number | undefined, elapsedMs = 1000) => {
        pair.deltaBytesSent = sent;
        pair.deltaBytesReceived = received;
        transport.tick(elapsedMs);
        detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = mockPeerConnection.iceTransports[0]!;
        pair = transport.pair!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceTransportStalledDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-transport-stalled-detector');
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;
        tick(1000, 1000);
        for (let i = 0; i < 10; ++i) tick(1000, 0);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('raises a stall issue when we keep sending but stop receiving', () => {
        tick(1000, 1000); // healthy traffic first — proves inbound was alive

        for (let i = 0; i < 6; ++i) tick(1000, 0);

        const issues = mockClientMonitor.getIssuesByType('ice-transport-stalled');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({
            direction: 'inbound',
            candidatePairState: 'succeeded',
            outboundBytesDelta: 1000,
            inboundBytesDelta: 0,
            iceGeneration: 0,
        }));
    });

    it('does not raise a stall before the threshold elapses', () => {
        tick(1000, 1000);
        tick(1000, 0);
        tick(1000, 0);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('measures the threshold in stats time, so a late collection still counts', () => {
        tick(1000, 1000);
        tick(1000, 0, 6000);

        expect(mockClientMonitor.getIssuesByType('ice-transport-stalled')).toHaveLength(1);
    });

    it('does not raise a stall when nothing flows in either direction', () => {
        // An idle or receive-only peer connection: no evidence traffic is expected.
        tick(1000, 1000);

        for (let i = 0; i < 10; ++i) tick(0, 0);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('does not raise a stall before inbound traffic was ever observed', () => {
        for (let i = 0; i < 10; ++i) tick(1000, 0);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('does not raise a stall when the pair is not succeeded', () => {
        tick(1000, 1000);
        pair.state = 'in-progress';

        for (let i = 0; i < 10; ++i) tick(1000, 0);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('resolves the stall when inbound traffic resumes', () => {
        tick(1000, 1000);
        for (let i = 0; i < 7; ++i) tick(1000, 0);
        expect(mockClientMonitor.getIssuesByType('ice-transport-stalled')).toHaveLength(1);

        tick(1000, 500);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('ignores transports whose deltas are unavailable', () => {
        tick(undefined, undefined);
        tick(undefined, undefined, 20000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('resolves the stall when the path stops being connected', () => {
        tick(1000, 1000);
        for (let i = 0; i < 7; ++i) tick(1000, 0);
        expect(mockClientMonitor.getIssuesByType('ice-transport-stalled')).toHaveLength(1);

        transport.iceState = 'failed';
        tick(1000, 0);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('resolves and makes the new generation earn the inbound guard again', () => {
        tick(1000, 1000);
        for (let i = 0; i < 7; ++i) tick(1000, 0);
        expect(mockClientMonitor.getIssuesByType('ice-transport-stalled')).toHaveLength(1);

        transport.iceLocalUsernameFragment = 'ufrag-2';
        tick(1000, 0);
        expect(mockClientMonitor.getIssues()).toHaveLength(0);

        // Nothing inbound has been seen on the new generation, so no amount of
        // sending-without-receiving is reportable until something arrives.
        for (let i = 0; i < 10; ++i) tick(1000, 0);
        expect(mockClientMonitor.getIssues()).toHaveLength(0);

        tick(1000, 1000);
        for (let i = 0; i < 7; ++i) tick(1000, 0);

        const issues = mockClientMonitor.getIssuesByType('ice-transport-stalled');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({ iceGeneration: 1 }));
    });

    it('resolves issues owned by a transport that disappears', () => {
        tick(1000, 1000);
        for (let i = 0; i < 7; ++i) tick(1000, 0);
        expect(mockClientMonitor.getIssues()).toHaveLength(1);

        mockPeerConnection.setTransports();
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    describe('send-only transports (SFU publish transport)', () => {
        it('never raises an inbound stall when the transport carries no inbound RTP', () => {
            // Regression guard: a publish transport receives only STUN consent and
            // RTCP, arriving seconds apart, so its inbound delta is legitimately zero
            // for longer than the stall threshold. If such a path really dies, consent
            // stops and `ice-disconnected` owns it.
            mockPeerConnection.inboundRtps = [];
            tick(50_000, 1000, 2000); // latches sawInboundTraffic

            for (let i = 0; i < 10; ++i) tick(50_000, 0, 2000);

            expect(mockClientMonitor.getIssuesByType('ice-transport-stalled')).toHaveLength(0);
        });
    });
});
