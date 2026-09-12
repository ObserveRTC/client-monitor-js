/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { InboundRtpMonitor } from "../../src/monitors/InboundRtpMonitor";

/**
 * `InboundRtpMonitor` takes a report field by field rather than through
 * `Object.assign`, because `Object.assign` copies only what a report carries and
 * leaves everything else at its previous value. `getStats()` omits what it has
 * nothing to say about — `framesPerSecond` once frames stop being decoded, `qpSum`
 * on a codec that does not expose it — so under the old assignment those fields went
 * on describing an interval that had already passed, and every reader saw a healthy
 * last measurement for exactly as long as the trouble lasted.
 *
 * These specs pin the contract in both directions: an omitted member becomes
 * `undefined`, and a member that is present still lands.
 */
describe('InboundRtpMonitor stats assignment', () => {
    const report = (timestamp: number, extra: Record<string, unknown> = {}) => ({
        id: 'in-1',
        timestamp,
        ssrc: 1,
        kind: 'video',
        trackIdentifier: 'trk-1',
        ...extra,
    }) as any;

    /**
     * The monitor resolves its codec once per collection to put `qpSum` on that codec's scale, so
     * even a spec about field assignment needs a peer connection carrying the lookup maps.
     */
    const peerConnection = () => ({
        mappedCodecMonitors: new Map(),
        mappedMediaPlayoutMonitors: new Map(),
        mappedInboundTracks: new Map(),
    }) as any;

    const monitorWith = (extra: Record<string, unknown>) =>
        new InboundRtpMonitor(peerConnection(), report(1000, extra));

    it('drops a field the browser stopped reporting', () => {
        const monitor = monitorWith({ framesPerSecond: 30, qpSum: 100, framesDecoded: 30 });

        monitor.accept(report(2000, { framesPerSecond: 30, qpSum: 200, framesDecoded: 60 }));
        expect(monitor.framesPerSecond).toBe(30);
        expect(monitor.qpSum).toBe(200);

        // The picture stops. Chrome has nothing to say about a frame rate or a
        // quantizer, so it says nothing — which must not read as the last good value.
        monitor.accept(report(3000, { framesDecoded: 60 }));

        expect(monitor.framesPerSecond).toBeUndefined();
        expect(monitor.qpSum).toBeUndefined();
        expect(monitor.framesDecoded).toBe(60);
    });

    it('drops it on a report that carried no interval either', () => {
        const monitor = monitorWith({ framesPerSecond: 30 });

        // Same timestamp: nothing derived can be recomputed, but the fields still
        // take the report, so the monitor always holds the latest one seen.
        monitor.accept(report(1000, {}));

        expect(monitor.framesPerSecond).toBeUndefined();
        expect(monitor.deltaTime).toBeUndefined();
    });

    it('keeps carrying the fields a report does bring', () => {
        const monitor = monitorWith({ framesPerSecond: 30 });

        monitor.accept(report(2000, {
            framesPerSecond: 24,
            bytesReceived: 5000,
            decoderImplementation: 'libvpx',
            powerEfficientDecoder: true,
            attachments: { note: 'kept' },
        }));

        expect(monitor.framesPerSecond).toBe(24);
        expect(monitor.bytesReceived).toBe(5000);
        expect(monitor.decoderImplementation).toBe('libvpx');
        expect(monitor.powerEfficientDecoder).toBe(true);
        expect(monitor.attachments).toEqual({ note: 'kept' });
    });

    it('keeps the identity fields, which every report is required to carry', () => {
        const monitor = monitorWith({ framesPerSecond: 30 });

        monitor.accept(report(2000, {}));

        expect(monitor.id).toBe('in-1');
        expect(monitor.ssrc).toBe(1);
        expect(monitor.kind).toBe('video');
        expect(monitor.trackIdentifier).toBe('trk-1');
        expect(monitor.timestamp).toBe(2000);
    });

    /**
     * Inter-frame delay variation needs at least two rendered frames: one frame has
     * no spread to measure, and reporting `0` for it would read as a perfectly even
     * interval rather than as an unmeasurable one.
     */
    it('reports no inter-frame variation until two frames have been rendered', () => {
        const monitor = monitorWith({
            framesDecoded: 0, totalInterFrameDelay: 0, totalSquaredInterFrameDelay: 0,
        });

        monitor.accept(report(2000, {
            framesDecoded: 1, totalInterFrameDelay: 0.033, totalSquaredInterFrameDelay: 0.001089,
        }));
        expect(monitor.interFrameDelayVariation).toBeUndefined();
        expect(monitor.avgInterFrameDelayInMs).toBeUndefined();

        monitor.accept(report(3000, {
            framesDecoded: 31, totalInterFrameDelay: 1.033, totalSquaredInterFrameDelay: 0.034089,
        }));

        expect(monitor.interFrameDelayVariation).toBeDefined();
        expect(monitor.avgInterFrameDelayInMs).toBeCloseTo(33.3, 0);
    });

    it('never reports a negative spread on a perfectly even interval', () => {
        const monitor = monitorWith({
            framesDecoded: 0, totalInterFrameDelay: 0, totalSquaredInterFrameDelay: 0,
        });

        // 30 frames, every gap exactly 1/30s — the two sums are accumulated
        // independently, so the variance can land a hair below zero in floating point.
        monitor.accept(report(2000, {
            framesDecoded: 30,
            totalInterFrameDelay: 30 * (1 / 30),
            totalSquaredInterFrameDelay: 30 * (1 / 30) * (1 / 30),
        }));

        expect(monitor.interFrameDelayVariation).toBeGreaterThanOrEqual(0);
        expect(monitor.interFrameDelayVariation).toBeCloseTo(0);
    });

    /**
     * `totalFreezesDuration` is seconds by specification and the interval is seconds by
     * construction, so their ratio is the share of this collection the picture spent
     * stopped — the one measure of "was it running" that needs nothing declared by the
     * application, which is what lets `InboundVideoFlowStateDetector` judge without a frame rate.
     */
    describe('frozen time ratio', () => {
        const overTwoSeconds = (from: number, to: number) => {
            const monitor = monitorWith({ totalFreezesDuration: from });

            monitor.accept(report(3000, { totalFreezesDuration: to }));

            return monitor;
        };

        it('reports the share of the interval the picture was stopped', () => {
            // Two seconds of stats time, half a second of it frozen.
            expect(overTwoSeconds(0, 0.5).frozenTimeRatio).toBeCloseTo(0.25);
        });

        it('reports zero on an interval that never stopped', () => {
            expect(overTwoSeconds(1.5, 1.5).frozenTimeRatio).toBe(0);
        });

        /**
         * A freeze is credited entirely to the interval containing the frame that ends
         * it, so a stop spanning collections lands in one of them whole. Above 1 means
         * the picture was off for longer than this collection lasted, which is a true
         * statement rather than a broken ratio, and clamping it would erase the only
         * reading that says so.
         */
        it('goes above one where a stop outlasted the collection', () => {
            expect(overTwoSeconds(0, 5).frozenTimeRatio).toBeCloseTo(2.5);
        });

        it('says nothing where the browser does not report a freeze duration', () => {
            const monitor = monitorWith({ totalFreezesDuration: 0.5 });

            monitor.accept(report(3000, {}));

            expect(monitor.frozenTimeRatio).toBeUndefined();
        });

        it('says nothing on a report that spanned no time', () => {
            const monitor = monitorWith({ totalFreezesDuration: 0.5 });

            monitor.accept(report(1000, { totalFreezesDuration: 0.9 }));

            expect(monitor.frozenTimeRatio).toBeUndefined();
        });

        /**
         * The other half of the same split. The specification turns a freeze into a
         * *pause* once the gap passes five seconds, and the split is exclusive — past
         * that bar the freeze counters do not move at all — so a reader watching only
         * those is blind to precisely the longest outages.
         */
        it('reports pauses the same way, on their own counters', () => {
            const monitor = monitorWith({ totalPausesDuration: 0, pauseCount: 0, totalFreezesDuration: 0 });

            monitor.accept(report(3000, {
                totalPausesDuration: 1.5, pauseCount: 1, totalFreezesDuration: 0,
            }));

            expect(monitor.deltaPauseCount).toBe(1);
            expect(monitor.deltaTotalPausesDuration).toBeCloseTo(1.5);
            expect(monitor.pausedTimeRatio).toBeCloseTo(0.75);
            // ...and the freeze counters stay flat, which is the whole point. (Note
            // `0` and `undefined` are different answers here: the first is "nothing was
            // frozen", the second "the browser did not say".)
            expect(monitor.frozenTimeRatio).toBe(0);
        });
    });

    /**
     * The guard that matters most: a field added to the schema and forgotten here
     * would be silently unassignable, and the omission would look like a browser
     * that never reports it. Reading both lists is the only way to catch that.
     */
    it('assigns every field the schema declares, and invents none', () => {
        const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

        const schema = /export type InboundRtpStats = \{([\s\S]*?)\n\}/
            .exec(read('src/schema/ClientSample.ts'));
        const declared = new Set([ ...(schema?.[1] ?? '').matchAll(/^\s*(\w+)\??:/gm) ].map((m) => m[1]));

        const source = read('src/monitors/InboundRtpMonitor.ts');
        const body = /private _updateStats\([\s\S]*?\n\t\}/.exec(source);
        const assigned = new Set([ ...(body?.[0] ?? '').matchAll(/this\.(\w+) = stats\./g) ].map((m) => m[1]));

        expect([ ...declared ].filter((field) => !assigned.has(field))).toEqual([]);
        expect([ ...assigned ].filter((field) => !declared.has(field))).toEqual([]);
        expect(20 < declared.size).toBe(true);
    });

    it('takes the report through _updateStats and nothing else', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'src/monitors/InboundRtpMonitor.ts'), 'utf8',
        );
        const code = source.split('\n').filter((line) => !line.trimStart().startsWith('*')).join('\n');

        expect(code).not.toMatch(/Object\.assign\(this,/);
    });
});
