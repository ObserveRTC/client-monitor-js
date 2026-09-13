import { IceDisconnectedDetector } from "../../src/detectors/IceDisconnectedDetector";
import { MockIceTransport, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('IceDisconnectedDetector', () => {
    let detector: IceDisconnectedDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = mockPeerConnection.iceTransports[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceDisconnectedDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-disconnected-detector');
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;
        transport.iceState = 'disconnected';
        transport.tick(60000);

        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('raises nothing while the transport is healthy', () => {
        transport.tick(1000);
        detector.update();
        transport.tick(60000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('does not treat checking as a problem', () => {
        transport.iceState = 'checking';

        transport.tick(1000);
        detector.update();
        transport.tick(60000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('does not raise an issue for a brief disconnection', () => {
        transport.iceState = 'disconnected';
        transport.tick(1000);
        detector.update();

        transport.tick(3000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('raises an issue once the disconnection persists past the threshold', () => {
        transport.iceState = 'disconnected';
        transport.tick(1000);
        detector.update();

        transport.tick(6000);
        detector.update();

        const issues = mockClientMonitor.getIssuesByType('ice-disconnected');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({
            peerConnectionId: 'test-pc-id',
            transportId: 'transport-1',
            iceState: 'disconnected',
            iceGeneration: 0,
        }));
        expect(issues[0]!.payload.disconnectedForMs as number).toBeGreaterThanOrEqual(6000);
    });

    it('measures the threshold in stats time, not in how often the library looked', () => {
        // Two collections, one of which was late by 20 seconds: the transport was
        // disconnected for that whole stretch and the issue must reflect it.
        transport.iceState = 'disconnected';
        transport.tick(20000);
        detector.update();

        expect(mockClientMonitor.getIssuesByType('ice-disconnected')).toHaveLength(1);
    });

    it('does not duplicate the issue on repeated updates', () => {
        const issueSpy = jest.fn();
        mockClientMonitor.on('issue', issueSpy);
        transport.iceState = 'disconnected';
        transport.tick(1000);
        detector.update();

        transport.tick(6000);
        detector.update();
        transport.tick(6000);
        detector.update();
        detector.update();

        expect(issueSpy).toHaveBeenCalledTimes(1);
        expect(mockClientMonitor.getIssues()).toHaveLength(1);
    });

    it('resolves the issue with a duration when ICE reconnects', () => {
        const resolvedSpy = jest.fn();
        mockClientMonitor.on('issue-resolved', resolvedSpy);
        transport.iceState = 'disconnected';
        transport.tick(6000);
        detector.update();
        expect(mockClientMonitor.getIssuesByType('ice-disconnected')).toHaveLength(1);

        transport.iceState = 'connected';
        transport.tick(4000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
        expect(resolvedSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ice-disconnected',
            comment: 'ice connection recovered',
            payload: expect.objectContaining({ durationInMs: expect.any(Number) }),
        }));
    });

    it('restarts the timer after a recovery so the next blip is judged fresh', () => {
        transport.iceState = 'disconnected';
        transport.tick(3000);
        detector.update();

        transport.iceState = 'connected';
        transport.tick(1000);
        detector.update();

        transport.iceState = 'disconnected';
        transport.tick(3000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('leaves the issue standing when the transport falls from disconnected to failed', () => {
        // Falling into `failed` is not a recovery — it is the same outage getting
        // worse — so the disconnection issue stays open until ICE really comes back.
        transport.iceState = 'disconnected';
        transport.tick(6000);
        detector.update();
        expect(mockClientMonitor.getIssuesByType('ice-disconnected')).toHaveLength(1);

        transport.iceState = 'failed';
        transport.tick(1000);
        detector.update();
        expect(mockClientMonitor.getIssuesByType('ice-disconnected')).toHaveLength(1);

        transport.iceState = 'connected';
        transport.tick(1000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('resolves and re-arms when an ICE restart is inferred', () => {
        transport.iceState = 'disconnected';
        transport.tick(6000);
        detector.update();
        expect(mockClientMonitor.getIssuesByType('ice-disconnected')).toHaveLength(1);

        transport.iceLocalUsernameFragment = 'ufrag-2';
        transport.tick(1000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);

        transport.tick(6000);
        detector.update();

        const issues = mockClientMonitor.getIssuesByType('ice-disconnected');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({ iceGeneration: 1 }));
    });

    it('tracks each transport independently', () => {
        const second = new MockIceTransport('transport-2', 'connected');
        second.iceLocalUsernameFragment = 'ufrag-b';
        mockPeerConnection.setTransports(transport, second);

        transport.iceState = 'disconnected';
        transport.tick(6000);
        second.tick(6000);
        detector.update();

        const issues = mockClientMonitor.getIssuesByType('ice-disconnected');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({ transportId: 'transport-1' }));
    });

    it('resolves issues owned by a transport that disappears', () => {
        transport.iceState = 'disconnected';
        transport.tick(6000);
        detector.update();
        expect(mockClientMonitor.getIssues()).toHaveLength(1);

        mockPeerConnection.setTransports();
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });
});
