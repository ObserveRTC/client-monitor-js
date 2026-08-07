import { LongPcConnectionEstablishmentDetector } from "../../src/detectors/LongPcConnectionEstablishment";

interface EventHandler {
    (event: Record<string, unknown>): void;
}

class MockClientMonitor {
    public config = {
        longPcConnectionEstablishmentDetector: {
            thresholdInMs: 5000,
            createEvent: true,
        },
    };

    public readonly addedEvents: { type: string; payload?: Record<string, unknown> }[] = [];
    private eventHandlers: { [key: string]: EventHandler[] } = {};

    emit(eventName: string, eventData: Record<string, unknown>) {
        (this.eventHandlers[eventName] || []).forEach(handler => handler(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        if (!this.eventHandlers[eventName]) this.eventHandlers[eventName] = [];
        this.eventHandlers[eventName].push(handler);
    }

    addEvent(event: { type: string; payload?: Record<string, unknown> }) {
        this.addedEvents.push(event);
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public connectionState: string | undefined = 'new';
    public connectingStartedAt: number | undefined = undefined;

    /** Mirrors the real monitor's connectionState setter behaviour. */
    setConnectionState(state: string | undefined) {
        this.connectionState = state;
        if (state === 'connecting') this.connectingStartedAt = Date.now();
        else if (state !== 'connected') this.connectingStartedAt = undefined;
    }
}

describe('LongPcConnectionEstablishmentDetector', () => {
    let detector: LongPcConnectionEstablishmentDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new LongPcConnectionEstablishmentDetector(mockPeerConnection as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('long-pc-connection-establishment-detector');
    });

    it('stays quiet while establishment is within the threshold', () => {
        const spy = jest.fn();
        mockClientMonitor.on('too-long-pc-connection-establishment', spy);
        mockPeerConnection.setConnectionState('connecting');

        jest.advanceTimersByTime(3000);
        detector.update();

        expect(spy).not.toHaveBeenCalled();
    });

    it('reports once establishment outlasts the threshold', () => {
        const spy = jest.fn();
        mockClientMonitor.on('too-long-pc-connection-establishment', spy);
        mockPeerConnection.setConnectionState('connecting');

        jest.advanceTimersByTime(6000);
        detector.update();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(mockClientMonitor.addedEvents[0]?.type).toBe('LONG_PC_CONNECTION_ESTABLISHMENT');
    });

    it('reports only once per attempt', () => {
        const spy = jest.fn();
        mockClientMonitor.on('too-long-pc-connection-establishment', spy);
        mockPeerConnection.setConnectionState('connecting');

        jest.advanceTimersByTime(6000);
        detector.update();
        jest.advanceTimersByTime(6000);
        detector.update();

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('rearms after a successful establishment', () => {
        const spy = jest.fn();
        mockClientMonitor.on('too-long-pc-connection-establishment', spy);

        mockPeerConnection.setConnectionState('connecting');
        jest.advanceTimersByTime(6000);
        detector.update();

        mockPeerConnection.setConnectionState('connected');
        detector.update();

        mockPeerConnection.setConnectionState('connecting');
        jest.advanceTimersByTime(6000);
        detector.update();

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('rearms after a FAILED attempt, so the retry is still reported', () => {
        // Regression guard: the flag used to reset only on `connected`, so every
        // establishment after the first failure was silent — even though a
        // retry failing is more interesting than the first attempt.
        const spy = jest.fn();
        mockClientMonitor.on('too-long-pc-connection-establishment', spy);

        mockPeerConnection.setConnectionState('connecting');
        jest.advanceTimersByTime(6000);
        detector.update();
        expect(spy).toHaveBeenCalledTimes(1);

        mockPeerConnection.setConnectionState('failed');
        detector.update();

        mockPeerConnection.setConnectionState('connecting');
        jest.advanceTimersByTime(6000);
        detector.update();

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('is silent when disabled', () => {
        const spy = jest.fn();
        mockClientMonitor.on('too-long-pc-connection-establishment', spy);
        detector.disabled = true;
        mockPeerConnection.setConnectionState('connecting');

        jest.advanceTimersByTime(60000);
        detector.update();

        expect(spy).not.toHaveBeenCalled();
    });
});
