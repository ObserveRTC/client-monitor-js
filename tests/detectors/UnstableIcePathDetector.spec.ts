import { UnstableIcePathDetector } from "../../src/detectors/UnstableIcePathDetector";
import { MockIceTransport, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('UnstableIcePathDetector', () => {
    let detector: UnstableIcePathDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    /** One collection with the selected pair moved to `pairId`. */
    const selectPair = (pairId: string | undefined, elapsedMs = 1000) => {
        transport.selectedCandidatePairId = pairId;
        transport.tick(elapsedMs);
        detector.update();
    };

    /** One collection reporting `changes` native selected-pair changes. */
    const nativeChanges = (changes: number | undefined, elapsedMs = 1000) => {
        transport.deltaSelectedCandidatePairChanges = changes;
        transport.tick(elapsedMs);
        detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = mockPeerConnection.iceTransports[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new UnstableIcePathDetector(mockPeerConnection as any);
        // A baseline collection, as in production: the detector has to have seen the
        // transport once before a changed selected pair reads as a switch rather than
        // as the first selection it ever observed.
        transport.tick(1000);
        detector.update();
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('unstable-ice-path-detector');
    });

    it('should return early if detector is disabled', () => {
        detector.disabled = true;

        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4');

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('stays quiet on a path that never moves', () => {
        for (let i = 0; i < 40; ++i) selectPair('pair-1');

        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
    });

    it('stays quiet below the switch threshold', () => {
        selectPair('pair-2');
        selectPair('pair-3');

        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
    });

    it('raises an issue once the path keeps switching', () => {
        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4');

        const issues = mockClientMonitor.getIssuesByType('unstable-ice-path');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({
            peerConnectionId: 'test-pc-id',
            pathKey: 'transport-1',
            transportId: 'transport-1',
            switches: 3,
            windowInMs: 30000,
            kind: 'direct',
        }));
    });

    it('does not duplicate the issue while the path stays unstable', () => {
        const issueSpy = jest.fn();
        mockClientMonitor.on('issue', issueSpy);

        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4');
        selectPair('pair-5');
        selectPair('pair-6');

        expect(issueSpy).toHaveBeenCalledTimes(1);
    });

    it('counts a flap the browser saw but the tick-to-tick diffing could not', () => {
        // Departed and returned inside one collecting period: the selected pair id
        // is unchanged, and only the native counter knows anything happened.
        nativeChanges(3);

        const issues = mockClientMonitor.getIssuesByType('unstable-ice-path');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload).toEqual(expect.objectContaining({
            switches: 3,
            nativePairChanges: 3,
        }));
    });

    it('still works where the browser reports no native counter at all', () => {
        // Safari, and Firefox before 155: `deltaSelectedCandidatePairChanges` is
        // undefined and the portable pair diffing has to carry the whole verdict.
        transport.deltaSelectedCandidatePairChanges = undefined;

        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4');

        const issues = mockClientMonitor.getIssuesByType('unstable-ice-path');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.payload.nativePairChanges).toBeUndefined();
    });

    it('takes the larger of the two counts rather than adding them', () => {
        // One switch really happened this tick and both sources saw it; counting it
        // twice would raise on half the churn the threshold asks for.
        transport.deltaSelectedCandidatePairChanges = 1;
        selectPair('pair-2');
        transport.deltaSelectedCandidatePairChanges = 1;
        selectPair('pair-3');

        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
    });

    it('resolves once a whole window passes below the threshold', () => {
        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4');
        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(1);

        // The window tumbles; the next one carries no switches at all.
        selectPair('pair-4', 30000);
        selectPair('pair-4', 30000);

        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
    });

    it('keeps the issue standing while the closing window is still over the threshold', () => {
        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4', 30000);

        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(1);
    });

    it('resolves when the transport disappears', () => {
        selectPair('pair-2');
        selectPair('pair-3');
        selectPair('pair-4');
        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(1);

        mockPeerConnection.setTransports();
        detector.update();

        expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
    });
});
