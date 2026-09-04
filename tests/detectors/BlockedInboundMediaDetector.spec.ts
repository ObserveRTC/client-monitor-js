import { BlockedInboundMediaDetector } from "../../src/detectors/BlockedInboundMediaDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        blockedInboundMediaDetector: {
            thresholdInMs: 10_000,
        },
    };

    public readonly activeIssues = new Map<string, TestIssue>();
    public readonly resolvedIssues: (TestIssue & { comment?: string })[] = [];
    public readonly emitted: { name: string; payload: Record<string, unknown> }[] = [];
    private nextId = 0;

    emit(eventName: string, eventData: Record<string, unknown>) {
        this.emitted.push({ name: eventName, payload: eventData });
    }

    raiseIssue(key: string, input: { type: string; payload?: Record<string, unknown> }) {
        const existing = this.activeIssues.get(key);
        if (existing) {
            existing.payload = input.payload ?? {};
            return existing;
        }
        const issue: TestIssue = { id: `iss_${this.nextId++}`, type: input.type, key, payload: input.payload ?? {} };
        this.activeIssues.set(key, issue);
        return issue;
    }

    resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown> }) {
        const found = this.activeIssues.get(key);
        if (!found) return undefined;
        this.activeIssues.delete(key);
        this.resolvedIssues.push({ ...found, payload: opts?.payload ?? found.payload, comment: opts?.comment });
        return found;
    }

    getIssues() {
        return [...this.activeIssues.values()];
    }

    getIssuesByType(type: string) {
        return this.getIssues().filter(issue => issue.type === type);
    }
}

class MockCandidatePair {
    public state: string | undefined = 'succeeded';
    /**
     * STUN answering is what separates a media block from the path going away, so a
     * healthy path is the default here — a window on a silent path never raises.
     */
    public deltaResponsesReceived: number | undefined = 1;
    public pathKind = 'direct';
}

/**
 * The far end's report of what it sent us, over RTCP.
 *
 * `deltaTime` is the freshness: positive on a collection where a report actually
 * arrived, `0` where `getStats()` served the same frozen report again. A stale report
 * must never be read as a live claim, or a peer that merely paused reads as blocked.
 */
class MockRemoteOutboundRtp {
    public constructor(
        public deltaPacketsSent: number | undefined = 100,
        public deltaTime: number | undefined = 2000,
    ) {
    }
}

class MockInboundRtp {
    public constructor(
        public deltaPacketsReceived: number | undefined = 0,
        public remoteOutboundRtp: MockRemoteOutboundRtp | undefined = new MockRemoteOutboundRtp(),
    ) {
    }

    getRemoteOutboundRtp() {
        return this.remoteOutboundRtp;
    }

    /** The far end has gone quiet: the report stops advancing but stays in getStats(). */
    goesQuiet() {
        if (this.remoteOutboundRtp) this.remoteOutboundRtp.deltaTime = 0;

        return this;
    }
}

class MockPeerConnectionMonitor {
    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    /** Every clock in this detector accumulates stats time, so the specs advance this. */
    public deltaTime: number | undefined = 2000;
    /** Maintained by `BlockedStunRequestsDetector`; this detector only reads it. */
    public blockedTransport = false;
    public pairs: MockCandidatePair[] = [ new MockCandidatePair() ];
    public inboundRtps: MockInboundRtp[] = [ new MockInboundRtp() ];

    public get selectedIceCandidatePairs() {
        return this.pairs;
    }
}

