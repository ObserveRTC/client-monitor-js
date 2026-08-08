import { IceCandidateMonitor } from "../../src/monitors/IceCandidateMonitor";
import { IceCandidatePairMonitor } from "../../src/monitors/IceCandidatePairMonitor";
import { IceCandidateStats, IceCandidatePairStats } from "../../src/schema/ClientSample";

/**
 * A peer connection stub exposing only the candidate lookup maps the monitors
 * use, so these specs exercise the real monitor classes.
 */
class MockPeerConnectionMonitor {
    public readonly mappedIceCandidateMonitors = new Map<string, IceCandidateMonitor>();
    public readonly mappedIceTransportMonitors = new Map<string, unknown>();
}

function makeCandidate(peerConnection: MockPeerConnectionMonitor, stats: Partial<IceCandidateStats> & { id: string }) {
    const monitor = new IceCandidateMonitor(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        peerConnection as any,
        { timestamp: 1000, ...stats } as IceCandidateStats,
    );

    peerConnection.mappedIceCandidateMonitors.set(stats.id, monitor);

    return monitor;
}

function makePair(options: {
    local?: Partial<IceCandidateStats>;
    remote?: Partial<IceCandidateStats>;
    pair?: Partial<IceCandidatePairStats>;
} = {}) {
    const peerConnection = new MockPeerConnectionMonitor();

    if (options.local) makeCandidate(peerConnection, { id: 'local-1', ...options.local });
    if (options.remote) makeCandidate(peerConnection, { id: 'remote-1', ...options.remote });

    const pairMonitor = new IceCandidatePairMonitor(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        peerConnection as any,
        {
            id: 'pair-1',
            timestamp: 1000,
            transportId: 'transport-1',
            localCandidateId: options.local ? 'local-1' : undefined,
            remoteCandidateId: options.remote ? 'remote-1' : undefined,
            ...options.pair,
        } as IceCandidatePairStats,
    );

    return pairMonitor;
}

describe('IceCandidateMonitor path helpers', () => {
    it('detects a relay candidate from its candidate type', () => {
        const peerConnection = new MockPeerConnectionMonitor();
        const candidate = makeCandidate(peerConnection, { id: 'c', candidateType: 'relay', protocol: 'udp' });

        expect(candidate.isRelay).toBe(true);
    });

    it('falls back to relayProtocol when candidateType is missing', () => {
        const peerConnection = new MockPeerConnectionMonitor();
        const candidate = makeCandidate(peerConnection, { id: 'c', protocol: 'udp', relayProtocol: 'tcp' });

        expect(candidate.isRelay).toBe(true);
        expect(candidate.turnTransport).toBe('tcp');
    });

    it('does not treat a turn: url alone as a relay candidate', () => {
        // A srflx candidate discovered through a TURN server's STUN function
        // also carries a turn: url.
        const peerConnection = new MockPeerConnectionMonitor();
        const candidate = makeCandidate(peerConnection, {
            id: 'c',
            candidateType: 'srflx',
            protocol: 'udp',
            url: 'turn:turn.example.org:3478?transport=udp',
        });

        expect(candidate.isRelay).toBe(false);
        expect(candidate.turnServer).toBeUndefined();
    });

    it('normalizes unknown relay protocols away', () => {
        const peerConnection = new MockPeerConnectionMonitor();
        const candidate = makeCandidate(peerConnection, { id: 'c', candidateType: 'relay', relayProtocol: 'sctp' });

        expect(candidate.turnTransport).toBeUndefined();
    });

    it('strips the query from the TURN server identity', () => {
        const peerConnection = new MockPeerConnectionMonitor();
        const udp = makeCandidate(peerConnection, {
            id: 'a', candidateType: 'relay', url: 'turn:turn.example.org:3478?transport=udp',
        });
        const tcp = makeCandidate(peerConnection, {
            id: 'b', candidateType: 'relay', url: 'turn:turn.example.org:3478?transport=tcp',
        });

        expect(udp.turnServer).toBe('turn:turn.example.org:3478');
        expect(tcp.turnServer).toBe(udp.turnServer);
    });

    it('derives the address family and leaves mDNS unresolved', () => {
        const peerConnection = new MockPeerConnectionMonitor();

        expect(makeCandidate(peerConnection, { id: 'a', address: '10.0.0.1' }).addressFamily).toBe('ipv4');
        expect(makeCandidate(peerConnection, { id: 'b', address: '2001:db8::1' }).addressFamily).toBe('ipv6');
        expect(makeCandidate(peerConnection, { id: 'c', address: 'abcd-1234.local' }).addressFamily).toBeUndefined();
        expect(makeCandidate(peerConnection, { id: 'd' }).addressFamily).toBeUndefined();
    });
});

