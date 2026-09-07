import { ClientMonitor } from "../src/ClientMonitor";
import { ClientSample } from "../src/schema/ClientSample";
import { Logger } from "../src/utils/logger";

/**
 * What retention adds on top of the contract in
 * `SampleLossBeforeFirstSubscriber.spec.ts`: the early data arrives as the very
 * samples that were created for it, each still bounding its own time window,
 * rather than merged into one sample stamped when the consumer happened to
 * subscribe. The queue that holds them is bounded, and says so when it overflows.
 */

const silentLogger: Logger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function createRecordingLogger() {
	const errors: string[] = [];
	const warnings: string[] = [];
	const logger: Logger = {
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: (...args: unknown[]) => warnings.push(args.join(' ')),
		error: (...args: unknown[]) => errors.push(args.join(' ')),
	};

	return { logger, errors, warnings };
}

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

const TAG_PREFIX = 'test-tag:';

/** Creates one sample carrying a meta item that names it. */
function createTaggedSample(monitor: ClientMonitor, tag: string) {
	monitor.addMetaData({ type: `${TAG_PREFIX}${tag}` });

	return monitor.createSample();
}

/**
 * The tags of a sample, ignoring the meta items the monitor adds on its own
 * (the user agent data the constructor collects).
 */
function tagsOf(sample: ClientSample) {
	return (sample.clientMetaItems ?? [])
		.filter(item => item.type.startsWith(TAG_PREFIX))
		.map(item => item.type.slice(TAG_PREFIX.length));
}

describe('samples created before the first subscriber', () => {

	it('replays them in creation order, ahead of the samples created afterwards', () => {
		const monitor = createMonitor();

		createTaggedSample(monitor, 'first');
		createTaggedSample(monitor, 'second');

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		createTaggedSample(monitor, 'third');

		expect(received.map(tagsOf)).toEqual([['first'], ['second'], ['third']]);

		monitor.close();
	});

	it('keeps each sample separate instead of merging them into the first delivered one', () => {
		const monitor = createMonitor();

		const created = [
			createTaggedSample(monitor, 'first'),
			createTaggedSample(monitor, 'second'),
		];

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		// the replayed samples are the very objects created earlier, each still
		// bounding its own time window
		expect(received).toEqual(created);
		expect(received[0].timestamp).toBeLessThanOrEqual(received[1].timestamp);

		monitor.close();
	});

	it('does not replay a sample twice when a listener subscribes from inside its own handler', () => {
		const monitor = createMonitor();

		createTaggedSample(monitor, 'first');
		createTaggedSample(monitor, 'second');

		const received: string[][] = [];

		monitor.on('sample-created', ({ sample }) => {
			received.push(tagsOf(sample));
			monitor.on('sample-created', () => { /* re-entrant subscription */ });
		});

		expect(received).toEqual([['first'], ['second']]);

		monitor.close();
	});
});

describe('the retention queue bound', () => {
	it('keeps the newest samples and drops the oldest beyond the limit', () => {
		const monitor = createMonitor({ maxRetainedSamplesBeforeFirstSubscriber: 3 });

		for (const tag of ['first', 'second', 'third', 'fourth', 'fifth']) {
			createTaggedSample(monitor, tag);
		}

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		expect(received.map(tagsOf)).toEqual([['third'], ['fourth'], ['fifth']]);

		monitor.close();
	});

	it('logs an error naming how many samples were dropped', () => {
		const { logger, errors } = createRecordingLogger();
		const monitor = createMonitor({ logger, maxRetainedSamplesBeforeFirstSubscriber: 2 });
		const dropErrors = () => errors.filter(error => error.includes('Dropped'));

		createTaggedSample(monitor, 'first');
		createTaggedSample(monitor, 'second');

		expect(dropErrors()).toHaveLength(0);

		createTaggedSample(monitor, 'third');

		expect(dropErrors()).toHaveLength(1);
		expect(dropErrors()[0]).toContain('Dropped 1 sample(s)');

		createTaggedSample(monitor, 'fourth');

		// the count is cumulative, so the last message tells the whole story
		expect(dropErrors()[1]).toContain('Dropped 2 sample(s)');

		monitor.close();
	});

	it('discards every unconsumed sample when the limit is 0', () => {
		const monitor = createMonitor({ maxRetainedSamplesBeforeFirstSubscriber: 0 });

		createTaggedSample(monitor, 'first');

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		expect(received).toHaveLength(0);

		monitor.close();
	});
});

describe('closing without a subscriber', () => {
	it('warns about the samples that were never delivered', () => {
		const { logger, warnings } = createRecordingLogger();
		const monitor = createMonitor({ logger });

		createTaggedSample(monitor, 'first');
		monitor.close();

		expect(warnings.some(warning => warning.includes('never delivered'))).toBe(true);
	});

	it('still hands the retained samples to a consumer that subscribes after close', () => {
		const monitor = createMonitor();

		createTaggedSample(monitor, 'first');
		monitor.close();

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		// close() creates a last sample of its own, which is retained too
		expect(received.map(tagsOf)).toEqual([['first'], []]);
	});
});
