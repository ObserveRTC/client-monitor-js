import { IceEstablishmentFailedDetector } from "../../src/detectors/IceEstablishmentFailedDetector";
import { MockCandidatePair, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('IceEstablishmentFailedDetector', () => {
    let detector: IceEstablishmentFailedDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    /** One collection: advance the peer connection's stats clock, then judge. */
    const tick = (elapsedMs = 1000) => {
        mockPeerConnection.tick(elapsedMs);
        detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        mockPeerConnection.setConnectionState('connecting');
        mockPeerConnection.iceGatheringState = 'complete';
        mockPeerConnection.iceCandidates = [
            { direction: 'local', candidateType: 'host' },
            { direction: 'local', candidateType: 'host' },
            { direction: 'local', candidateType: 'srflx' },
            { direction: 'remote', candidateType: 'host' },
        ];
        mockPeerConnection.iceCandidatePairs = [
            Object.assign(new MockCandidatePair('pair-1'), { state: 'in-progress', nominated: false }),
            Object.assign(new MockCandidatePair('pair-2'), { state: 'failed', nominated: false }),
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceEstablishmentFailedDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-establishment-failed-detector');
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;

        tick(60000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('stays quiet while establishment is still within the threshold', () => {
        tick(10000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('raises once establishment has gone on failing past the threshold', () => {
        tick(10000);
        tick(6000);

        const issues = mockClientMonitor.getIssuesByType('ice-establishment-failed');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({
            peerConnectionId: 'test-pc-id',
            connectionState: 'connecting',
            iceGatheringState: 'complete',
            localIceCandidateCount: 3,
        }));
    });

    it('summarises what was tried, so the payload says why rather than only that', () => {
        tick(16000);

        const issue = mockClientMonitor.getIssuesByType('ice-establishment-failed')[0]!;
        expect(issue.payload.localCandidateCounts).toEqual({
            host: 2, srflx: 1, relay: 0, prflx: 0, unknown: 0,
        });
        expect(issue.payload.candidatePairStates).toEqual([ 'failed', 'in-progress' ]);
        expect(issue.payload.candidatePairCount).toBe(2);
    });

    it('does not duplicate the issue while the connection keeps failing', () => {
        const issueSpy = jest.fn();
        mockClientMonitor.on('issue', issueSpy);

        for (let i = 0; i < 10; ++i) tick(5000);

        expect(issueSpy).toHaveBeenCalledTimes(1);
    });

    it('never fires with zero local candidates, which is the no-network case', () => {
        // `no-available-ice-candidate` owns that: there is nothing here to have
        // failed *with*, and the two must not both describe one connection.
        mockPeerConnection.iceCandidates = [ { direction: 'remote', candidateType: 'host' } ];

        for (let i = 0; i < 10; ++i) tick(5000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('never fires once a candidate pair has been nominated', () => {
        // A pair that won means establishment got there; whatever went wrong after
        // is somebody else's finding.
        mockPeerConnection.iceCandidatePairs[0]!.nominated = true;

        for (let i = 0; i < 10; ++i) tick(5000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('never fires once a candidate pair has succeeded', () => {
        mockPeerConnection.iceCandidatePairs[0]!.state = 'succeeded';

        for (let i = 0; i < 10; ++i) tick(5000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('never fires on a connection that reached connected', () => {
        mockPeerConnection.setConnectionState('connected');

        for (let i = 0; i < 10; ++i) tick(5000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('resolves with a duration if the connection establishes after all', () => {
        const resolvedSpy = jest.fn();
        mockClientMonitor.on('issue-resolved', resolvedSpy);
        tick(16000);
        expect(mockClientMonitor.getIssues()).toHaveLength(1);

        mockPeerConnection.setConnectionState('connected');
        tick(1000);

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
        expect(resolvedSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ice-establishment-failed',
            comment: 'ice path established',
            payload: expect.objectContaining({ durationInMs: expect.any(Number) }),
        }));
    });

    it('resolves when the peer connection closes', () => {
        tick(16000);
        expect(mockClientMonitor.getIssues()).toHaveLength(1);

        mockPeerConnection.closed = true;
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('measures the threshold in stats time rather than in collections', () => {
        // One collection covering sixteen seconds of a connection that never got
        // anywhere is the same evidence as sixteen covering one second each.
        tick(16000);

        expect(mockClientMonitor.getIssuesByType('ice-establishment-failed')).toHaveLength(1);
    });
});
