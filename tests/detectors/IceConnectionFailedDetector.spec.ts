import { IceConnectionFailedDetector } from "../../src/detectors/IceConnectionFailedDetector";
import { MockIceTransport, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('IceConnectionFailedDetector', () => {
    let detector: IceConnectionFailedDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = mockPeerConnection.iceTransports[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceConnectionFailedDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-connection-failed-detector');
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;
        transport.iceState = 'failed';

        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('raises an issue immediately on failed', () => {
        transport.iceState = 'failed';

        detector.update();

        const issues = mockClientMonitor.getIssuesByType('ice-connection-failed');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({
            transportId: 'transport-1',
            dtlsState: 'connected',
            iceGeneration: 0,
        }));
    });

    it('does not duplicate the failed issue', () => {
        const issueSpy = jest.fn();
        mockClientMonitor.on('issue', issueSpy);
        transport.iceState = 'failed';

        detector.update();
        detector.update();
        transport.tick(10000);
        detector.update();

        expect(issueSpy).toHaveBeenCalledTimes(1);
    });

    it('resolves the failed issue if the connection comes back', () => {
        transport.iceState = 'failed';
        detector.update();
        expect(mockClientMonitor.getIssuesByType('ice-connection-failed')).toHaveLength(1);

        transport.iceState = 'connected';
        transport.tick(2000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('says nothing about a merely disconnected transport', () => {
        transport.iceState = 'disconnected';

        transport.tick(60000);
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    describe('everConnected', () => {
        it('reports false for a path that never worked', () => {
            // Checking straight into failed: no candidate pair ever won, which points
            // at what was reachable rather than at the network changing underneath.
            const neverUp = new MockIceTransport('transport-1', 'checking');
            mockPeerConnection.setTransports(neverUp);

            neverUp.tick(1000);
            detector.update();

            neverUp.iceState = 'failed';
            neverUp.tick(1000);
            detector.update();

            const issues = mockClientMonitor.getIssuesByType('ice-connection-failed');
            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload).toEqual(expect.objectContaining({ everConnected: false }));
        });

        it('reports true for a path that worked and was then lost', () => {
            transport.iceState = 'connected';
            transport.tick(1000);
            detector.update();

            transport.iceState = 'failed';
            transport.tick(1000);
            detector.update();

            const issues = mockClientMonitor.getIssuesByType('ice-connection-failed');
            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload).toEqual(expect.objectContaining({ everConnected: true }));
        });
    });

    it('resolves and re-arms when an ICE restart is inferred', () => {
        transport.iceState = 'failed';
        detector.update();
        expect(mockClientMonitor.getIssuesByType('ice-connection-failed')).toHaveLength(1);

        transport.iceLocalUsernameFragment = 'ufrag-2';
        transport.iceState = 'checking';
        transport.tick(1000);
        detector.update();
        expect(mockClientMonitor.getIssues()).toHaveLength(0);

        transport.iceState = 'failed';
        transport.tick(1000);
        detector.update();

        const issues = mockClientMonitor.getIssuesByType('ice-connection-failed');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({ iceGeneration: 1 }));
    });

    it('tracks each transport independently', () => {
        const second = new MockIceTransport('transport-2', 'connected');
        second.iceLocalUsernameFragment = 'ufrag-b';
        mockPeerConnection.setTransports(transport, second);
        transport.iceState = 'failed';

        detector.update();

        const issues = mockClientMonitor.getIssuesByType('ice-connection-failed');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({ transportId: 'transport-1' }));
    });

    it('resolves issues owned by a transport that disappears', () => {
        transport.iceState = 'failed';
        detector.update();
        expect(mockClientMonitor.getIssues()).toHaveLength(1);

        mockPeerConnection.setTransports();
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });
});
