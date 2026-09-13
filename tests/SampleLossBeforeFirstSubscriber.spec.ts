import { ClientMonitor } from "../src/ClientMonitor";
import { ClientSample } from "../src/schema/ClientSample";
import { Logger } from "../src/utils/logger";

/**
 * `createSample()` builds a sample, clears the four buffers it drained, and only
 * then emits `'sample-created'`. Before any listener subscribes that emit reaches
 * nobody, and nothing re-queues the sample — so everything reported between
 * construction and the first subscriber is lost.
 *
 * The disabled cases below describe what a consumer that subscribes late should
 * receive. They assert *what is delivered*, never how many samples carry it, so
 * they hold for any fix that stops discarding the data. A fix enables them.
 *
 * The one enabled case is the opposite: it passes today and locks in the
 * behaviour a fix must not disturb.
 */

const silentLogger: Logger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function createMonitor(config: Record<string, unknown> = {}) {
	return new ClientMonitor({
		logger: silentLogger,
		// The contract below is what this option buys; it is off by default.
		bufferClientSamplesUntilSubscriber: true,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
		watchTabVisibility: false,
		...config,
	});
}

const TAG_PREFIX = 'test-tag:';

function addTag(monitor: ClientMonitor, tag: string) {
	monitor.addMetaData({ type: `${TAG_PREFIX}${tag}` });
}

/** Everything tagged that reached the consumer, in delivery order. */
function deliveredTags(samples: ClientSample[]) {
	return samples.flatMap(sample =>
		(sample.clientMetaItems ?? [])
			.filter(item => item.type.startsWith(TAG_PREFIX))
			.map(item => item.type.slice(TAG_PREFIX.length))
	);
}

function deliveredMetaTypes(samples: ClientSample[]) {
	return samples.flatMap(sample => (sample.clientMetaItems ?? []).map(item => item.type));
}

function deliveredEventTypes(samples: ClientSample[]) {
	return samples.flatMap(sample => (sample.clientEvents ?? []).map(event => event.type));
}

function collect(monitor: ClientMonitor) {
	const received: ClientSample[] = [];

	monitor.on('sample-created', ({ sample }) => received.push(sample));

	return received;
}

describe('data reported before the first `sample-created` subscriber', () => {
	it('reaches a consumer that subscribes afterwards', () => {
		const monitor = createMonitor();

		addTag(monitor, 'first');
		monitor.createSample();

		const received = collect(monitor);

		expect(deliveredTags(received)).toContain('first');

		monitor.close();
	});

	it('includes client events, not only meta data', () => {
		const monitor = createMonitor();

		monitor.addEvent({ type: 'EARLY_EVENT' });
		monitor.createSample();

		const received = collect(monitor);

		expect(deliveredEventTypes(received)).toContain('EARLY_EVENT');

		monitor.close();
	});

	it('includes the user agent data the constructor collects', () => {
		// The clearest case: no caller is involved at all. The constructor calls
		// `fetchUserAgentData()`, so a consumer subscribing after the first
		// sampling tick never learns the browser it is running in.
		const monitor = createMonitor();

		monitor.createSample();

		const received = collect(monitor);

		expect(deliveredMetaTypes(received)).toContain('USER_AGENT_DATA');

		monitor.close();
	});

	it('keeps the order it was reported in', () => {
		const monitor = createMonitor();

		addTag(monitor, 'first');
		monitor.createSample();
		addTag(monitor, 'second');
		monitor.createSample();

		const received = collect(monitor);

		addTag(monitor, 'third');
		monitor.createSample();

		expect(deliveredTags(received)).toEqual(['first', 'second', 'third']);

		monitor.close();
	});

	it('is delivered once, however many consumers subscribe', () => {
		const monitor = createMonitor();

		addTag(monitor, 'first');
		monitor.createSample();

		const received = collect(monitor);
		const second: ClientSample[] = [];

		monitor.on('sample-created', ({ sample }) => second.push(sample));

		expect(deliveredTags(received)).toEqual(['first']);
		expect(deliveredTags(second)).toEqual([]);

		monitor.close();
	});

	it('reaches a consumer that subscribes through `once`', () => {
		const monitor = createMonitor();

		addTag(monitor, 'first');
		monitor.createSample();

		const received: ClientSample[] = [];

		monitor.once('sample-created', ({ sample }) => received.push(sample));

		expect(deliveredTags(received)).toContain('first');

		monitor.close();
	});

	it('reaches a consumer that subscribes through the `onsamplecreated` setter', () => {
		const monitor = createMonitor();

		addTag(monitor, 'first');
		monitor.createSample();

		const received: ClientSample[] = [];

		monitor.onsamplecreated = ({ sample }) => received.push(sample);

		expect(deliveredTags(received)).toContain('first');

		monitor.close();
	});
});

describe('a consumer subscribed from the start', () => {
	// Enabled: this passes today, and a fix for the cases above must not change
	// it. Nothing is withheld, replayed, or reordered for a consumer that was
	// always there.
	it('receives every sample once, in order, with nothing replayed', () => {
		const monitor = createMonitor();
		const received = collect(monitor);

		addTag(monitor, 'first');
		monitor.createSample();
		addTag(monitor, 'second');
		monitor.createSample();

		expect(received).toHaveLength(2);
		expect(deliveredTags(received)).toEqual(['first', 'second']);

		monitor.close();
	});
});
