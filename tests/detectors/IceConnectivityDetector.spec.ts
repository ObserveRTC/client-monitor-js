import { IceConnectivityDetector } from "../../src/detectors/IceConnectivityDetector";

interface IceConnectivityConfig {
    disconnectedThresholdInMs: number;
    transportStallThresholdInMs: number;
    createEvent: boolean;
    pathSwitchWindowInMs: number;
    pathSwitchThreshold: number;
    iceRestartRecommendationThresholdInMs: number;
    iceRestartRecommendationCooldownInMs: number;
}

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

interface EventHandler {
    (event: Record<string, unknown>): void;
}

class MockClientMonitor {
    public config = {
        iceConnectivityDetector: {
            disconnectedThresholdInMs: 5000,
            transportStallThresholdInMs: 5000,
            createEvent: true,
            pathSwitchWindowInMs: 30000,
            pathSwitchThreshold: 3,
            iceRestartRecommendationThresholdInMs: 10000,
            iceRestartRecommendationCooldownInMs: 15000,
        } as IceConnectivityConfig,
    };

    private eventHandlers: { [key: string]: EventHandler[] } = {};
    public readonly activeIssues = new Map<string, TestIssue>();
    public readonly addedEvents: { type: string; payload?: Record<string, unknown> }[] = [];
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        const handlers = this.eventHandlers[eventName] || [];
        handlers.forEach(handler => handler(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        if (!this.eventHandlers[eventName]) {
            this.eventHandlers[eventName] = [];
        }
        this.eventHandlers[eventName].push(handler);
    }

    addEvent(event: { type: string; payload?: Record<string, unknown> }) {
        this.addedEvents.push(event);
    }

    raiseIssue(key: string, input: { type: string; payload?: Record<string, unknown> }) {
        const existing = this.activeIssues.get(key);
        if (existing) {
            existing.payload = input.payload ?? {};
            existing.type = input.type;
            this.emit('issue-updated', existing as unknown as Record<string, unknown>);
            return existing;
        }
        const issue: TestIssue = {
            id: `iss_${this.nextId++}`,
            type: input.type,
            key,
            payload: input.payload ?? {},
        };
        this.activeIssues.set(key, issue);
        this.emit('issue', issue as unknown as Record<string, unknown>);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown>; resolvedAt?: number }) {
        const found = this.activeIssues.get(key);
        if (!found) return undefined;
        this.activeIssues.delete(key);
        const resolved = {
            ...found,
            payload: opts?.payload ?? found.payload,
            resolvedAt: opts?.resolvedAt ?? Date.now(),
            comment: opts?.comment,
        };
        this.emit('issue-resolved', resolved as unknown as Record<string, unknown>);
        return resolved;
    }

    getIssues() {
        return [...this.activeIssues.values()];
    }

    getIssuesByType(type: string) {
        return this.getIssues().filter(issue => issue.type === type);
    }
}

class MockCandidatePair {
    public id = 'pair-1';
    public state: string | undefined = 'succeeded';
    public deltaBytesSent: number | undefined = 0;
    public deltaBytesReceived: number | undefined = 0;
    public currentRoundTripTime: number | undefined = 0.05;
    public lastPacketReceivedTimestamp: number | undefined = 0;
    public localUsernameFragment: string | undefined = undefined;

    getLocalCandidate() {
        return { usernameFragment: this.localUsernameFragment };
    }
}

class MockIceTransport {
    public dtlsState: string | undefined = 'connected';
    public selectedCandidatePairId: string | undefined = 'pair-1';
    public iceLocalUsernameFragment: string | undefined = 'ufrag-1';

    public constructor(
        public id = 'transport-1',
        public iceState: string | undefined = 'connected',
        public pair: MockCandidatePair | undefined = new MockCandidatePair(),
    ) {
    }

    getSelectedCandidatePair() {
        return this.pair;
    }
}

/** A selected-ice-path stub: the detector only reads its identity and switch count. */
class MockSelectedIcePath {
    public switches = 0;

