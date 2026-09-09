import { mockIssueRegistry } from "../helpers/detectorMocks";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { BlockedOutboundMediaDetector } from "../../src/detectors/BlockedOutboundMediaDetector";

interface TestIssue {
    id: string;
    type: string;
    key?: string;
    payload: Record<string, unknown>;
}

class MockClientMonitor {
    public config = {
        collectingPeriodInMs: 2000,
        blockedOutboundMediaDetector: {
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
 * The far end's report of what it received from us, over RTCP.
 *
 * `deltaTime` is the freshness: positive on a collection where a report actually
 * arrived, `0` where `getStats()` served the same frozen report again — which is what
 * a blocked path looks like, since rtcp-mux takes the reports down with the media.
 */
class MockRemoteInboundRtp {
    public constructor(
        public deltaTime: number | undefined = 2000,
        public deltaPacketsReceived: number | undefined = 100,
    ) {
    }
}

class MockOutboundRtp {
    public constructor(
        public deltaPacketsSent: number | undefined = 100,
        public remoteInboundRtp: MockRemoteInboundRtp | undefined = new MockRemoteInboundRtp(),
    ) {
    }

    getRemoteInboundRtp() {
        return this.remoteInboundRtp;
    }

    /** The far end has gone quiet about this sender: the report stops advancing. */
    goesQuiet() {
        if (this.remoteInboundRtp) this.remoteInboundRtp.deltaTime = 0;

        return this;
    }
}

class MockPeerConnectionMonitor {
    /**
     * This mock's own issue registry, created lazily so it does not depend on field order.
     * It routes back into the local client mock, leaving every existing assertion intact.
     */
    private _issues?: IssueRegistry;
    public get issues(): IssueRegistry {
        return this._issues ??= mockIssueRegistry(this.parent);
    }

    public peerConnectionId = 'test-pc-id';
    public parent = new MockClientMonitor();
    public closed = false;
    /** Every clock in this detector accumulates stats time, so the specs advance this. */
    public deltaTime: number | undefined = 2000;
    /** Maintained by `BlockedStunRequestsDetector`; this detector only reads it. */
    public blockedTransport = false;
    public pairs: MockCandidatePair[] = [ new MockCandidatePair() ];
    public outboundRtps: MockOutboundRtp[] = [ new MockOutboundRtp() ];

    public get selectedIceCandidatePairs() {
        return this.pairs;
    }
}

describe('BlockedOutboundMediaDetector', () => {
    let detector: BlockedOutboundMediaDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;
    let pair: MockCandidatePair;
    let outboundRtp: MockOutboundRtp;

    /** Runs `count` ticks, each describing `peerConnection.deltaTime` of stats time. */
    const ticks = (count: number) => {
        for (let i = 0; i < count; ++i) detector.update();
    };

    /**
     * A sender with no `remote-inbound-rtp` at all. Built by assignment rather than by
     * passing `undefined` to the constructor: an explicitly passed `undefined` still
     * takes the parameter default, which would quietly link a report here.
     */
    const unreportedSender = (deltaPacketsSent: number) => {
        const rtp = new MockOutboundRtp(deltaPacketsSent);

        rtp.remoteInboundRtp = undefined;

        return rtp;
    };

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        pair = mockPeerConnection.pairs[0]!;
        outboundRtp = mockPeerConnection.outboundRtps[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new BlockedOutboundMediaDetector(mockPeerConnection as any);
    });

    describe('Constructor', () => {
        it('should create detector with correct name', () => {
            expect(detector.name).toBe('blocked-outbound-media-detector');
        });
    });

    describe('Raising', () => {
        it('raises once the receiver reports have stopped past the threshold', () => {
            outboundRtp.goesQuiet();

            ticks(5); // 10s of stats time

            const issues = mockClientMonitor.getIssuesByType('blocked-outbound-media-transport');

            expect(issues).toHaveLength(1);
            expect(issues[0]!.payload.peerConnectionId).toBe('test-pc-id');
            expect(issues[0]!.payload.pathKind).toBe('direct');
        });

        it('does not raise before the threshold', () => {
            outboundRtp.goesQuiet();

            ticks(4); // 8s

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        /**
         * The whole reason this detector reads freshness rather than the packet count.
         * `getStats()` keeps serving the last receiver report after RTCP stops, and with
         * rtcp-mux RTCP stops with the media it describes — so the frozen report still
         * says a healthy hundred packets arrived. Judging that number would report
         * health for the entire duration of the block.
         */
        it('is not fooled by a frozen report still claiming healthy delivery', () => {
            outboundRtp.goesQuiet();
            expect(outboundRtp.remoteInboundRtp!.deltaPacketsReceived).toBe(100);

            ticks(5);

            expect(mockClientMonitor.getIssuesByType('blocked-outbound-media-transport')).toHaveLength(1);
        });

        /**
         * A path blocked from its first packet never produces a receiver report at all,
         * and that is the case worth catching — the user reloads into a firewalled
         * network, so there is no "it was working and then stopped" to lean on.
         */
        it('raises where a report never arrived in the first place', () => {
            mockPeerConnection.outboundRtps = [ unreportedSender(100) ];

            ticks(5);

            expect(mockClientMonitor.getIssuesByType('blocked-outbound-media-transport')).toHaveLength(1);
            // The far end's silence is a finding, never a blindness.
            expect(detector.inputsUnavailable).toBe(false);
        });

        it('emits under the transport-suffixed event name', () => {
            outboundRtp.goesQuiet();

            ticks(5);

            expect(mockClientMonitor.emitted[0]!.name).toBe('blocked-outbound-media-transport');
        });

        // The issue dedupes on its key; the event does not.
        it('emits once, not once per tick', () => {
            outboundRtp.goesQuiet();

            ticks(30);

            expect(mockClientMonitor.emitted).toHaveLength(1);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('carries the window and the unacknowledged packet count', () => {
            outboundRtp.goesQuiet();

            ticks(6);

            const [ issue ] = mockClientMonitor.getIssuesByType('blocked-outbound-media-transport');

            // Raised on the fifth tick, the first at which 10s of stats time had accrued;
            // the payload is the snapshot taken then, not whatever the window grew to.
            expect(issue?.payload.blockedForMs).toBe(10_000);
            expect(issue?.payload.packetsSent).toBe(500);
        });

        it('sums what every silenced sender put on the wire', () => {
            mockPeerConnection.outboundRtps = [
                new MockOutboundRtp(30).goesQuiet(),
                new MockOutboundRtp(70).goesQuiet(),
            ];

            ticks(5);

            const [ issue ] = mockClientMonitor.getIssuesByType('blocked-outbound-media-transport');

            expect(issue?.payload.packetsSent).toBe(500);
        });

        // One sender still hearing back is enough to say the path carries media both
        // ways: a single silent report is that stream's problem, not the transport's.
        it('does not raise while any sending sender still hears back', () => {
            mockPeerConnection.outboundRtps = [
                new MockOutboundRtp(100).goesQuiet(),
                new MockOutboundRtp(100),
            ];

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        /**
         * An idle sender says nothing about the path in either direction: its report is
         * not evidence of a block, and its arrival would not vouch for the senders that
         * are actually sending.
         */
        it('ignores an idle sender, whether its report arrives or not', () => {
            mockPeerConnection.outboundRtps = [
                new MockOutboundRtp(0),                     // idle, report still arriving
                new MockOutboundRtp(100).goesQuiet(),       // sending, gone silent
            ];

            ticks(5);

            expect(mockClientMonitor.getIssuesByType('blocked-outbound-media-transport')).toHaveLength(1);
        });

        it('resolves when the far end reports again', () => {
            outboundRtp.goesQuiet();
            ticks(5);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            outboundRtp.remoteInboundRtp!.deltaTime = 2000;
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('the far end is reporting again');
            expect(mockClientMonitor.resolvedIssues[0]!.payload.durationInMs).toBeDefined();
        });

        it('keys the issue per peer connection', () => {
            outboundRtp.goesQuiet();

            ticks(5);

            const [ issue ] = mockClientMonitor.getIssues();

            expect(issue!.key).toBe('blocked-outbound-media-transport-pc-test-pc-id');
        });
    });

    describe('Standing down', () => {
        it('returns early when disabled', () => {
            detector.disabled = true;
            outboundRtp.goesQuiet();

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('returns early on a closed connection', () => {
            mockPeerConnection.closed = true;
            outboundRtp.goesQuiet();

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('raises nothing while no path has succeeded', () => {
            pair.state = 'in-progress';
            outboundRtp.goesQuiet();

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
            outboundRtp.goesQuiet();

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('hands an open finding over when the transport turns out to be blocked', () => {
            outboundRtp.goesQuiet();
            ticks(5);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);

            mockPeerConnection.blockedTransport = true;
            detector.update();

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(mockClientMonitor.resolvedIssues[0]!.comment).toBe('the transport is blocked');
        });

        // A receive-only connection, or senders that are paused. Nothing went out, so
        // nothing coming back says nothing.
        it('raises nothing while no media is going out', () => {
            outboundRtp.deltaPacketsSent = 0;
            outboundRtp.goesQuiet();

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(detector.inputsUnavailable).toBe(false);
        });

        it('raises nothing on a connection with no senders at all', () => {
            mockPeerConnection.outboundRtps = [];

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
            expect(detector.inputsUnavailable).toBe(true);
        });

        /**
         * Without a STUN response somewhere in the window this is the path going away,
         * not a selective block — the ICE detectors own it. Consent runs every 4-6s
         * against a shorter collecting period, so the test is "at some point during the
         * window", never "this tick".
         */
        it('raises nothing while the path is answering no STUN', () => {
            pair.deltaResponsesReceived = 0;
            outboundRtp.goesQuiet();

            ticks(30);

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('accepts a window in which STUN answered only once', () => {
            outboundRtp.goesQuiet();

            for (let i = 0; i < 5; ++i) {
                pair.deltaResponsesReceived = i === 0 ? 1 : 0;
                detector.update();
            }

            expect(mockClientMonitor.getIssuesByType('blocked-outbound-media-transport')).toHaveLength(1);
        });

        // A blocked path and a main thread too busy to collect on schedule are exactly
        // the pair that compounds: on wall-clock elapsed the second is counted as
        // evidence for the first.
        it("counts the connection's own time, not the time the collector was away", () => {
            jest.useFakeTimers();
            jest.setSystemTime(0);

            outboundRtp.goesQuiet();
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

            ticks(200);

            expect(clear).not.toHaveBeenCalled();
        });

        it('restarts the window after the far end speaks again', () => {
            outboundRtp.goesQuiet();
            ticks(4);
            outboundRtp.remoteInboundRtp!.deltaTime = 2000;
            detector.update();

            outboundRtp.goesQuiet();
            ticks(4); // 8s again, under the bar

            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('can raise again after a recovery', () => {
            outboundRtp.goesQuiet();
            ticks(5);
            outboundRtp.remoteInboundRtp!.deltaTime = 2000;
            detector.update();
            expect(mockClientMonitor.getIssues()).toHaveLength(0);

            outboundRtp.goesQuiet();
            ticks(5);

            expect(mockClientMonitor.getIssuesByType('blocked-outbound-media-transport')).toHaveLength(1);
            expect(mockClientMonitor.emitted).toHaveLength(2);
        });
    });

    describe('inputsUnavailable', () => {
        // The one thing that actually blinds this detector: not being able to establish
        // that we are sending at all.
        it('is set when no sender exposes a packet count', () => {
            outboundRtp.deltaPacketsSent = undefined;

            ticks(30);

            expect(detector.inputsUnavailable).toBe(true);
            expect(mockClientMonitor.getIssues()).toHaveLength(0);
        });

        it('is not set when the far end is merely silent', () => {
            outboundRtp.goesQuiet();

            ticks(30);

            expect(detector.inputsUnavailable).toBe(false);
            expect(mockClientMonitor.getIssues()).toHaveLength(1);
        });

        it('is not set when there is simply nothing to judge', () => {
            outboundRtp.deltaPacketsSent = 0;

            ticks(30);

            expect(detector.inputsUnavailable).toBe(false);
        });

        it('tears down an open window when our own send counters go missing', () => {
            outboundRtp.goesQuiet();
            ticks(2);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clear = jest.spyOn(detector as any, '_clear');
            outboundRtp.deltaPacketsSent = undefined;
            detector.update();

            expect(clear).toHaveBeenCalledTimes(1);
        });
    });
});
