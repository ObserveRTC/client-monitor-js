import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { RemoteInboundRtpMonitor } from "../../src/monitors/RemoteInboundRtpMonitor";
import { RemoteOutboundRtpMonitor } from "../../src/monitors/RemoteOutboundRtpMonitor";

/**
 * `remote-inbound-rtp` and `remote-outbound-rtp` describe what the *far end* reported,
 * and they advance only when an RTCP report arrives. `getStats()` keeps serving the last
 * report in between, with its original `timestamp`, so a report that stopped coming is
 * indistinguishable from a fresh one unless the monitors say so.
 *
 * That matters because of `rtcp-mux`: RTCP shares the RTP five-tuple, so whatever drops
 * the media drops the reports about the media with it. A monitor that carried its last
 * interval delta forward would hand every reader a healthy-looking number for the whole
 * duration of a block — which is precisely backwards.
 *
 * The contract these specs pin: on a collection where the report did not advance,
 * `deltaTime` is `0` and every interval field is `undefined`. No measurement is better
 * than a stale one.
 */
describe('remote RTCP report staleness', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyPc = {} as any;

    describe('RemoteInboundRtpMonitor', () => {
        const monitorWithOneReport = () => {
            const monitor = new RemoteInboundRtpMonitor(anyPc, {
                id: 'ri', timestamp: 1000, ssrc: 1, kind: 'video',
                packetsReceived: 100, packetsLost: 1, totalRoundTripTime: 0.1, roundTripTimeMeasurements: 1,
            });

            monitor.accept({
                id: 'ri', timestamp: 2000, ssrc: 1, kind: 'video',
                packetsReceived: 200, packetsLost: 2, totalRoundTripTime: 0.2, roundTripTimeMeasurements: 2,
            });

            return monitor;
        };

        it('measures the interval when a new report arrives', () => {
            const monitor = monitorWithOneReport();

            expect(monitor.deltaTime).toBe(1000);
            expect(monitor.deltaPacketsReceived).toBe(100);
            expect(monitor.deltaPacketsLost).toBe(1);
            expect(monitor.avgRoundTripTimeInSec).toBeCloseTo(0.1);
            expect(monitor.packetRate).toBe(100);
        });

        it('reports no measurement at all once the reports stop', () => {
            const monitor = monitorWithOneReport();

            // The far end has gone silent. The entry is still in getStats(), frozen at
            // the report that did arrive — same timestamp, same counters.
            for (let i = 0; i < 10; ++i) {
                monitor.accept({
                    id: 'ri', timestamp: 2000, ssrc: 1, kind: 'video',
                    packetsReceived: 200, packetsLost: 2, totalRoundTripTime: 0.2, roundTripTimeMeasurements: 2,
                });
            }

            // Zero, not stale: the only reading that means "no report this collection".
            expect(monitor.deltaTime).toBe(0);
            expect(monitor.deltaPacketsReceived).toBeUndefined();
            expect(monitor.deltaPacketsLost).toBeUndefined();
            expect(monitor.deltaFractionLost).toBeUndefined();
            expect(monitor.deltaTotalRoundTripTime).toBeUndefined();
            expect(monitor.deltaRoundTripTimeMeasurements).toBeUndefined();
            expect(monitor.avgRoundTripTimeInSec).toBeUndefined();
            expect(monitor.packetRate).toBeUndefined();

            // The cumulative counters stay readable — they are still the last thing the
            // far end actually said, and callers can see how old that is.
            expect(monitor.packetsReceived).toBe(200);
        });

        it('measures again as soon as a report arrives', () => {
            const monitor = monitorWithOneReport();

            monitor.accept({ id: 'ri', timestamp: 2000, ssrc: 1, kind: 'video', packetsReceived: 200 });
            expect(monitor.deltaTime).toBe(0);

            monitor.accept({ id: 'ri', timestamp: 3000, ssrc: 1, kind: 'video', packetsReceived: 260 });

            expect(monitor.deltaTime).toBe(1000);
            expect(monitor.deltaPacketsReceived).toBe(60);
        });
    });

    describe('RemoteOutboundRtpMonitor', () => {
        const monitorWithOneReport = () => {
            const monitor = new RemoteOutboundRtpMonitor(anyPc, {
                id: 'ro', timestamp: 1000, ssrc: 1, kind: 'video', packetsSent: 100, bytesSent: 1000,
            });

            monitor.accept({
                id: 'ro', timestamp: 2000, ssrc: 1, kind: 'video', packetsSent: 200, bytesSent: 2000,
            });

            return monitor;
        };

        it('measures the interval when a new report arrives', () => {
            const monitor = monitorWithOneReport();

            expect(monitor.deltaTime).toBe(1000);
            expect(monitor.deltaPacketsSent).toBe(100);
            expect(monitor.deltaBytesSent).toBe(1000);
        });

        /**
         * The false positive this prevents: a peer that pauses stops sending sender
         * reports, and a carried-forward `deltaPacketsSent` would keep testifying that it
         * is still sending — accusing the network of the peer's own silence.
         */
        it('reports no measurement at all once the reports stop', () => {
            const monitor = monitorWithOneReport();

            for (let i = 0; i < 10; ++i) {
                monitor.accept({
                    id: 'ro', timestamp: 2000, ssrc: 1, kind: 'video', packetsSent: 200, bytesSent: 2000,
                });
            }

            expect(monitor.deltaTime).toBe(0);
            expect(monitor.deltaPacketsSent).toBeUndefined();
            expect(monitor.deltaBytesSent).toBeUndefined();
            expect(monitor.packetsSent).toBe(200);
        });

        it('measures again as soon as a report arrives', () => {
            const monitor = monitorWithOneReport();

            monitor.accept({ id: 'ro', timestamp: 2000, ssrc: 1, kind: 'video', packetsSent: 200 });
            expect(monitor.deltaTime).toBe(0);

            monitor.accept({ id: 'ro', timestamp: 3000, ssrc: 1, kind: 'video', packetsSent: 250 });

            expect(monitor.deltaTime).toBe(1000);
            expect(monitor.deltaPacketsSent).toBe(50);
        });
    });

    /**
     * The connection-level half of the same rule. The monitors above stop
     * reporting an interval once the reports stop; this is what the peer
     * connection does with that. It used to push `roundTripTime` into the average
     * on every collection regardless — so one measurement was re-counted for as
     * long as `getStats()` kept serving the report it came in, and the average and
     * its EWMA converged on a number nobody had measured recently.
     */
    describe('PeerConnectionMonitor.rtcpRttInSec', () => {
        const report = (timestamp: number, roundTripTime: number) => ([
            {
                type: 'remote-inbound-rtp', id: 'ri', timestamp, ssrc: 1, kind: 'video',
                localId: 'out-1', roundTripTime,
            },
        ]);

        const connection = () => {
            const clientMonitor = new ClientMonitor({
                collectingPeriodInMs: 0,
                samplingPeriodInMs: 0,
                integrateNavigatorMediaDevices: false,
                addClientJointEventOnCreated: false,
                addClientLeftEventOnClose: false,
            } as any);
            const pc = new PeerConnectionMonitor(
                'pc-1', { getStats: async () => [] } as any, clientMonitor, clientMonitor.logger,
            );

            clientMonitor.mappedPeerConnections.set('pc-1', pc);

            return { clientMonitor, pc };
        };

        it('counts a report from the collection that shows it advancing', () => {
            const { clientMonitor, pc } = connection();

            // The collection that first sees a report has no interval behind it —
            // the monitor is created from it and accepts it in the same breath, so
            // its `deltaTime` is `0`, the same reading a repeat gives. One collection
            // of patience is the price of never counting a repeat.
            pc.accept(report(1000, 0.3) as any);
            expect(pc.rtcpRttInSec).toBeUndefined();

            pc.accept(report(2000, 0.3) as any);
            expect(pc.rtcpRttInSec).toBeCloseTo(0.3);
            clientMonitor.close();
        });

        it('does not re-count a report that has not advanced', () => {
            const { clientMonitor, pc } = connection();

            pc.accept(report(1000, 0.3) as any);
            pc.accept(report(2000, 0.5) as any);
            expect(pc.rtcpRttInSec).toBeCloseTo(0.5);

            // The far end has gone quiet. `getStats()` keeps serving the 0.5 report,
            // and a monitor that re-averaged it would pull the smoothed value towards
            // a measurement that is now minutes old.
            const ewmaAfterTheLastRealReport = pc.ewmaRtcpRttInSec;

            for (let i = 0; i < 10; ++i) pc.accept(report(2000, 0.5) as any);

            expect(pc.ewmaRtcpRttInSec).toBe(ewmaAfterTheLastRealReport);
            clientMonitor.close();
        });
    });
});
