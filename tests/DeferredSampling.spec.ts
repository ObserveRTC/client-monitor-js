import { ClientMonitor } from "../src/ClientMonitor";
import { ClientSample } from "../src/schema/ClientSample";
import { Logger } from "../src/utils/logger";

/**
 * Sampling is deferred while no `'sample-created'` consumer exists: rather than
 * build a sample that reaches nobody and drains the four buffers into it, the
 * monitor creates nothing and lets the buffers accumulate. The first sample
 * created once a consumer subscribes carries everything since construction.
 *
 * `SampleLossBeforeFirstSubscriber.spec.ts` states what a late consumer must
 * receive, without saying how. This file covers what is specific to deferring:
 * that nothing is produced meanwhile, that the handover happens the moment a
 * consumer arrives, that the buffers are capped, and that a consumer present
 * from the start sees no difference at all.
 */

type LoggedLine = unknown[];

function createRecordingLogger(lines: LoggedLine[], level: 'error' | 'warn' = 'error'): Logger {
	const record = (...args: unknown[]) => lines.push(args);

	return {
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: level === 'warn' ? record : () => {},
		error: level === 'error' ? record : () => {},
	};
}

/**
 * Only the lines this file is about. A monitor constructed under a Node user
 * agent also logs a failure to parse it, which is none of our business here.
 */
function linesMatching(lines: LoggedLine[], needle: string) {
	return lines.map(line => line.join(' ')).filter(line => line.includes(needle));
}

const silentLogger: Logger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function createMonitor(config: Record<string, unknown> = {}) {
	return new ClientMonitor({
		logger: silentLogger,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
		watchTabVisibility: false,
		...config,
	});
}

function collect(monitor: ClientMonitor) {
	const received: ClientSample[] = [];

	monitor.on('sample-created', ({ sample }) => received.push(sample));

	return received;
}

function metaTypes(samples: ClientSample[]) {
	return samples.flatMap(sample => (sample.clientMetaItems ?? []).map(item => item.type));
}

describe('sampling deferred until the first consumer', () => {
	it('creates no sample at all while nobody is subscribed', () => {
		const monitor = createMonitor();

		monitor.addEvent({ type: 'EARLY_EVENT' });

		// nothing to hand a sample to, so none is built
		expect(monitor.createSample()).toBeUndefined();
		expect(monitor.createSample()).toBeUndefined();
		// ...and none was timestamped either
		expect(monitor.lastSampledAt).toBe(0);

		monitor.close();
	});

	it('hands the whole backlog to the first consumer the moment it subscribes', () => {
		const monitor = createMonitor();

		monitor.addEvent({ type: 'EARLY_EVENT' });
		monitor.addMetaData({ type: 'EARLY_META' });
		monitor.addIssue({ type: 'early-issue' });
		monitor.addExtensionStats({ type: 'EARLY_EXT' });
		monitor.createSample();

		const received = collect(monitor);

		// subscribing is itself the trigger: no further sampling was needed
		expect(received).toHaveLength(1);

		const sample = received[0];

		expect((sample?.clientEvents ?? []).map(event => event.type)).toContain('EARLY_EVENT');
		expect((sample?.clientMetaItems ?? []).map(item => item.type)).toEqual(
			expect.arrayContaining(['USER_AGENT_DATA', 'EARLY_META']),
		);
		expect((sample?.clientIssues ?? []).map(issue => issue.type)).toContain('early-issue');
		expect((sample?.extensionStats ?? []).map(stat => stat.type)).toContain('EARLY_EXT');

		monitor.close();
	});

	it('hands the backlog over through `addListener` as well as `on`', () => {
		const monitor = createMonitor();

		monitor.addMetaData({ type: 'EARLY_META' });
		monitor.createSample();

		const received: ClientSample[] = [];

		// `addListener` is an alias of `on` and must not bypass the handover
		monitor.addListener('sample-created', ({ sample }) => received.push(sample));

		expect(metaTypes(received)).toContain('EARLY_META');

		monitor.close();
	});

	it('produces nothing on subscribe when no sampling was ever asked for', () => {
		const monitor = createMonitor();

		monitor.addMetaData({ type: 'EARLY_META' });

		// no `createSample()` call was deferred, so there is nothing to hand over
		// and the buffers wait for the next ordinary sampling
		const received = collect(monitor);

		expect(received).toHaveLength(0);

		monitor.createSample();

		expect(metaTypes(received)).toContain('EARLY_META');

		monitor.close();
	});

	it('leaves a consumer that was there from the start entirely unaffected', () => {
		const monitor = createMonitor();
		const received = collect(monitor);

		monitor.addMetaData({ type: 'FIRST' });
		monitor.createSample();
		monitor.addMetaData({ type: 'SECOND' });
		monitor.createSample();

		// one sample per call, each draining only what was reported since the last
		expect(received).toHaveLength(2);
		expect((received[0]?.clientMetaItems ?? []).map(item => item.type)).toEqual(['USER_AGENT_DATA', 'FIRST']);
		expect((received[1]?.clientMetaItems ?? []).map(item => item.type)).toEqual(['SECOND']);
		expect(monitor.lastSampledAt).toBeGreaterThan(0);

		monitor.close();
	});

	it('goes back to ordinary sampling once a consumer has been seen, even if it detaches', () => {
		const monitor = createMonitor();
		const received: ClientSample[] = [];
		const listener = ({ sample }: { sample: ClientSample }) => received.push(sample);

		monitor.on('sample-created', listener);
		monitor.off('sample-created', listener);
		monitor.addMetaData({ type: 'AFTER_DETACH' });

		// the latch is one-way: a monitor that once had a consumer is back to the
		// plain behaviour of creating samples, rather than hoarding again
		expect(monitor.createSample()).toBeDefined();
		expect(received).toHaveLength(0);

		monitor.close();
	});

	it('delivers the backlog to a consumer that subscribes between samplings, in order', () => {
		const monitor = createMonitor();

		monitor.addMetaData({ type: 'BEFORE_ONE' });
		monitor.createSample();
		monitor.addMetaData({ type: 'BEFORE_TWO' });
		monitor.createSample();

		const received = collect(monitor);

		monitor.addMetaData({ type: 'AFTER' });
		monitor.createSample();

		// the two deferred samplings collapse into the single handover sample,
		// the third is an ordinary one — nothing is lost or reordered
		expect(received).toHaveLength(2);
		expect(metaTypes(received)).toEqual(['USER_AGENT_DATA', 'BEFORE_ONE', 'BEFORE_TWO', 'AFTER']);

		monitor.close();
	});
});

