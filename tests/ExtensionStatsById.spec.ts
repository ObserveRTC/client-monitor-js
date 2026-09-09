/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from "../src/ClientMonitor";

/**
 * Reporting an application metric under an `id` makes it readable back off the monitor. This
 * covers what that store guarantees: that it holds the latest value, that it is independent of
 * whether samples are being produced, and how long a value stays readable once it stops arriving.
 */
const silentLogger = {
	trace() { /* quiet */ },
	debug() { /* quiet */ },
	info() { /* quiet */ },
	warn() { /* quiet */ },
	error() { /* quiet */ },
} as any;

function createMonitor(overrides: Record<string, unknown> = {}) {
	return new ClientMonitor({
		logger: silentLogger,
		collectingPeriodInMs: 0,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
		bufferingEventsForSamples: true,
		...overrides,
	} as any);
}

/** One collection cycle, which is also what ages the store. */
const collect = (monitor: ClientMonitor) => (monitor as any).collect();

describe('extension stats by id', () => {
	describe('reading a value back', () => {
		it('returns the payload reported under that id', async () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { fps: 30 } });

			expect(monitor.getExtensionStatsPayload('a')).toEqual({ fps: 30 });
			monitor.close();
		});

		it('returns undefined for an id that was never reported', () => {
			const monitor = createMonitor();

			expect(monitor.getExtensionStatsPayload('nobody')).toBeUndefined();
			monitor.close();
		});

		it('keeps the latest value, not a history', () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { fps: 30 } });
			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { fps: 12 } });

			expect(monitor.getExtensionStatsPayload('a')).toEqual({ fps: 12 });
			monitor.close();
		});

		it('keeps ids apart', () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 1 } });
			monitor.addExtensionStats({ type: 'my-metric', id: 'b', payload: { n: 2 } });

			expect(monitor.getExtensionStatsPayload('a')).toEqual({ n: 1 });
			expect(monitor.getExtensionStatsPayload('b')).toEqual({ n: 2 });
			monitor.close();
		});

		it('stores nothing for a stat reported without an id', () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', payload: { n: 1 } });

			// The id is what turns a reported value into readable state; without one it is
			// buffered into the sample and forgotten.
			expect((monitor as any).mappedExtensionStatsMonitors.size).toBe(0);
			monitor.close();
		});

		it('carries the type and the time it last arrived', async () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 1 } });

			const first = monitor.getExtensionStatsMonitor('a')!.timestamp;

			expect(monitor.getExtensionStatsMonitor('a')?.type).toBe('my-metric');

			await new Promise(resolve => setTimeout(resolve, 20));
			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 2 } });

			// The stamp is when the payload arrived, not when the id was first seen.
			expect(monitor.getExtensionStatsMonitor('a')!.timestamp).toBeGreaterThan(first);
			monitor.close();
		});
	});

	describe('independence from sampling', () => {
		it('stores the value even when nothing is being sampled or buffered', () => {
			const monitor = createMonitor({ bufferingEventsForSamples: false });

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 1 } });

			// Reading your own metrics back has nothing to do with whether samples are produced.
			expect(monitor.getExtensionStatsPayload('a')).toEqual({ n: 1 });
			monitor.close();
		});

		it('still buffers into the sample when buffering is on', () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 1 } });

			expect((monitor as any)._extensionStats).toHaveLength(1);
			monitor.close();
		});
	});

	describe('how long a value stays readable', () => {
		it('survives the collection after the one it was reported in', async () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 1 } });
			await collect(monitor);

			expect(monitor.getExtensionStatsPayload('a')).toEqual({ n: 1 });
			monitor.close();
		});

		it('expires once a collection passes without it being reported again', async () => {
			const monitor = createMonitor();

			monitor.addExtensionStats({ type: 'my-metric', id: 'a', payload: { n: 1 } });
			await collect(monitor);
			await collect(monitor);

			expect(monitor.getExtensionStatsPayload('a')).toBeUndefined();
			monitor.close();
		});

		it('never expires while a provider keeps reporting it', async () => {
			const monitor = createMonitor();

			monitor.extensionStatsProviders.add(() => ({
				type: 'my-metric',
				id: 'a',
				payload: { n: 1 },
			}));

			for (let i = 0; i < 4; ++i) await collect(monitor);

			// Providers run every collection, so a provider-backed id is readable for the call.
			expect(monitor.getExtensionStatsPayload('a')).toEqual({ n: 1 });
			monitor.close();
		});
	});
});
