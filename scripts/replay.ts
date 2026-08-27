/**
 * Replay CLI — runs a captured session through a `ClientMonitor` and prints
 * every detector fire as NDJSON, one JSON object per line.
 *
 *     npm run replay -- <stats.jsonl> [options]
 *
 * The input is the JSONL format described by `ReplayEntry` in
 * `tests/helpers/StatsReplayer.ts`: one captured collection tick per line.
 * Pass `-` to read the session from stdin.
 *
 * Everything written to stdout is NDJSON, so the output can be piped straight
 * into `jq`, a notebook, or a corpus runner that sweeps thresholds over many
 * sessions; progress, warnings and parse errors go to stderr. The records are:
 *
 *     {"record":"start","file":...,"config":{...}}
 *     {"record":"issue","at":...,"tick":...,"type":...,"key":...,"payload":{...}}
 *     {"record":"issue-resolved","at":...,"tick":...,"type":...,"key":...}
 *     {"record":"summary","ticks":...,"issues":{"<type>":<count>}}
 *
 * `at` is the issue's own wall-clock timestamp; `tick` and `tickTimestamp`
 * locate the captured collection it fired on, so a fire can be traced back to
 * the exact line of the input.
 *
 * The exit code is 0 whenever the replay ran to the end, whether or not
 * anything fired — a fire is data, not a failure. It is 1 on an unexpected
 * error and 2 on bad arguments.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ClientMonitor } from '../src/ClientMonitor';
import { ClientMonitorConfig } from '../src/ClientMonitorConfig';
import { ReplayEntry, StatsReplayer } from '../tests/helpers/StatsReplayer';

const USAGE = `Usage: npm run replay -- <stats.jsonl|-> [options]

Options:
  --config <path|json>  ClientMonitor config as a .json file path or inline
                        JSON. Shallow-merged over the replay defaults, so
                        '{"outboundFrameSupplyDetector":{ ... }}'
                        replaces that detector's whole config block.
  --only <a,b,c>        Report only these issue types.
  --updates             Also report 'issue-updated' (one record per tick per
                        active issue - noisy, off by default).
  --no-summary          Omit the trailing summary record.
  --real-time           Use the real clock instead of pinning Date.now() to
                        each tick's captured timestamp.
  --pretty              Human-readable lines instead of NDJSON.
  -h, --help            Show this help.
`;

/** Config the replay runs with unless --config overrides it. */
const REPLAY_DEFAULTS = {
	// The replayer drives the ticks; no live collection timer may compete.
	collectingPeriodInMs: 0,
	bufferingEventsForSamples: true,
	// Node has no navigator.mediaDevices, and the joined/left events would be
	// stamped with replay time rather than the session's.
	integrateNavigatorMediaDevices: false,
	addClientJointEventOnCreated: false,
	addClientLeftEventOnClose: false,
	// There is no tab to watch; without this the monitor warns on every replay.
	watchTabVisibility: false,
	// stdout is reserved for NDJSON, so the monitor's own logging goes to stderr.
	logger: {
		trace: () => { /* too noisy for a CLI */ },
		debug: () => { /* too noisy for a CLI */ },
		info: () => { /* too noisy for a CLI */ },
		warn: (...args: unknown[]) => process.stderr.write(`replay: monitor warn: ${args.join(' ')}\n`),
		error: (...args: unknown[]) => process.stderr.write(`replay: monitor error: ${args.join(' ')}\n`),
	},
};

/** The fields this CLI reads off an issue, across all three issue events. */
type AnyIssue = {
	type: string;
	key?: string;
	payload?: unknown;
	timestamp?: number;
	raisedAt?: number;
	updatedAt?: number;
	resolvedAt?: number;
};

type Options = {
	file: string;
	config: Record<string, unknown>;
	only?: Set<string>;
	updates: boolean;
	summary: boolean;
	virtualTime: boolean;
	pretty: boolean;
};

function fail(message: string): never {
	process.stderr.write(`replay: ${message}\n\n${USAGE}`);
	process.exit(2);
}

function parseConfig(value: string): Record<string, unknown> {
	const raw = value.trim().startsWith('{') ? value : readFileSync(value, 'utf8');
	const parsed: unknown = JSON.parse(raw);

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		fail('--config must be a JSON object');
	}

	return parsed as Record<string, unknown>;
}

