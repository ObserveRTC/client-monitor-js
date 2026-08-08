import { SelectedIcePath } from "../../src/monitors/SelectedIcePath";
import { IcePathKind } from "../../src/monitors/IceCandidatePairMonitor";

interface EventHandler {
    (event: Record<string, unknown>): void;
}

class MockClientMonitor {
    public config = {};
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
}

/** A candidate-pair stub exposing the getters the path reads through. */
function makePair(options: {
    kind: IcePathKind;
    relayProtocol?: 'udp' | 'tcp' | 'tls';
    turnServer?: string;
    tuple?: string;
    deltaBytesSent?: number;
    deltaBytesReceived?: number;
    deltaPacketsSent?: number;
    deltaPacketsReceived?: number;
    transportId?: string;
}) {
    const {
        kind,
        relayProtocol,
        turnServer,
        tuple = '10.0.0.1:1111:203.0.113.5:3478:udp',
        deltaBytesSent = 0,
        deltaBytesReceived = 0,
        deltaPacketsSent = 0,
        deltaPacketsReceived = 0,
        transportId = 'transport-1',
    } = options;
    const usingTurn = kind !== 'direct';

    return {
        id: 'pair-1',
        transportId,
        pathKey: transportId,
        localCandidateId: 'local-1',
        remoteCandidateId: 'remote-1',
        pathKind: kind,
        usingTurn,
        usingTcp: false,
        relayProtocol,
        turnUrl: turnServer ? `${turnServer}?transport=${relayProtocol ?? 'udp'}` : undefined,
        turnServer,
        tuple,
        state: 'succeeded',
        currentRoundTripTime: 0.05,
        deltaBytesSent,
        deltaBytesReceived,
        deltaPacketsSent,
        deltaPacketsReceived,
        getLocalCandidate: () => ({
            candidateType: usingTurn ? 'relay' : 'host',
            protocol: 'udp',
            address: '10.0.0.1',
            port: 1111,
            addressFamily: 'ipv4',
        }),
        getRemoteCandidate: () => ({
            candidateType: 'host',
            protocol: 'udp',
            address: '203.0.113.5',
            port: 3478,
            addressFamily: 'ipv4',
        }),
        getIceTransport: () => ({ id: transportId }),
    };
}

function createPath(options: Parameters<typeof makePair>[0]) {
    const peerConnection = new MockPeerConnectionMonitor();
    const pair = makePair(options);
    const path = new SelectedIcePath(
        pair.pathKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pair as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        peerConnection as any,
    );

    return { path, peerConnection, clientMonitor: peerConnection.parent };
}

