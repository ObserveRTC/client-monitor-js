import { IcePathEstablishmentDetector } from "../../src/detectors/IcePathEstablishmentDetector";

interface EventHandler {
    (event: Record<string, unknown>): void;
}

class MockClientMonitor {
    public config = {
        icePathEstablishmentDetector: {
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

class MockIceTransport {
    public iceState: string | undefined = 'checking';
    public dtlsState: string | undefined = 'new';
    public selectedCandidatePairId: string | undefined = undefined;

    getSelectedCandidatePair() {
        return undefined;
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public connectionState: string | undefined = 'new';
    public connectingStartedAt: number | undefined = undefined;
    public iceGatheringState: string | undefined = undefined;
    public iceTransports: MockIceTransport[] = [];
    public deltaTime: number | undefined = undefined;

    /**
     * Advances the peer connection's own stats clock — the interval between the
     * two reports this collection read. The establishment clock accumulates that
     * and nothing else, so a spec that advanced fake timers would drive nothing.
     */
    tick(elapsedInMs = 1000) {
        this.deltaTime = elapsedInMs;

        return this;
    }

    setTransports(...transports: MockIceTransport[]) {
        this.iceTransports = transports;
    }

    /** Mirrors the real monitor's connectionState setter behaviour. */
    setConnectionState(state: string | undefined) {
        this.connectionState = state;
        if (state === 'connecting') this.connectingStartedAt = Date.now();
        else if (state !== 'connected') this.connectingStartedAt = undefined;
    }
}

describe('IcePathEstablishmentDetector', () => {
    let detector: IcePathEstablishmentDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;

    /** One collection: advance the peer connection's stats clock, then judge. */
    const tick = (elapsedMs = 1000) => {
        mockPeerConnection.tick(elapsedMs);
        detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = new MockIceTransport();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IcePathEstablishmentDetector(mockPeerConnection as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-path-establishment-detector');
    });

    it('stays quiet while establishment is within the threshold', () => {
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);
        mockPeerConnection.setConnectionState('connecting');

        tick(3000);

        expect(spy).not.toHaveBeenCalled();
    });

    it('reports once establishment outlasts the threshold', () => {
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);
        mockPeerConnection.setConnectionState('connecting');

        tick(6000);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![0].sustainedForInMs).toBe(6000);
        expect(mockClientMonitor.addedEvents[0]?.type).toBe('LONG_PC_CONNECTION_ESTABLISHMENT');
        expect(mockClientMonitor.addedEvents[0]?.payload?.duration).toBe(6000);
    });

    it('accumulates the threshold across collections rather than reading one span', () => {
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);
        mockPeerConnection.setConnectionState('connecting');

        tick(2000);
        tick(2000);
        expect(spy).not.toHaveBeenCalled();

        tick(2000);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![0].sustainedForInMs).toBe(6000);
    });

    it('never reports on wall-clock time alone, with no stats time behind it', () => {
        // A backgrounded tab resurfacing after two minutes has not watched two
        // minutes of establishment. Measured against `connectingStartedAt` it would
        // announce one anyway — and would read `stalledStage` off a report taken
        // after the fact, so the duration and the stage would not describe the same
        // observations.
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);
        jest.useFakeTimers();
        jest.setSystemTime(0);
        mockPeerConnection.setConnectionState('connecting');

        jest.setSystemTime(120_000);
        mockPeerConnection.deltaTime = 0;
        detector.update();

        expect(spy).not.toHaveBeenCalled();

        // and the very same attempt still reports once stats time does move
        tick(6000);

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('reports only once per attempt', () => {
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);
        mockPeerConnection.setConnectionState('connecting');

        tick(6000);
        tick(6000);

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('rearms after a successful establishment', () => {
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);

        mockPeerConnection.setConnectionState('connecting');
        tick(6000);

        mockPeerConnection.setConnectionState('connected');
        detector.update();

        mockPeerConnection.setConnectionState('connecting');
        tick(6000);

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('rearms after a FAILED attempt, so the retry is still reported', () => {
        // Regression guard: the flag used to reset only on `connected`, so every
        // establishment after the first failure was silent — even though a
        // retry failing is more interesting than the first attempt.
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);

        mockPeerConnection.setConnectionState('connecting');
        tick(6000);
        expect(spy).toHaveBeenCalledTimes(1);

        mockPeerConnection.setConnectionState('failed');
        detector.update();

        mockPeerConnection.setConnectionState('connecting');
        tick(6000);

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('is silent when disabled', () => {
        const spy = jest.fn();
        mockClientMonitor.on('ice-path-establishment-slow', spy);
        detector.disabled = true;
        mockPeerConnection.setConnectionState('connecting');

        tick(60000);

        expect(spy).not.toHaveBeenCalled();
    });

    describe('stalled stage', () => {
        const reportedStage = () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-path-establishment-slow', spy);
            mockPeerConnection.setConnectionState('connecting');

            tick(6000);

            return spy.mock.calls[0]?.[0].stalledStage;
        };

        it('names ice-gathering before any transport exists', () => {
            mockPeerConnection.iceGatheringState = 'gathering';

            expect(reportedStage()).toBe('ice-gathering');
        });

        it('names ice-checking while a transport is still negotiating connectivity', () => {
            transport.iceState = 'checking';
            mockPeerConnection.setTransports(transport);

            expect(reportedStage()).toBe('ice-checking');
        });

        it('names dtls once the ICE side is done but the connection is not', () => {
            // The case a detector watching ICE alone cannot see: every transport
            // reads connected while the call still does not work.
            transport.iceState = 'connected';
            mockPeerConnection.setTransports(transport);

            expect(reportedStage()).toBe('dtls');
        });

        it('takes a succeeded selected pair as proof where no iceState is reported', () => {
            // Safari, and the transport reconstructed for Firefox < 153.
            transport.iceState = undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (transport as any).getSelectedCandidatePair = () => ({ state: 'succeeded' });
            mockPeerConnection.setTransports(transport);

            expect(reportedStage()).toBe('dtls');
        });

        it('says unknown when the stats give no verdict', () => {
            transport.iceState = 'failed';
            mockPeerConnection.setTransports(transport);

            expect(reportedStage()).toBe('unknown');
        });
    });

    it('recommends nothing — the restart recommendation moved to its own detector', () => {
        // Regression guard for the split: layer 3 used to emit `ice-restart-recommended`
        // with reason `never-established`, and `IceRestartRecommendationDetector` owns
        // that now. Two detectors emitting one recommendation is two recommendations.
        const spy = jest.fn();
        mockClientMonitor.on('ice-restart-recommended', spy);
        mockPeerConnection.setTransports(transport);
        mockPeerConnection.setConnectionState('connecting');

        tick(60000);

        expect(spy).not.toHaveBeenCalled();
    });
});
