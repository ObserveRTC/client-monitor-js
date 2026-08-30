import { ClientMonitor } from "../src/ClientMonitor";

const silentLogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function createMonitor(config: Record<string, unknown> = {}) {
	return new ClientMonitor({
		logger: silentLogger,
		integrateNavigatorMediaDevices: false,
		addClientJointEventOnCreated: false,
		addClientLeftEventOnClose: false,
		...config,
	});
}

describe('ClientMonitor issue lifecycle in samples', () => {
	it('buffers a raise entry and a typed resolution entry', () => {
		const monitor = createMonitor();

		monitor.raiseIssue('stuck-decoder-track-a', {
			type: 'stuck-decoder',
			payload: { trackId: 'a', variant: 'assembly' },
		});
		monitor.resolveIssue('stuck-decoder-track-a', {
			comment: 'frames decoding',
			payload: { trackId: 'a', variant: 'assembly', durationInMs: 5000 },
		});

		const sample = monitor.createSample();
		const issues = sample?.clientIssues ?? [];

		expect(issues).toHaveLength(2);
		expect(issues[0]?.type).toBe('stuck-decoder');
		// both entries carry the schema-level key — the identity the server
		// opens and closes its mirror on
		expect(issues[0]?.key).toBe('stuck-decoder-track-a');

		const resolution = issues[1];

		expect(resolution?.type).toBe('stuck-decoder-resolved');
		expect(resolution?.key).toBe('stuck-decoder-track-a');

		// schema 3.5.0: the payload is a record, not a JSON string
		const payload = resolution?.payload as Record<string, unknown>;

		// secondary join for consumers that do not store keys
		expect(payload.raisedAt).toBe(issues[0]?.timestamp);
		expect(payload.comment).toBe('frames decoding');
		// only the explicitly passed resolution payload, flattened
		expect(payload.durationInMs).toBe(5000);
		expect(payload.variant).toBe('assembly');
		// the raise-time payload is not repeated as a nested object
		expect(payload.payload).toBeUndefined();

		monitor.close();
	});

	it('does not buffer resolutions when disabled', () => {
		const monitor = createMonitor({ sendResolvedIssuesToServer: false });

		monitor.raiseIssue('k', { type: 'congestion' });
		monitor.resolveIssue('k', { comment: 'over' });

		const issues = monitor.createSample()?.clientIssues ?? [];

		expect(issues).toHaveLength(1);
		expect(issues[0]?.type).toBe('congestion');
		// with lifecycle tracking off, the wire format is unchanged: no key
		expect(issues[0]?.key).toBeUndefined();

		monitor.close();
	});

	it('emits issue-resolved regardless of the sample buffering', () => {
		const monitor = createMonitor({ sendResolvedIssuesToServer: false });
		const resolved: unknown[] = [];

		monitor.on('issue-resolved', (issue) => resolved.push(issue));
		monitor.raiseIssue('k', { type: 'congestion' });
		monitor.resolveIssue('k', {});

		expect(resolved).toHaveLength(1);

		monitor.close();
	});

	it('keeps includeInSample=false issues out of the sample entirely', () => {
		const monitor = createMonitor();
		const seen: unknown[] = [];

		monitor.on('issue', (issue) => seen.push(issue));
		monitor.raiseIssue('local-only', {
			type: 'freezed-video-track',
			payload: { trackId: 'a' },
			includeInSample: false,
		});

		// the local lifecycle is unaffected
		expect(seen).toHaveLength(1);
		expect(monitor.isIssueActive('local-only')).toBe(true);

		monitor.resolveIssue('local-only', { comment: 'recovered' });

		// neither the raise nor the resolution reached the sample
		const issues = monitor.createSample()?.clientIssues ?? [];

		expect(issues).toHaveLength(0);

		monitor.close();
	});

	it('addIssue respects includeInSample=false while still emitting', () => {
		const monitor = createMonitor();
		const seen: unknown[] = [];

		monitor.on('issue', (issue) => seen.push(issue));
		monitor.addIssue({ type: 'custom-one-shot', includeInSample: false });

		expect(seen).toHaveLength(1);
		expect(monitor.createSample()?.clientIssues ?? []).toHaveLength(0);

		monitor.close();
	});

	it('a re-raise can flip includeInSample for later resolution buffering', () => {
		const monitor = createMonitor();

		monitor.raiseIssue('k', { type: 'congestion', includeInSample: true });
		monitor.raiseIssue('k', { type: 'congestion', includeInSample: false });
		monitor.resolveIssue('k', { comment: 'over' });

		const issues = monitor.createSample()?.clientIssues ?? [];

		// the raise was buffered before the flip; the resolution was not
		expect(issues).toHaveLength(1);
		expect(issues[0]?.type).toBe('congestion');

		monitor.close();
	});
});
