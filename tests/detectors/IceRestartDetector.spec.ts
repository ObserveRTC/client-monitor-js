import { IceRestartDetector } from "../../src/detectors/IceRestartDetector";
import { MockIceTransport, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('IceRestartDetector', () => {
    let detector: IceRestartDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = mockPeerConnection.iceTransports[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceRestartDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-restart-detector');
    });

    it('raises no issue, ever', () => {
        detector.update();
        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();
        transport.iceState = 'failed';
        detector.update();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    it('reports a new generation when the ICE username fragment changes', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        detector.update();

        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();

        expect(restartSpy).toHaveBeenCalledWith(expect.objectContaining({
            transportId: 'transport-1',
            iceGeneration: 1,
            outcome: 'detected',
        }));
        expect(mockClientMonitor.addedEvents.some((event) => event.type === 'ICE_RESTART')).toBe(true);
    });

    it('does not infer a restart from a checking transition alone', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        detector.update();

        transport.iceState = 'checking';
        detector.update();
        transport.iceState = 'connected';
        detector.update();

        expect(restartSpy).not.toHaveBeenCalled();
    });

    it('reports recovery after a restart', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        transport.iceState = 'checking';
        detector.update();

        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();
        transport.iceState = 'connected';
        detector.update();

        expect(restartSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'recovered', iceGeneration: 1 }));
    });

    it('reports a failed restart', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        detector.update();

        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();
        transport.iceState = 'failed';
        detector.update();

        expect(restartSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
    });

    it('does not settle a restart against the state the tick started in', () => {
        // The generation the tick opened in is the old one, so a restart observed
        // while the transport still reads `connected` must not report itself
        // recovered on the spot — the new generation has proven nothing yet.
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        transport.iceState = 'connected';
        detector.update();

        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();

        expect(restartSpy).toHaveBeenCalledTimes(1);
        expect(restartSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'detected' }));
    });

    it('falls back to the selected local candidate username fragment', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        transport.iceLocalUsernameFragment = undefined;
        transport.pair!.localUsernameFragment = 'cand-ufrag-1';
        detector.update();

        transport.pair!.localUsernameFragment = 'cand-ufrag-2';
        detector.update();

        expect(restartSpy).toHaveBeenCalledWith(expect.objectContaining({ iceGeneration: 1 }));
    });

    it('stays silent when no username fragment is exposed at all', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        transport.iceLocalUsernameFragment = undefined;

        detector.update();
        detector.update();

        expect(restartSpy).not.toHaveBeenCalled();
    });

    it('tracks each transport independently', () => {
        const restartSpy = jest.fn();
        mockClientMonitor.on('ice-restart', restartSpy);
        const second = new MockIceTransport('transport-2', 'connected');
        second.iceLocalUsernameFragment = 'ufrag-b';
        mockPeerConnection.setTransports(transport, second);
        detector.update();

        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();

        expect(restartSpy).toHaveBeenCalledTimes(1);
        expect(restartSpy).toHaveBeenCalledWith(expect.objectContaining({ transportId: 'transport-1' }));
    });

    it('buffers no client event when createEvent is off', () => {
        mockClientMonitor.config.iceRestartDetector.createEvent = false;
        detector.update();

        transport.iceLocalUsernameFragment = 'ufrag-2';
        detector.update();

        expect(mockClientMonitor.addedEvents).toHaveLength(0);
    });
});
