import { IceRestartRecommendationDetector } from "../../src/detectors/IceRestartRecommendationDetector";
import { MockCandidatePair, MockIceTransport, MockPeerConnectionMonitor, MockClientMonitor } from "../helpers/iceDetectorMocks";

describe('IceRestartRecommendationDetector', () => {
    let detector: IceRestartRecommendationDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;
    let pair: MockCandidatePair;

    /**
     * One collection: advance the stats clocks of the peer connection and of every
     * transport under it — all four condition clocks in this detector read one of
     * those two and nothing else — then judge.
     */
    const tick = (elapsedMs = 1000) => {
        mockPeerConnection.tick(elapsedMs);
        detector.update();
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        transport = mockPeerConnection.iceTransports[0]!;
        pair = transport.pair!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceRestartRecommendationDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-restart-recommendation-detector');
    });

    it('raises no issue, ever', () => {
        transport.iceState = 'failed';
        tick();

        expect(mockClientMonitor.getIssues()).toHaveLength(0);
    });

    describe('per-transport conditions', () => {
        it('recommends immediately on failed, since ICE never self-heals from it', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';

            tick();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                peerConnectionId: 'test-pc-id',
                transportId: 'transport-1',
                reason: 'ice-failed',
                recommendationCount: 1,
            }));
            expect(mockClientMonitor.addedEvents.some((e) => e.type === 'ICE_RESTART_RECOMMENDED')).toBe(true);
        });

        it('waits out the threshold before recommending on disconnected', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'disconnected';

            tick(6000);
            expect(spy).not.toHaveBeenCalled();

            tick(5000);

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ice-disconnected' }));
            expect(spy.mock.calls[0]![0].conditionDurationInMs).toBeGreaterThanOrEqual(10000);
        });

        it('recommends when a connected transport stays stalled', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            pair.deltaBytesSent = 1000;
            pair.deltaBytesReceived = 1000;
            tick();

            pair.deltaBytesReceived = 0;
            for (let i = 0; i < 12; ++i) tick();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'transport-stalled' }));
        });

        it('never recommends a stall on a send-only transport', () => {
            // The stall guards are written out here too, deliberately: a publish
            // transport receives nothing between consent bursts and is not stalled.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.inboundRtps = [];

            pair.deltaBytesSent = 50_000;
            pair.deltaBytesReceived = 1000;
            tick();

            pair.deltaBytesReceived = 0;
            for (let i = 0; i < 20; ++i) tick();

            expect(spy).not.toHaveBeenCalled();
        });

        it('does not nag while the condition persists', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';

            tick(5000);
            tick(5000);
            tick(5000);

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('recommends again once the cooldown elapses', () => {
            // The cooldown is deliberately wall clock — it rate-limits how often the
            // application is told, not how long anything held — so this one is driven
            // by moving `Date.now()` rather than the stats clock.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';

            tick();
            jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16000);
            tick();
            jest.restoreAllMocks();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[1]![0].recommendationCount).toBe(2);
        });

        it('stays silent while a restart the application already started is in flight', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            transport.iceState = 'connected';
            tick();

            transport.iceState = 'disconnected';
            tick();

            // The application restarted ICE before we asked: a new username
            // fragment appears while the transport is still down.
            transport.iceLocalUsernameFragment = 'ufrag-2';
            tick(11000);
            tick(2000);

            expect(spy).not.toHaveBeenCalled();
        });

        it('asks again when a restart itself failed, with a higher count', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            transport.iceState = 'failed';
            tick();
            expect(spy).toHaveBeenCalledTimes(1);

            // The application restarted, and the new generation failed too.
            transport.iceState = 'checking';
            transport.iceLocalUsernameFragment = 'ufrag-2';
            jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16000);
            tick();

            transport.iceState = 'failed';
            tick();
            jest.restoreAllMocks();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[1]![0]).toEqual(expect.objectContaining({
                recommendationCount: 2,
                iceGeneration: 1,
            }));
        });

        it('is silent on a healthy transport', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            pair.deltaBytesSent = 1000;
            pair.deltaBytesReceived = 1000;

            for (let i = 0; i < 20; ++i) tick();

            expect(spy).not.toHaveBeenCalled();
        });

        it('rearms after a recovery so a later incident recommends promptly', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            transport.iceState = 'failed';
            tick();
            expect(spy).toHaveBeenCalledTimes(1);

            transport.iceState = 'connected';
            tick();

            transport.iceState = 'failed';
            tick();

            expect(spy).toHaveBeenCalledTimes(2);
        });
    });

    describe('never-established', () => {
        beforeEach(() => {
            transport.iceState = 'checking';
        });

        it('recommends a restart when the peer connection never finishes connecting', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            tick(11000);

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                peerConnectionId: 'test-pc-id',
                reason: 'never-established',
                recommendationCount: 1,
            }));
            expect(spy.mock.calls[0]![0].transportId).toBeUndefined();
        });

        it('waits out the threshold', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            tick(6000);

            expect(spy).not.toHaveBeenCalled();
        });

        it('measures the threshold in the same stats time the other three reasons use', () => {
            // `conditionDurationInMs` is comparable across the four reasons only if
            // the four clocks measure the same thing: observed time, accumulated
            // across however many collections it took.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            tick(6000);
            expect(spy).not.toHaveBeenCalled();

            tick(5000);

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0]![0].conditionDurationInMs).toBe(11000);
        });

        it('never recommends on wall-clock time alone, with no stats time behind it', () => {
            // The old check differenced `Date.now()` against `connectingStartedAt`, so
            // a tab that spent a minute suspended came back and immediately advised a
            // restart on evidence it had never collected.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            jest.useFakeTimers();
            jest.setSystemTime(0);
            mockPeerConnection.setConnectionState('connecting');

            jest.setSystemTime(60_000);
            mockPeerConnection.tick(0);
            detector.update();

            expect(spy).not.toHaveBeenCalled();

            // and the very same attempt is still recommended once stats time moves
            tick(11000);

            expect(spy).toHaveBeenCalledTimes(1);

            jest.useRealTimers();
        });

        it('says nothing about an established connection', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'connected';
            mockPeerConnection.setConnectionState('connected');

            for (let i = 0; i < 20; ++i) tick(5000);

            expect(spy).not.toHaveBeenCalled();
        });

        it('reports even while every ICE transport still looks like it is checking', () => {
            // connectionState covers the DTLS handshake too, so this is exactly
            // the case a transport-state-only check cannot see.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            tick(11000);

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'never-established' }));
        });

        it('does not nag while establishment drags on', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            tick(11000);
            tick(5000);

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('asks again after the cooldown', () => {
            // The cooldown is deliberately wall clock — it rate-limits how often the
            // application is told, not how long the condition held — so it is the
            // system clock that has to move here, not the stats clock.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            const startedAt = Date.now();
            tick(11000);
            jest.spyOn(Date, 'now').mockReturnValue(startedAt + 16000);
            tick(5000);
            jest.restoreAllMocks();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[1]![0].recommendationCount).toBe(2);
        });

        it('rearms once the connection finally establishes', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            mockPeerConnection.setConnectionState('connecting');
            tick(11000);
            expect(spy).toHaveBeenCalledTimes(1);

            mockPeerConnection.setConnectionState('connected');
            tick();

            // The retry starts its own clock: the 11s the first attempt banked is
            // gone, so this one has to earn the threshold again from zero.
            mockPeerConnection.setConnectionState('connecting');
            tick(6000);
            expect(spy).toHaveBeenCalledTimes(1);

            tick(5000);

            expect(spy).toHaveBeenCalledTimes(2);
        });

        it.each([ 'failed', 'disconnected' ])(
            'yields to the more specific reason when a transport is %s',
            (iceState) => {
                // Both reasons now live in one class, so this is precedence between
                // two verdicts rather than coordination between two detectors: a
                // transport in either state names what went wrong, where "it never
                // connected" only names what did not happen.
                const spy = jest.fn();
                mockClientMonitor.on('ice-restart-recommended', spy);
                transport.iceState = iceState;
                mockPeerConnection.setConnectionState('connecting');

                tick(11000);

                expect(spy.mock.calls.every((call) => call[0].reason !== 'never-established')).toBe(true);
            }
        );
    });
});
