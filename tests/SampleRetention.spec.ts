import { ClientMonitor } from "../src/ClientMonitor";
import { ClientSample } from "../src/schema/ClientSample";
import { Logger } from "../src/utils/logger";

/**
 * What buffering adds on top of the contract in
 * `SampleLossBeforeFirstSubscriber.spec.ts`: the early data arrives as the very
 * samples that were created for it, each still bounding its own time window,
 * rather than merged into one sample stamped when the consumer happened to
 * subscribe.
 *
 * `bufferClientSamplesUntilSubscriber` is opt-in, so every monitor here states
 * it; the cases that leave it off are the ones pinning that the default
 * discards, exactly as it always did.
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
		bufferClientSamplesUntilSubscriber: true,
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

describe('the buffer', () => {
	/**
	 * Deliberately unbounded. Buffering is opt-in, so enabling it is the
	 * application taking on the retained samples and what they cost; a bound
	 * would silently drop the very samples the option exists to keep.
	 */
	it('holds every sample, however many are created before a subscriber', () => {
		const monitor = createMonitor();
		const tags = Array.from({ length: 200 }, (_, index) => `sample-${index}`);

		for (const tag of tags) createTaggedSample(monitor, tag);

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		expect(received.map(tagsOf)).toEqual(tags.map(tag => [ tag ]));

		monitor.close();
	});

	it('never logs a dropped-sample error, however long nobody subscribes', () => {
		const { logger, errors } = createRecordingLogger();
		const monitor = createMonitor({ logger });

		for (let index = 0; index < 100; ++index) createTaggedSample(monitor, `sample-${index}`);

		// Only sample losses: the constructor logs its own errors in this environment.
		expect(errors.filter(error => /drop/i.test(error))).toHaveLength(0);

		monitor.close();
	});

	/** The default: sample events are not expected to be consumed, so nothing waits. */
	it('discards every unconsumed sample while buffering is off', () => {
		const monitor = createMonitor({ bufferClientSamplesUntilSubscriber: false });

		createTaggedSample(monitor, 'first');

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		expect(received).toHaveLength(0);

		monitor.close();
	});

	/**
	 * "Until the first subscriber" is literal: the buffer is dropped once one
	 * drains it, so a consumer that later detaches leaves the monitor emitting
	 * to nobody rather than quietly refilling an unbounded array.
	 */
	it('does not buffer again once a subscriber has come and gone', () => {
		const monitor = createMonitor();
		const first = () => { /* the first subscriber, which ends buffering */ };

		createTaggedSample(monitor, 'before');
		monitor.on('sample-created', first);
		monitor.off('sample-created', first);

		createTaggedSample(monitor, 'after');

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		expect(received).toHaveLength(0);

		monitor.close();
	});

	it('is off unless the application asks for it', () => {
		const monitor = new ClientMonitor({
			logger: silentLogger,
			integrateNavigatorMediaDevices: false,
			addClientJointEventOnCreated: false,
			addClientLeftEventOnClose: false,
			watchTabVisibility: false,
		});

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

	/**
	 * The buffer is released at close rather than held for a subscriber that may
	 * never come: the monitor is done, the warning above has already said what
	 * was never delivered, and an unbounded buffer should not outlive the thing
	 * that filled it.
	 */
	it('releases the buffered samples rather than holding them past close', () => {
		const monitor = createMonitor();

		createTaggedSample(monitor, 'first');
		monitor.close();

		const received: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => received.push(sample));

		expect(received).toHaveLength(0);
	});
});