    public constructor(
        public key = 'transport-1',
        public transportId: string | undefined = 'transport-1',
        public kind = 'direct',
    ) {
    }

    getSwitchCountSince() {
        return this.switches;
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    public connectionState: string | undefined = 'connected';
    public connectingStartedAt: number | undefined = undefined;
    public iceTransports: MockIceTransport[] = [];

    /** Mirrors the real monitor's connectionState setter behaviour. */
    setConnectionState(state: string | undefined) {
        this.connectionState = state;
        if (state === 'connecting') this.connectingStartedAt = Date.now();
        else if (state !== 'connected') this.connectingStartedAt = undefined;
    }
    public selectedIcePaths: MockSelectedIcePath[] = [];

    setTransports(...transports: MockIceTransport[]) {
        this.iceTransports = transports;
    }

    setPaths(...paths: MockSelectedIcePath[]) {
        this.selectedIcePaths = paths;
    }
}

describe('IceConnectivityDetector', () => {
    let detector: IceConnectivityDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let transport: MockIceTransport;
    let pair: MockCandidatePair;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        pair = new MockCandidatePair();
        transport = new MockIceTransport('transport-1', 'connected', pair);
        mockPeerConnection.setTransports(transport);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceConnectivityDetector(mockPeerConnection as any);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('ice-connectivity-detector');
        });
    });

    describe('Basic validation', () => {
        it('should return early if detector is disabled', () => {
            detector.disabled = true;
            transport.iceState = 'failed';

            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing while the transport is healthy', () => {
            pair.deltaBytesReceived = 1000;
            pair.deltaBytesSent = 1000;

            detector.update();
            jest.advanceTimersByTime(60000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('does not treat checking as a problem', () => {
            transport.iceState = 'checking';

            detector.update();
            jest.advanceTimersByTime(60000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Persistent disconnection', () => {
        it('does not raise an issue for a brief disconnection', () => {
            transport.iceState = 'disconnected';
            detector.update();

            jest.advanceTimersByTime(3000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises an issue once the disconnection persists past the threshold', () => {
            transport.iceState = 'disconnected';
            detector.update();

            jest.advanceTimersByTime(6000);
            detector.update();

            const issues = mockClientMonitor.getIssuesByType('ice-disconnected');
            expect(issues).toHaveLength(1);
            expect(issues[0].payload).toEqual(expect.objectContaining({
                peerConnectionId: 'test-pc-id',
                transportId: 'transport-1',
                iceState: 'disconnected',
                iceGeneration: 0,
            }));
            expect(issues[0].payload.disconnectedForMs as number).toBeGreaterThanOrEqual(6000);
        });

        it('does not duplicate the issue on repeated updates', () => {
            const issueSpy = jest.fn();
            mockClientMonitor.on('issue', issueSpy);
            transport.iceState = 'disconnected';
            detector.update();

            jest.advanceTimersByTime(6000);
            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();
            detector.update();

            expect(issueSpy).toHaveBeenCalledTimes(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('resolves the issue with a duration when ICE reconnects', () => {
            const resolvedSpy = jest.fn();
            mockClientMonitor.on('issue-resolved', resolvedSpy);
            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();

            jest.advanceTimersByTime(4000);
            transport.iceState = 'connected';
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(resolvedSpy).toHaveBeenCalledWith(expect.objectContaining({
                type: 'ice-disconnected',
                comment: 'ice connection recovered',
                payload: expect.objectContaining({ durationInMs: 4000 }),
            }));
        });

        it('restarts the timer after a recovery so the next blip is judged fresh', () => {
            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(3000);
            transport.iceState = 'connected';
            detector.update();

            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(3000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('ICE failure', () => {
        it('raises an issue immediately on failed', () => {
            transport.iceState = 'failed';

            detector.update();

            const issues = mockClientMonitor.getIssuesByType('ice-connection-failed');
            expect(issues).toHaveLength(1);
            expect(issues[0].payload).toEqual(expect.objectContaining({
                transportId: 'transport-1',
                dtlsState: 'connected',
            }));
        });

        it('does not duplicate the failed issue', () => {
            const issueSpy = jest.fn();
            mockClientMonitor.on('issue', issueSpy);
            transport.iceState = 'failed';

            detector.update();
            detector.update();
            jest.advanceTimersByTime(10000);
            detector.update();

            expect(issueSpy).toHaveBeenCalledTimes(1);
        });

        it('resolves the failed issue if the connection comes back', () => {
            transport.iceState = 'failed';
            detector.update();
            expect(mockClientMonitor.getIssuesByType('ice-connection-failed')).toHaveLength(1);

            jest.advanceTimersByTime(2000);
            transport.iceState = 'connected';
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('does not leave a disconnected issue behind when the transport fails', () => {
            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();
            expect(mockClientMonitor.getIssuesByType('ice-disconnected')).toHaveLength(1);

            transport.iceState = 'failed';
            detector.update();
            transport.iceState = 'connected';
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Inbound transport stall', () => {
        const tick = (sent: number, received: number, elapsedMs = 1000) => {
            pair.deltaBytesSent = sent;
            pair.deltaBytesReceived = received;
            detector.update();
            jest.advanceTimersByTime(elapsedMs);
        };

        it('raises a stall issue when we keep sending but stop receiving', () => {
            tick(1000, 1000); // healthy traffic first — proves inbound was alive

            tick(1000, 0);
            tick(1000, 0);
            tick(1000, 0);
            tick(1000, 0);
            tick(1000, 0);
            tick(1000, 0);

            const issues = mockClientMonitor.getIssuesByType('ice-transport-stalled');
            expect(issues).toHaveLength(1);
            expect(issues[0].payload).toEqual(expect.objectContaining({
                direction: 'inbound',
                candidatePairState: 'succeeded',
                outboundBytesDelta: 1000,
                inboundBytesDelta: 0,
            }));
        });

        it('does not raise a stall before the threshold elapses', () => {
            tick(1000, 1000);
            tick(1000, 0);
            tick(1000, 0);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('does not raise a stall when nothing flows in either direction', () => {
            // An idle or receive-only peer connection: no evidence traffic is expected.
            tick(1000, 1000);

            for (let i = 0; i < 10; ++i) tick(0, 0);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('does not raise a stall before inbound traffic was ever observed', () => {
            for (let i = 0; i < 10; ++i) tick(1000, 0);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('does not raise a stall when the pair is not succeeded', () => {
            tick(1000, 1000);
            pair.state = 'in-progress';

            for (let i = 0; i < 10; ++i) tick(1000, 0);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('resolves the stall when inbound traffic resumes', () => {
            tick(1000, 1000);
            for (let i = 0; i < 7; ++i) tick(1000, 0);
            expect(mockClientMonitor.getIssuesByType('ice-transport-stalled')).toHaveLength(1);

            tick(1000, 500);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('ignores transports whose deltas are unavailable', () => {
            pair.deltaBytesReceived = undefined;
            pair.deltaBytesSent = undefined;

            detector.update();
            jest.advanceTimersByTime(20000);
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('ICE restart inference', () => {
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
            expect(mockClientMonitor.addedEvents.some(event => event.type === 'ICE_RESTART')).toBe(true);
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

        it('falls back to the selected local candidate username fragment', () => {
            const restartSpy = jest.fn();
            mockClientMonitor.on('ice-restart', restartSpy);
            transport.iceLocalUsernameFragment = undefined;
            pair.localUsernameFragment = 'cand-ufrag-1';
            detector.update();

            pair.localUsernameFragment = 'cand-ufrag-2';
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
    });

    describe('Multiple ICE transports', () => {
        it('tracks each transport independently', () => {
            const second = new MockIceTransport('transport-2', 'connected', new MockCandidatePair());
            second.iceLocalUsernameFragment = 'ufrag-b';
            mockPeerConnection.setTransports(transport, second);

            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();

            const issues = mockClientMonitor.getIssuesByType('ice-disconnected');
            expect(issues).toHaveLength(1);
            expect(issues[0].payload).toEqual(expect.objectContaining({ transportId: 'transport-1' }));
        });

        it('resolves issues owned by a transport that disappears', () => {
            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.setTransports();
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });
    });

    describe('Unstable selected path', () => {
        let path: MockSelectedIcePath;

        beforeEach(() => {
            path = new MockSelectedIcePath();
            mockPeerConnection.setPaths(path);
        });

        it('stays quiet below the switch threshold', () => {
            path.switches = 2;

            detector.update();

            expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
        });

        it('raises an issue once the path keeps switching', () => {
            path.switches = 3;

            detector.update();

            const issues = mockClientMonitor.getIssuesByType('unstable-ice-path');
            expect(issues).toHaveLength(1);
            expect(issues[0].payload).toEqual(expect.objectContaining({
                peerConnectionId: 'test-pc-id',
                pathKey: 'transport-1',
                switches: 3,
                windowInMs: 30000,
            }));
        });

        it('does not duplicate the issue while the path stays unstable', () => {
            const issueSpy = jest.fn();
            mockClientMonitor.on('issue', issueSpy);
            path.switches = 4;

            detector.update();
            detector.update();
            detector.update();

            expect(issueSpy).toHaveBeenCalledTimes(1);
        });

        it('resolves once the window drains', () => {
            path.switches = 3;
            detector.update();
            expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(1);

            path.switches = 0;
            jest.advanceTimersByTime(31000);
            detector.update();

            expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
        });

        it('resolves when the path disappears', () => {
            path.switches = 3;
            detector.update();
            expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(1);

            mockPeerConnection.setPaths();
            detector.update();

            expect(mockClientMonitor.getIssuesByType('unstable-ice-path')).toHaveLength(0);
        });
    });

    describe('ICE restart recommendation', () => {
        it('recommends immediately on failed, since ICE never self-heals from it', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';

            detector.update();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                peerConnectionId: 'test-pc-id',
                transportId: 'transport-1',
                reason: 'ice-failed',
                recommendationCount: 1,
            }));
            expect(mockClientMonitor.addedEvents.some(e => e.type === 'ICE_RESTART_RECOMMENDED')).toBe(true);
        });

        it('waits out the threshold before recommending on disconnected', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'disconnected';

            detector.update();
            jest.advanceTimersByTime(6000);
            detector.update();
            expect(spy).not.toHaveBeenCalled();

            jest.advanceTimersByTime(5000);
            detector.update();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ice-disconnected' }));
            expect(spy.mock.calls[0][0].conditionDurationInMs).toBeGreaterThanOrEqual(10000);
        });

        it('recommends when a connected transport stays stalled', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            pair.deltaBytesSent = 1000;
            pair.deltaBytesReceived = 1000;
            detector.update();

            pair.deltaBytesReceived = 0;
            for (let i = 0; i < 12; ++i) {
                detector.update();
                jest.advanceTimersByTime(1000);
            }

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'transport-stalled' }));
        });

        it('does not nag while the condition persists', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';

            detector.update();
            jest.advanceTimersByTime(5000);
            detector.update();
            jest.advanceTimersByTime(5000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('recommends again once the cooldown elapses', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';

            detector.update();
            jest.advanceTimersByTime(16000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[1][0].recommendationCount).toBe(2);
        });

        it('stays silent while a restart the application already started is in flight', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            transport.iceState = 'connected';
            detector.update();

            transport.iceState = 'disconnected';
            detector.update();
            jest.advanceTimersByTime(11000);

            // The application restarted ICE before we asked: a new username
            // fragment appears while the transport is still down.
            transport.iceLocalUsernameFragment = 'ufrag-2';
            detector.update();
            jest.advanceTimersByTime(2000);
            detector.update();

            expect(spy).not.toHaveBeenCalled();
        });

        it('asks again when a restart itself failed, with a higher count', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            transport.iceState = 'failed';
            detector.update();
            expect(spy).toHaveBeenCalledTimes(1);

            // The application restarted, and the new generation failed too.
            transport.iceState = 'checking';
            transport.iceLocalUsernameFragment = 'ufrag-2';
            jest.advanceTimersByTime(16000);
            detector.update();

            transport.iceState = 'failed';
            detector.update();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[1][0]).toEqual(expect.objectContaining({
                recommendationCount: 2,
                iceGeneration: 1,
            }));
        });

        it('is silent on a healthy transport', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            pair.deltaBytesSent = 1000;
            pair.deltaBytesReceived = 1000;

            for (let i = 0; i < 20; ++i) {
                detector.update();
                jest.advanceTimersByTime(1000);
            }

            expect(spy).not.toHaveBeenCalled();
        });

        it('rearms after a recovery so a later incident recommends promptly', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            transport.iceState = 'failed';
            detector.update();
            expect(spy).toHaveBeenCalledTimes(1);

            transport.iceState = 'connected';
            jest.advanceTimersByTime(1000);
            detector.update();

            transport.iceState = 'failed';
            jest.advanceTimersByTime(1000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(2);
        });
    });

    describe('Never-established recommendation', () => {
        it('recommends a restart when the peer connection never finishes connecting', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setTransports();
            mockPeerConnection.setConnectionState('connecting');

            jest.advanceTimersByTime(11000);
            detector.update();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                peerConnectionId: 'test-pc-id',
                reason: 'never-established',
                recommendationCount: 1,
            }));
            expect(spy.mock.calls[0][0].transportId).toBeUndefined();
        });

        it('waits out the threshold', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            jest.advanceTimersByTime(6000);
            detector.update();

            expect(spy).not.toHaveBeenCalled();
        });

        it('says nothing about an established connection', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connected');

            jest.advanceTimersByTime(60000);
            detector.update();

            expect(spy).not.toHaveBeenCalled();
        });

        it('reports even while every ICE transport still looks like it is checking', () => {
            // connectionState covers the DTLS handshake too, so this is exactly
            // the case a transport-state-only check cannot see.
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'checking';
            mockPeerConnection.setConnectionState('connecting');

            jest.advanceTimersByTime(11000);
            detector.update();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'never-established' }));
        });

        it('does not nag while establishment drags on', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            jest.advanceTimersByTime(11000);
            detector.update();
            jest.advanceTimersByTime(5000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('asks again after the cooldown', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');

            jest.advanceTimersByTime(11000);
            detector.update();
            jest.advanceTimersByTime(16000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[1][0].recommendationCount).toBe(2);
        });

        it('rearms once the connection finally establishes', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);

            mockPeerConnection.setConnectionState('connecting');
            jest.advanceTimersByTime(11000);
            detector.update();
            expect(spy).toHaveBeenCalledTimes(1);

            mockPeerConnection.setConnectionState('connected');
            detector.update();

            mockPeerConnection.setConnectionState('connecting');
            jest.advanceTimersByTime(11000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('does not pile on when a transport already recommended this tick', () => {
            const spy = jest.fn();
            mockClientMonitor.on('ice-restart-recommended', spy);
            transport.iceState = 'failed';
            mockPeerConnection.setConnectionState('connecting');

            jest.advanceTimersByTime(11000);
            detector.update();

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].reason).toBe('ice-failed');
        });

        it('stays quiet while a restart the application started is in flight', () => {
            const spy = jest.fn();
            transport.iceState = 'checking';
            detector.update();

            transport.iceLocalUsernameFragment = 'ufrag-2';
            detector.update();

            mockClientMonitor.on('ice-restart-recommended', spy);
            mockPeerConnection.setConnectionState('connecting');
            jest.advanceTimersByTime(11000);
            detector.update();

            expect(spy).not.toHaveBeenCalled();
        });
    });
});