function parseArgs(argv: string[]): Options {
	const options: Options = {
		file: '',
		config: {},
		updates: false,
		summary: true,
		virtualTime: true,
		pretty: false,
	};

	for (let i = 0; i < argv.length; ++i) {
		const arg = argv[i] ?? '';

		switch (arg) {
			case '-h':
			case '--help':
				process.stdout.write(USAGE);
				process.exit(0);
				break;
			case '--config':
				options.config = parseConfig(argv[++i] ?? fail('--config needs a value'));
				break;
			case '--only':
				options.only = new Set(
					(argv[++i] ?? fail('--only needs a value')).split(',').map((type) => type.trim()).filter(Boolean),
				);
				break;
			case '--updates':
				options.updates = true;
				break;
			case '--no-summary':
				options.summary = false;
				break;
			case '--real-time':
				options.virtualTime = false;
				break;
			case '--pretty':
				options.pretty = true;
				break;
			default:
				if (arg !== '-' && arg.startsWith('-')) fail(`unknown option ${arg}`);
				if (options.file) fail('more than one input given');
				options.file = arg;
		}
	}

	if (!options.file) fail('no input given');

	return options;
}

async function* readLines(file: string): AsyncGenerator<string> {
	const input = file === '-' ? process.stdin : createReadStream(file);

	for await (const line of createInterface({ input, crlfDelay: Infinity })) {
		yield line;
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));

	if (options.file !== '-' && !existsSync(options.file)) fail(`no such file: ${options.file}`);

	const config = { ...REPLAY_DEFAULTS, ...options.config } as ClientMonitorConfig;
	const monitor = new ClientMonitor(config);
	const replayer = new StatsReplayer(monitor, { useVirtualTime: options.virtualTime });
	const counts = new Map<string, number>();

	let tick = 0;
	let tickTimestamp = 0;
	let firstTimestamp: number | undefined;
	let malformedLines = 0;
	let teardown = false;

	const emit = (record: Record<string, unknown>) => {
		if (!options.pretty || typeof record.tick !== 'number') {
			process.stdout.write(`${JSON.stringify(record)}\n`);

			return;
		}

		process.stdout.write(
			`[tick ${record.tick} @ ${record.at}] ${String(record.record)} ${String(record.type ?? '')} ` +
			`${JSON.stringify(record.payload ?? {})}\n`,
		);
	};

	const report = (record: string, issue: AnyIssue) => {
		if (options.only && !options.only.has(issue.type)) return;
		if (record === 'issue') counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);

		emit({
			record,
			at: issue.resolvedAt ?? issue.updatedAt ?? issue.timestamp ?? tickTimestamp,
			tick,
			tickTimestamp,
			type: issue.type,
			key: issue.key,
			payload: issue.payload,
			// Set on the resolutions `monitor.close()` emits for issues that
			// were still active when the session ended — an artefact of the
			// replay stopping, not something the session did.
			teardown: teardown || undefined,
		});
	};

	monitor.on('issue', (issue) => report('issue', issue as unknown as AnyIssue));
	monitor.on('issue-resolved', (issue) => report('issue-resolved', issue as unknown as AnyIssue));

	if (options.updates) {
		monitor.on('issue-updated', (issue) => report('issue-updated', issue as unknown as AnyIssue));
	}

	// `logger` holds functions, which JSON drops to an empty object — the
	// effective thresholds are what a corpus run needs to record, not the sink.
	const reportedConfig: Record<string, unknown> = { ...(config as Record<string, unknown>) };

	delete reportedConfig.logger;

	emit({ record: 'start', file: options.file, config: reportedConfig });

	try {
		for await (const line of readLines(options.file)) {
			if (!line.trim()) continue;

			let entry: ReplayEntry;

			try {
				entry = JSON.parse(line) as ReplayEntry;
			} catch {
				++malformedLines;
				process.stderr.write(`replay: skipping unparseable line ${tick + malformedLines}\n`);
				continue;
			}

			++tick;
			tickTimestamp = entry.timestamp;
			firstTimestamp ??= entry.timestamp;

			await replayer.replayEntry(entry);
		}
	} finally {
		// Closed before the clock is restored, so the resolutions `close()`
		// emits are stamped in the session's timeline rather than today's.
		teardown = true;
		monitor.close();
		replayer.finish();
	}

	if (options.summary) {
		emit({
			record: 'summary',
			ticks: tick,
			malformedLines,
			firstTimestamp,
			lastTimestamp: firstTimestamp === undefined ? undefined : tickTimestamp,
			sessionDurationInMs: firstTimestamp === undefined ? 0 : tickTimestamp - firstTimestamp,
			issues: Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1])),
		});
	}
}

main().catch((err) => {
	process.stderr.write(`replay: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
	process.exit(1);
});