describe('IceCandidatePairMonitor path helpers', () => {
    describe('path classification', () => {
        it('classifies a host-to-host pair as direct', () => {
            const pair = makePair({
                local: { candidateType: 'host', protocol: 'udp' },
                remote: { candidateType: 'host', protocol: 'udp' },
            });

            expect(pair.usingTurn).toBe(false);
            expect(pair.usingTcp).toBe(false);
            expect(pair.pathKind).toBe('direct');
            expect(pair.relayProtocol).toBeUndefined();
        });

        it('classifies a srflx local candidate as direct', () => {
            const pair = makePair({ local: { candidateType: 'srflx', protocol: 'udp' } });

            expect(pair.pathKind).toBe('direct');
        });

        it.each([
            [ 'udp', 'turn-udp' ],
            [ 'tcp', 'turn-tcp' ],
            [ 'tls', 'turn-tls' ],
        ])('classifies relay over %s', (relayProtocol, expected) => {
            const pair = makePair({
                local: {
                    candidateType: 'relay',
                    protocol: 'udp',
                    relayProtocol,
                    url: `turn:turn.example.org:3478?transport=${relayProtocol}`,
                },
            });

            expect(pair.usingTurn).toBe(true);
            expect(pair.pathKind).toBe(expected);
            expect(pair.relayProtocol).toBe(relayProtocol);
            expect(pair.turnServer).toBe('turn:turn.example.org:3478');
        });

        it('reports turn-unknown when the browser hides relayProtocol', () => {
            const pair = makePair({
                local: { candidateType: 'relay', protocol: 'udp', url: 'turn:turn.example.org:3478' },
            });

            expect(pair.usingTurn).toBe(true);
            expect(pair.pathKind).toBe('turn-unknown');
            expect(pair.relayProtocol).toBeUndefined();
        });

        it('does not report TURN for a non-relay pair carrying a turn: url', () => {
            const pair = makePair({
                local: { candidateType: 'srflx', protocol: 'udp', url: 'turn:turn.example.org:3478' },
            });

            expect(pair.usingTurn).toBe(false);
            expect(pair.turnUrl).toBeUndefined();
            expect(pair.pathKind).toBe('direct');
        });

        it('takes every path signal from the same local candidate', () => {
            // Regression guard for the original two-`.some()` implementation:
            // one pair carried relayProtocol while a different one carried a
            // turn: url, and the combination was reported as TURN even though
            // neither pair was a relay path on its own.
            const relayProtocolOnly = makePair({ local: { candidateType: 'host', protocol: 'tcp' } });
            const turnUrlOnly = makePair({ local: { candidateType: 'srflx', protocol: 'udp', url: 'turn:t.example.org:3478' } });

            expect(relayProtocolOnly.usingTurn).toBe(false);
            expect(turnUrlOnly.usingTurn).toBe(false);
        });

        it('flags TCP from the local candidate protocol', () => {
            const pair = makePair({ local: { candidateType: 'host', protocol: 'tcp' } });

            expect(pair.usingTcp).toBe(true);
        });

        it('tolerates a pair whose candidates are not in the stats yet', () => {
            const pair = makePair();

            expect(pair.usingTurn).toBe(false);
            expect(pair.usingTcp).toBe(false);
            expect(pair.pathKind).toBe('direct');
            expect(pair.turnServer).toBeUndefined();
        });
    });

    describe('identity', () => {
        it('keys on the transport id', () => {
            expect(makePair({ pair: { transportId: 'transport-7' } }).pathKey).toBe('transport-7');
        });

        it('falls back to the local candidate transport id', () => {
            const pair = makePair({
                local: { transportId: 'transport-from-candidate' },
                pair: { transportId: undefined },
            });

            expect(pair.pathKey).toBe('transport-from-candidate');
        });

        it('never keys on the pair id, so a path survives a pair switch', () => {
            // Keying on the pair id would mint a new path on every switch,
            // resetting the accumulated usage facts.
            const before = makePair({ pair: { id: 'pair-1', transportId: undefined } });
            const after = makePair({ pair: { id: 'pair-2', transportId: undefined } });

            expect(before.pathKey).not.toBe('pair-1');
            expect(after.pathKey).not.toBe('pair-2');
            expect(before.pathKey).toBe(after.pathKey);
        });

        it('builds the network tuple used by the ice tuple detector', () => {
            const pair = makePair({
                local: { protocol: 'udp', address: '10.0.0.1', port: 1111 },
                remote: { protocol: 'udp', address: '203.0.113.5', port: 3478 },
            });

            expect(pair.tuple).toBe('10.0.0.1:1111:203.0.113.5:3478:udp');
        });
    });

    describe('stun round trip', () => {
        it('averages over the checks that completed in the interval', () => {
            const pair = makePair({ pair: { totalRoundTripTime: 1.0, responsesReceived: 10 } });

            pair.accept({
                id: 'pair-1',
                timestamp: 3000,
                transportId: 'transport-1',
                totalRoundTripTime: 1.6,
                responsesReceived: 14,
            } as IceCandidatePairStats);

            expect(pair.avgRoundTripTimeInSec).toBeCloseTo(0.15);
        });

        it('reports no average when no check completed', () => {
            const pair = makePair({ pair: { totalRoundTripTime: 1.0, responsesReceived: 10, currentRoundTripTime: 0.08 } });

            pair.accept({
                id: 'pair-1',
                timestamp: 3000,
                transportId: 'transport-1',
                totalRoundTripTime: 1.0,
                responsesReceived: 10,
                currentRoundTripTime: 0.08,
            } as IceCandidatePairStats);

            // the consumer falls back to the (possibly stale) currentRoundTripTime
            expect(pair.avgRoundTripTimeInSec).toBeUndefined();
            expect(pair.currentRoundTripTime).toBeCloseTo(0.08);
        });
    });

    describe('stats integrity', () => {
        it('keeps the derived getters working after accept()', () => {
            const pair = makePair({
                local: { candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls', url: 'turns:t.example.org:5349' },
                remote: { candidateType: 'host', protocol: 'udp' },
            });

            pair.accept({
                id: 'pair-1',
                timestamp: 2000,
                transportId: 'transport-1',
                localCandidateId: 'local-1',
                remoteCandidateId: 'remote-1',
                state: 'succeeded',
                bytesSent: 100,
                bytesReceived: 200,
            } as IceCandidatePairStats);

            expect(pair.state).toBe('succeeded');
            expect(pair.pathKind).toBe('turn-tls');
            expect(pair.usingTurn).toBe(true);
        });

        it('does not leak derived getters into the sample', () => {
            const pair = makePair({ local: { candidateType: 'relay', protocol: 'udp', relayProtocol: 'udp' } });
            const sample = pair.createSample();

            expect(sample).not.toHaveProperty('pathKind');
            expect(sample).not.toHaveProperty('usingTurn');
            expect(sample).not.toHaveProperty('tuple');
            expect(sample.id).toBe('pair-1');
        });
    });
});