describe('the buffer cap that bounds a never-subscribed monitor', () => {
	it('drops the oldest entries and logs how many were lost', () => {
		const errors: LoggedLine[] = [];
		const monitor = createMonitor({ logger: createRecordingLogger(errors), maxBufferedSampleItems: 3 });

		// the constructor's USER_AGENT_DATA already occupies one slot
		for (const type of ['M1', 'M2', 'M3', 'M4']) monitor.addMetaData({ type });

		const received = collect(monitor);

		monitor.createSample();

		// oldest first: USER_AGENT_DATA and M1 are gone, the cap's worth remains
		expect(metaTypes(received)).toEqual(['M2', 'M3', 'M4']);

		// the first overflow is reported as it happens...
		const overflows = linesMatching(errors, 'buffer is full');

		expect(overflows).toHaveLength(1);
		expect(overflows[0]).toContain('clientMetaItems');

		// ...and the sample that is missing them names the full count
		const summary = linesMatching(errors, 'This sample is incomplete');

		expect(summary).toHaveLength(1);
		expect(summary[0]).toContain('dropped 2 from clientMetaItems');

		monitor.close();
	});

	it('caps each buffer on its own, so a flood of one kind cannot evict another', () => {
		const monitor = createMonitor({ maxBufferedSampleItems: 3 });

		for (let i = 0; i < 50; ++i) monitor.addExtensionStats({ type: `EXT_${i}` });

		const received = collect(monitor);

		monitor.createSample();

		// the extension stats overflowed, but the single meta item the constructor
		// collected — the whole point of deferring — is untouched
		expect(metaTypes(received)).toEqual(['USER_AGENT_DATA']);
		expect((received[0]?.extensionStats ?? []).map(stat => stat.type)).toEqual(['EXT_47', 'EXT_48', 'EXT_49']);

		monitor.close();
	});

	it('reports the running total once per buffer rather than once per dropped entry', () => {
		const errors: LoggedLine[] = [];
		const monitor = createMonitor({ logger: createRecordingLogger(errors), maxBufferedSampleItems: 2 });

		for (let i = 0; i < 100; ++i) monitor.addEvent({ type: `E_${i}` });

		// one error for the first overflow; the other 97 are held back by the
		// cooldown, so the log cannot become the flood it reports
		const overflows = linesMatching(errors, 'buffer is full');

		expect(overflows).toHaveLength(1);
		expect(overflows[0]).toContain('clientEvents');

		monitor.close();
	});
});

describe('closing a monitor that never had a consumer', () => {
	it('says so, naming what is discarded', () => {
		const warnings: LoggedLine[] = [];
		const monitor = createMonitor({ logger: createRecordingLogger(warnings, 'warn'), maxBufferedSampleItems: 10 });

		monitor.addMetaData({ type: 'NEVER_DELIVERED' });
		monitor.createSample();
		// `close()` samples once more, and that sampling is deferred too
		monitor.close();

		const discarded = linesMatching(warnings, "without ever having a 'sample-created' consumer");

		expect(discarded).toHaveLength(1);
		expect(discarded[0]).toContain('2 sampling(s) were deferred');
		// USER_AGENT_DATA and NEVER_DELIVERED, neither of which reached anyone
		expect(discarded[0]).toContain('2 buffered entries are discarded');
	});

	it('stays quiet when the backlog was handed over', () => {
		const warnings: LoggedLine[] = [];
		const monitor = createMonitor({ logger: createRecordingLogger(warnings, 'warn') });

		monitor.addMetaData({ type: 'DELIVERED' });
		monitor.createSample();

		const received = collect(monitor);

		expect(received).toHaveLength(1);

		monitor.close();

		expect(linesMatching(warnings, "without ever having a 'sample-created' consumer")).toHaveLength(0);
	});
});