describe('BlockedInboundMediaDetector', () => {
    let detector: BlockedInboundMediaDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let pair: MockCandidatePair;
    let inboundRtp: MockInboundRtp;

    /** Runs `count` ticks, each describing `peerConnection.deltaTime` of stats time. */
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    /**
     * An inbound stream with no `remote-outbound-rtp` at all. Built by assignment rather
     * than by passing `undefined` to the constructor: an explicitly passed `undefined`
     * still takes the parameter default, which would quietly link a report here.
     */
    const unreportedStream = (deltaPacketsReceived: number) => {
        const rtp = new MockInboundRtp(deltaPacketsReceived);

        rtp.remoteOutboundRtp = undefined;

        return rtp;
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        pair = mockPeerConnection.pairs[0]!;
        inboundRtp = mockPeerConnection.inboundRtps[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new BlockedInboundMediaDetector(mockPeerConnection as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('blocked-inbound-media-detector');
        });
    });

    describe('Raising', () => {
        it("raises once the far end's media has failed to arrive past the threshold", () => {
            ticks(5); // 10s of stats time

            const issues = mockClientMonitor.getIssuesByType('blocked-inbound-media-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.peerConnectionId).toBe('test-pc-id');
            expect(issues[0]!.payload.pathKind).toBe('direct');
        });

        it('does not raise before the threshold', () => {
            ticks(4); // 8s

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        /**
         * The false positive this detector exists to avoid. A peer that pauses stops
         * sending sender reports, and `getStats()` keeps serving its last one — which
         * still claims a healthy hundred packets. Reading that number without checking
         * that a report actually arrived accuses the network of a peer's own silence.
         */
        it('never raises on a frozen report from a peer that stopped talking', () => {
            inboundRtp.goesQuiet();
            expect(inboundRtp.remoteOutboundRtp!.deltaPacketsSent).toBe(100);

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            // Nothing live claimed to send, so there is nothing to contradict.
            expect(detector.inputsUnavailable).toBe(false);
        });

        /**
         * Sender reports arrive every few seconds against a shorter collecting period,
         * so most collections carry no fresh claim. The window accumulates through them
         * and needs only some live claim during it.
         */
        it('tolerates collections that carry no fresh report', () => {
            for (let i = 0; i < 5; ++i) {
                inboundRtp.remoteOutboundRtp!.deltaTime = i % 2 === 0 ? 2000 : 0;
                detector.update();
            }

            const [ issue ] = mockClientMonitor.getIssuesByType('blocked-inbound-media-transport');

            // Only the three collections that carried a live claim are counted.
            expect(issue?.payload.remotePacketsSent).toBe(300);
        });

        it('emits under the transport-suffixed event name', () => {
            ticks(5);

            expect(mockClientMonitor.emitted[0]!.name).toBe('blocked-inbound-media-transport');
        });

        // The issue dedupes on its key; the event does not.
        it('emits once, not once per tick', () => {
            ticks(30);

            expect(mockClientMonitor.emitted).toHaveLength(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('carries the window and what the far end claimed to send', () => {
            ticks(6);

            const [ issue ] = mockClientMonitor.getIssuesByType('blocked-inbound-media-transport');

            // Raised on the fifth tick, the first at which 10s of stats time had accrued;
            // the payload is the snapshot taken then, not whatever the window grew to.
            expect(issue?.payload.blockedForMs).toBe(10_000);
            expect(issue?.payload.remotePacketsSent).toBe(500);
        });

        it('sums what every remote sender claimed', () => {
            mockPeerConnection.inboundRtps = [
                new MockInboundRtp(0, new MockRemoteOutboundRtp(30)),
                new MockInboundRtp(0, new MockRemoteOutboundRtp(70)),
            ];

            ticks(5);

            const [ issue ] = mockClientMonitor.getIssuesByType('blocked-inbound-media-transport');

            expect(issue?.payload.remotePacketsSent).toBe(500);
        });

        // One stream arriving is enough to say the path carries media: a single silent
        // stream is that stream's problem, not the transport's.
        it('does not raise while any stream is getting through', () => {
            mockPeerConnection.inboundRtps = [
                new MockInboundRtp(0, new MockRemoteOutboundRtp(100)),
                new MockInboundRtp(90, new MockRemoteOutboundRtp(100)),
            ];

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        /**
         * Both sides of the comparison have to describe the same streams. A stream with
         * no linked report is not evidence either way, so it is left out of both sums —
         * not just out of the remote one, where its arriving packets would vouch for a
         * stream the far end reports on and we never saw.
         */
        it('leaves streams the far end does not report on out of both sums', () => {
            mockPeerConnection.inboundRtps = [
                new MockInboundRtp(0, new MockRemoteOutboundRtp(100)),
                unreportedStream(400), // arriving, but linked to no claim
            ];

            ticks(5);

            const issues = mockClientMonitor.getIssuesByType('blocked-inbound-media-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.remotePacketsSent).toBe(500);
        });

        it('resolves when media arrives again', () => {
            ticks(5);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            inboundRtp.deltaPacketsReceived = 90;
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('media is arriving again');
            expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
        });

        it('keys the issue per peer connection', () => {
            ticks(5);

            const [ issue ] = mockClientMonitor.getIssues();

            expect(issue!.key).toBe('blocked-inbound-media-transport-pc-test-pc-id');
        });
    });

    describe('Standing down', () => {
        it('returns early when disabled', () => {
            detector.disabled = true;

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('returns early on a closed connection', () => {
            mockPeerConnection.closed = true;

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing while no path has succeeded', () => {
            pair.state = 'in-progress';

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            // Nothing to judge is not the same as nothing to see with.
            expect(detector.inputsUnavailable).toBe(false);
        });

        /**
         * A path that answers no STUN carries nothing, and the reason is the path rather
         * than the media. `BlockedStunRequestsDetector` owns that finding, and this
         * detector must not raise a second one over the same cause.
         */
        it('stands down while the transport is blocked', () => {
            mockPeerConnection.blockedTransport = true;

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('hands an open finding over when the transport turns out to be blocked', () => {
            ticks(5);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.blockedTransport = true;
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('the transport is blocked');
        });

        // A send-only connection. Nothing negotiated to receive is nothing to judge —
        // and no local stats to hang a remote report off, either.
        it('raises nothing on a connection with no inbound streams', () => {
            mockPeerConnection.inboundRtps = [];

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(detector.inputsUnavailable).toBe(false);
        });

        /**
         * Our own silence proves nothing on its own: a paused producer, a muted speaker
         * and a middlebox all read the same in `inbound-rtp`. Only a live claim makes the
         * silence a disagreement.
         */
        it('raises nothing while a live report says the far end is not sending', () => {
            inboundRtp.remoteOutboundRtp!.deltaPacketsSent = 0;

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(detector.inputsUnavailable).toBe(false);
        });

        it('resolves an open finding once a live report says it stopped sending', () => {
            ticks(5);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            inboundRtp.remoteOutboundRtp!.deltaPacketsSent = 0;
            detector.update();

            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('the far end is not sending');
        });

        // A blocked path and a main thread too busy to collect on schedule are exactly
        // the pair that compounds: on wall-clock elapsed the second is counted as
        // evidence for the first.
        it("counts the connection's own time, not the time the collector was away", () => {
            jest.useFakeTimers();
            jest.setSystemTime(0);

            mockPeerConnection.deltaTime = 500;
            detector.update();

            jest.setSystemTime(60_000);
            ticks(4);

            // 2.5s of stats time against a minute of wall clock, under the 10s bar
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            jest.useRealTimers();
        });

        /**
         * Most ticks on a healthy connection have no window open, and there is nothing
         * for the teardown to tear down. Every call site tests `_blockedForInMs` first so
         * those ticks fall straight through.
         */
        it('never reaches for teardown while nothing is being tracked', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');
            inboundRtp.deltaPacketsReceived = 90;

            ticks(200);

            expect(clear).not.toHaveBeenCalled();
        });

        it('restarts the window after the media recovers', () => {
            ticks(4);
            inboundRtp.deltaPacketsReceived = 90;
            detector.update();

            inboundRtp.deltaPacketsReceived = 0;
            ticks(4); // 8s again, under the bar

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('can raise again after a recovery', () => {
            ticks(5);
            inboundRtp.deltaPacketsReceived = 90;
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            inboundRtp.deltaPacketsReceived = 0;
            ticks(5);

            expect(mockClientMonitor.getIssuesByType('blocked-inbound-media-transport')).toHaveLength(1);
            expect(mockClientMonitor.emitted).toHaveLength(2);
        });
    });

    describe('inputsUnavailable', () => {
        /**
         * The connection has streams to receive on, and not one of them carries a remote
         * report — so the verdict is unreachable rather than negative.
         */
        it('is set when no stream has a remote report at all', () => {
            inboundRtp.remoteOutboundRtp = undefined;

            ticks(30);

            expect(detector.inputsUnavailable).toBe(true);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('is not set when the report exists but has gone stale', () => {
            inboundRtp.goesQuiet();

            ticks(30);

            expect(detector.inputsUnavailable).toBe(false);
        });

        it('is not set when there is simply nothing to judge', () => {
            mockPeerConnection.inboundRtps = [];

            ticks(30);

            expect(detector.inputsUnavailable).toBe(false);
        });

        it('tears down an open window when the far end drops off entirely', () => {
            ticks(2);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');
            inboundRtp.remoteOutboundRtp = undefined;
            detector.update();

            expect(clear).toHaveBeenCalledTimes(1);
        });
    });
});