describe('SelectedIcePath', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    describe('descriptive getters read through the linked monitors', () => {
        it('exposes the pair, candidates and transport it links to', () => {
            const { path } = createPath({ kind: 'turn-tls', relayProtocol: 'tls', turnServer: 'turns:t.example.org:5349' });

            expect(path.localCandidate?.candidateType).toBe('relay');
            expect(path.remoteCandidate?.candidateType).toBe('host');
            expect(path.iceTransport?.id).toBe('transport-1');
            expect(path.pairId).toBe('pair-1');
            expect(path.transportId).toBe('transport-1');
        });

        it('reflects the pair classification without copying it', () => {
            const { path } = createPath({ kind: 'turn-tcp', relayProtocol: 'tcp', turnServer: 'turn:t.example.org:3478' });

            expect(path.kind).toBe('turn-tcp');
            expect(path.usingTurn).toBe(true);
            expect(path.relayProtocol).toBe('tcp');
            expect(path.turnServer).toBe('turn:t.example.org:3478');
            expect(path.protocol).toBe('udp');
            expect(path.localAddress).toBe('10.0.0.1');
            expect(path.remotePort).toBe(3478);
            expect(path.localAddressFamily).toBe('ipv4');
        });

        it('follows the pair it is updated with', () => {
            const { path } = createPath({ kind: 'direct' });
            expect(path.kind).toBe('direct');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'turn-udp', relayProtocol: 'udp', tuple: 'relay-tuple' }) as any);

            expect(path.kind).toBe('turn-udp');
            expect(path.localCandidateType).toBe('relay');
        });
    });

    describe('transitions', () => {
        const advance = (path: SelectedIcePath, options: Parameters<typeof makePair>[0], ms = 1000) => {
            jest.advanceTimersByTime(ms);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair(options) as any);
        };

        it('emits the initial selection on both the path and the monitor', () => {
            const { path, clientMonitor } = createPath({ kind: 'direct' });
            const pathSpy = jest.fn();
            const monitorSpy = jest.fn();

            path.on('changed', pathSpy);
            clientMonitor.on('ice-path-changed', monitorSpy);
            path.notifyInitialSelection();

            expect(pathSpy).toHaveBeenCalledWith(expect.objectContaining({ transition: 'initial-selection', from: undefined }));
            expect(monitorSpy).toHaveBeenCalledWith(expect.objectContaining({ transition: 'initial-selection' }));
            expect(clientMonitor.addedEvents[0]?.type).toBe('PEER_CONNECTION_ICE_PATH_CHANGED');
        });

        it.each([
            [ 'direct-to-relay', { kind: 'direct' as IcePathKind }, { kind: 'turn-udp' as IcePathKind, relayProtocol: 'udp' as const, tuple: 'b' } ],
            [ 'relay-to-direct', { kind: 'turn-udp' as IcePathKind, relayProtocol: 'udp' as const }, { kind: 'direct' as IcePathKind, tuple: 'b' } ],
        ])('detects %s', (transition, from, to) => {
            const { path, clientMonitor } = createPath(from);
            const spy = jest.fn();

            clientMonitor.on('ice-path-changed', spy);
            advance(path, to);

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ transition }));
        });

        it('detects a relay protocol change on the same server', () => {
            const { path, clientMonitor } = createPath({ kind: 'turn-udp', relayProtocol: 'udp', turnServer: 'turn:a:3478' });
            const spy = jest.fn();

            clientMonitor.on('ice-path-changed', spy);
            advance(path, { kind: 'turn-tcp', relayProtocol: 'tcp', turnServer: 'turn:a:3478', tuple: 'tcp-tuple' });

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ transition: 'relay-protocol-changed' }));
            expect(path.relayProtocolSwitches).toBe(1);
        });

        it('detects a TURN server change', () => {
            const { path, clientMonitor } = createPath({ kind: 'turn-udp', relayProtocol: 'udp', turnServer: 'turn:a:3478' });
            const spy = jest.fn();

            clientMonitor.on('ice-path-changed', spy);
            advance(path, { kind: 'turn-udp', relayProtocol: 'udp', turnServer: 'turn:b:3478', tuple: 'b-tuple' });

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ transition: 'turn-server-changed' }));
            expect(path.turnServerSwitches).toBe(1);
        });

        it('stays silent while the path is unchanged', () => {
            const { path, clientMonitor } = createPath({ kind: 'turn-udp', relayProtocol: 'udp' });
            const spy = jest.fn();

            clientMonitor.on('ice-path-changed', spy);
            advance(path, { kind: 'turn-udp', relayProtocol: 'udp' });
            advance(path, { kind: 'turn-udp', relayProtocol: 'udp' });

            expect(spy).not.toHaveBeenCalled();
            expect(path.pathSwitches).toBe(0);
        });

        it('counts switches in a window', () => {
            const { path } = createPath({ kind: 'direct', tuple: 't0' });

            advance(path, { kind: 'turn-udp', relayProtocol: 'udp', tuple: 't1' });
            advance(path, { kind: 'direct', tuple: 't2' });
            const afterTwo = Date.now();
            jest.advanceTimersByTime(60000);
            advance(path, { kind: 'turn-udp', relayProtocol: 'udp', tuple: 't3' });

            expect(path.pathSwitches).toBe(3);
            // The window boundary is inclusive: the second switch happened at
            // exactly `afterTwo`, so it still counts from there.
            expect(path.getSwitchCountSince(afterTwo)).toBe(2);
            expect(path.getSwitchCountSince(afterTwo + 1)).toBe(1);
            expect(path.getSwitchCountSince(0)).toBe(3);
        });
    });

    describe('TURN usage accounting', () => {
        it('attributes elapsed time to the kind that was active', () => {
            const { path } = createPath({ kind: 'direct' });

            jest.advanceTimersByTime(4000);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'turn-udp', relayProtocol: 'udp', tuple: 'relay' }) as any);
            jest.advanceTimersByTime(6000);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'turn-udp', relayProtocol: 'udp', tuple: 'relay' }) as any);

            expect(path.durations['direct']).toBe(4000);
            expect(path.durations['turn-udp']).toBe(6000);
            expect(path.relayDurationInMs).toBe(6000);
        });

        it('records the time to the first relay selection', () => {
            const { path } = createPath({ kind: 'direct' });

            jest.advanceTimersByTime(3000);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'turn-tcp', relayProtocol: 'tcp', tuple: 'relay' }) as any);

            expect(path.timeToFirstRelayInMs).toBe(3000);
        });

        it('reports no relay time when a relay was never selected', () => {
            const { path } = createPath({ kind: 'direct' });

            jest.advanceTimersByTime(5000);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'direct' }) as any);

            expect(path.timeToFirstRelayInMs).toBeUndefined();
            expect(path.relayDurationInMs).toBe(0);
        });

        it('separates relay traffic from total traffic', () => {
            const { path } = createPath({ kind: 'direct' });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'direct', deltaBytesSent: 100, deltaBytesReceived: 200 }) as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'turn-udp', relayProtocol: 'udp', tuple: 'r', deltaBytesSent: 300, deltaBytesReceived: 400, deltaPacketsSent: 3, deltaPacketsReceived: 4 }) as any);

            expect(path.totalBytesSent).toBe(400);
            expect(path.totalBytesReceived).toBe(600);
            expect(path.relayBytesSent).toBe(300);
            expect(path.relayBytesReceived).toBe(400);
            expect(path.relayPacketsSent).toBe(3);
            expect(path.relayBytesRatio).toBeCloseTo(0.7, 5);
        });

        it('marks a path that started on a relay', () => {
            const { path } = createPath({ kind: 'turn-udp', relayProtocol: 'udp' });

            expect(path.timeToFirstRelayInMs).toBe(0);
        });
    });

    describe('lifecycle', () => {
        it('closes idempotently and settles the final duration', () => {
            const { path } = createPath({ kind: 'turn-udp', relayProtocol: 'udp' });
            const closeSpy = jest.fn();

            path.on('close', closeSpy);
            jest.advanceTimersByTime(5000);
            path.close();
            path.close();

            expect(closeSpy).toHaveBeenCalledTimes(1);
            expect(path.closed).toBe(true);
            expect(path.durations['turn-udp']).toBe(5000);
        });

        it('ignores updates after close', () => {
            const { path, clientMonitor } = createPath({ kind: 'direct' });
            const spy = jest.fn();

            clientMonitor.on('ice-path-changed', spy);
            path.close();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.update(makePair({ kind: 'turn-udp', relayProtocol: 'udp', tuple: 'r' }) as any);

            expect(spy).not.toHaveBeenCalled();
            expect(path.pathSwitches).toBe(0);
        });
    });
});
