/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";

/**
 * `deltaVideoEncodeTimeInMs` is what `CpuPerformanceDetector` divides by wall time. Simulcast layers
 * of one media source are encoded in parallel, and may each carry the whole encode call's duration,
 * so summing them read a healthy machine as CPU limited (issue #73). One source contributes its
 * largest layer; separate sources still add.
 */
describe('video encode time per media source', () => {
	let monitor: ClientMonitor;
	let pc: PeerConnectionMonitor;

	beforeEach(() => {
		monitor = new ClientMonitor({
			collectingPeriodInMs: 0,
			samplingPeriodInMs: 0,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
		} as any);
		pc = new PeerConnectionMonitor('pc-1', { getStats: async () => [] } as any, monitor, monitor.logger);
		monitor.mappedPeerConnections.set('pc-1', pc);
	});

	afterEach(() => {
		monitor.close();
	});

	const collect = (timestamp: number, outboundRtps: Record<string, unknown>[]) => {
		pc.accept(outboundRtps.map((outboundRtp, index) => ({
			type: 'outbound-rtp',
			timestamp,
			kind: 'video',
			ssrc: 1000 + index,
			encoderImplementation: 'libvpx',
			...outboundRtp,
		})) as any);
	};

	/** Three layers of one camera, each reporting the given encode time for the second collection. */
	const simulcast = (mediaSourceId: string, prefix: string, deltasInSec: number[]) => deltasInSec.map((delta, index) => ({
		id: `${prefix}-${index}`,
		mediaSourceId,
		rid: `r${index}`,
		totalEncodeTime: delta,
	}));

	it('counts the simulcast layers of one source as its largest layer', () => {
		collect(1000, simulcast('source-camera', 'out', [0, 0, 0]));
		collect(2000, simulcast('source-camera', 'out', [0.05, 0.15, 0.3]));

		expect(pc.deltaVideoEncodeTimeInMs).toBeCloseTo(300);
	});

	it('still adds separate sources together', () => {
		collect(1000, [
			...simulcast('source-camera', 'cam', [0, 0, 0]),
			{ id: 'screen-0', mediaSourceId: 'source-screen', totalEncodeTime: 0 },
		]);
		collect(2000, [
			...simulcast('source-camera', 'cam', [0.05, 0.15, 0.3]),
			{ id: 'screen-0', mediaSourceId: 'source-screen', totalEncodeTime: 0.2 },
		]);

		expect(pc.deltaVideoEncodeTimeInMs).toBeCloseTo(500);
	});

	it('treats an outbound-rtp without a media source as a source of its own', () => {
		collect(1000, [{ id: 'a', totalEncodeTime: 0 }, { id: 'b', totalEncodeTime: 0 }]);
		collect(2000, [{ id: 'a', totalEncodeTime: 0.1 }, { id: 'b', totalEncodeTime: 0.2 }]);

		expect(pc.deltaVideoEncodeTimeInMs).toBeCloseTo(300);
	});

	it('leaves a hardware-encoded source out', () => {
		collect(1000, [
			{ id: 'sw', mediaSourceId: 'source-camera', totalEncodeTime: 0 },
			{ id: 'hw', mediaSourceId: 'source-screen', totalEncodeTime: 0, encoderImplementation: 'ExternalEncoder' },
		]);
		collect(2000, [
			{ id: 'sw', mediaSourceId: 'source-camera', totalEncodeTime: 0.1 },
			{ id: 'hw', mediaSourceId: 'source-screen', totalEncodeTime: 0.4, encoderImplementation: 'ExternalEncoder' },
		]);

		expect(pc.deltaVideoEncodeTimeInMs).toBeCloseTo(100);
	});

	it('stays undefined when no layer reported encode time', () => {
		collect(1000, [{ id: 'a', mediaSourceId: 'source-camera' }]);
		collect(2000, [{ id: 'a', mediaSourceId: 'source-camera' }]);

		expect(pc.deltaVideoEncodeTimeInMs).toBeUndefined();
	});
});
