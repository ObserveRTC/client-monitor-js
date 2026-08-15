import * as fs from 'fs';
import * as path from 'path';
import { ClientMonitor } from '../../src/ClientMonitor';
import { ClientMonitorConfig } from '../../src/ClientMonitorConfig';
import { ClientIssue, ResolvedClientIssue } from '../../src/ClientMonitorEvents';
import { StatsReplayer } from './StatsReplayer';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures');

export type ReplayFixtureResult = {
	/** The monitor after the whole recording was replayed — inspect any monitor/track/derived field on it. */
	monitor: ClientMonitor;
	/** Every `'issue'` raised during the replay, in order, stamped with recorded (virtual) time. */
	issues: ClientIssue[];
	/** Every `'issue-resolved'` fired during the replay, in order. */
	resolvedIssues: ResolvedClientIssue[];
	/** Distinct issue types raised — convenient for "which detectors triggered" assertions. */
	issueTypes: Set<string>;
	/** Call when done asserting; closes the monitor. */
	close: () => void;
};

/**
 * Replays a recorded session (`tests/fixtures/<name>.jsonl` — one
 * `ReplayEntry` per line) through a fresh `ClientMonitor` and returns
 * everything the detectors did.
 *
 * Pass `config` overrides to investigate how different detector thresholds
 * would have judged the same session:
 *
 * ```typescript
 * const run = await replayFixture('stuck-decoder', {
 *     stuckDecoderDetector: { ...defaults, thresholdInMs: 30_000 },
 * });
 * expect(run.issueTypes.has('stuck-decoder')).toBe(false);
 * run.close();
 * ```
 */
export async function replayFixture(
	name: string,
	config: Partial<ClientMonitorConfig> = {},
): Promise<ReplayFixtureResult> {
	const file = path.join(FIXTURES_DIR, name.endsWith('.jsonl') ? name : `${name}.jsonl`);
	const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());

	const monitor = new ClientMonitor({
		logger: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
		collectingPeriodInMs: 0, // the replayer drives the ticks
		bufferingEventsForSamples: true,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
		...config,
	});

	const issues: ClientIssue[] = [];
	const resolvedIssues: ResolvedClientIssue[] = [];

	monitor.on('issue', (issue) => issues.push(issue));
	monitor.on('issue-resolved', (resolution) => resolvedIssues.push(resolution));

	const replayer = new StatsReplayer(monitor);

	await replayer.replay(lines);

	return {
		monitor,
		issues,
		resolvedIssues,
		issueTypes: new Set(issues.map((issue) => issue.type)),
		close: () => monitor.close(),
	};
}

/** Lists every `.jsonl` recording under `tests/fixtures/`. */
export function listFixtures(): string[] {
	if (!fs.existsSync(FIXTURES_DIR)) return [];

	return fs.readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('.jsonl'));
}
