import { ClientMonitor } from "../../src/ClientMonitor";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { StatsCollector } from "../../src/collectors/StatsCollector";
import { RtcStats } from "../../src/schema/W3cStatsIdentifiers";
/**
 * Snapshot of a `MediaStreamTrack`'s replay-relevant state, one per track per
 * entry, so track-level detectors (freezes, concealment, capture failures)
 * run during replay exactly as they did live. All fields except the three
 * identifying ones are optional — omitted fields keep their previous value.
 */
export type ReplayTrackState = {
	peerConnectionId: string;
	id: string;
	kind: 'audio' | 'video';
	muted?: boolean;
	enabled?: boolean;
	readyState?: 'live' | 'ended';
	/** The value of `track.getSettings()` at recording time. */
	settings?: Record<string, unknown>;
	label?: string;
};

/**
 * One recorded collection tick — the JSONL line format this harness consumes.
 * `peerConnections` is exactly the `collectedStats` payload of the monitor's
 * `'stats-collected'` event: `[peerConnectionId, rawGetStatsArray]` pairs.
 * How the lines are produced (server-side capture, a listener in an app, a
 * script synthesizing scenarios) is up to the producer; this type is the
 * whole contract.
 */
export type ReplayEntry = {
	/** Wall-clock time of the collection; drives the virtual clock on replay. */
	timestamp: number;
	peerConnections: [string, RtcStats[]][];
	tracks?: ReplayTrackState[];
};

/**
 * Test-side stats source: serves pre-recorded stats instead of querying a
 * live `RTCPeerConnection`. The replayer enqueues one batch per recorded
 * tick; when a tick has no data for this peer connection the last batch is
 * re-served, which the monitors treat as "no change".
 */
export class ReplayStatsCollector implements StatsCollector {
	public lastStats: RtcStats[] = [];
	private _queue: RtcStats[][] = [];

	public enqueue(stats: RtcStats[]): void {
		this._queue.push(stats);
	}

	public async getStats(): Promise<RtcStats[]> {
		const next = this._queue.shift();

		if (next) {
			this.lastStats = next;
		}

		return this.lastStats;
	}
}

/**
 * Stand-in for a `MediaStreamTrack` during replay. The monitors only read
 * `id`, `kind`, `muted`, `enabled`, `readyState`, `label`, `getSettings()`
 * and subscribe to `'ended'`, so a plain object suffices — including in Node.
 */
class ReplayMediaStreamTrack {
	public muted = false;
	public enabled = true;
	public readyState: 'live' | 'ended' = 'live';
	public label = '';
	private _settings: Record<string, unknown> = {};
	private readonly _endedListeners: (() => void)[] = [];

	public constructor(
		public readonly id: string,
		public readonly kind: 'audio' | 'video',
	) {}

	public getSettings() {
		return this._settings;
	}

	public addEventListener(type: string, listener: () => void) {
		if (type === 'ended') this._endedListeners.push(listener);
	}

	public removeEventListener() { /* replay tracks live for the whole replay */ }

	/** Applies a recorded state snapshot; fires `'ended'` on the transition. */
	public apply(state: ReplayTrackState) {
		this.muted = state.muted ?? this.muted;
		this.enabled = state.enabled ?? this.enabled;
		this.label = state.label ?? this.label;
		if (state.settings) this._settings = state.settings;

		const ending = state.readyState === 'ended' && this.readyState !== 'ended';

		this.readyState = state.readyState ?? this.readyState;

		if (ending) this._endedListeners.forEach((listener) => listener());
	}
}

/**
 * Sandbox harness that replays recorded stats through a `ClientMonitor`, so a
 * saved session can be re-run in a spec — against current or experimental
 * detector thresholds — and produces the same monitors, derived fields,
 * detector issues, events and samples the live run would have. Use it for
 * whatever the JSONL at hand calls for: investigating an issue locally,
 * developing a new detector against real data, or tuning detector configs.
 *
 * The input is JSONL: one {@link ReplayEntry} per line.
 *
 * **Virtual time.** Detectors judge durations with `Date.now()`, so replaying
 * faster than real time would break every threshold and window. By default the
 * replayer pins `Date.now` to each entry's recorded timestamp for the duration
 * of the replay — hours of recording replay in milliseconds while every
 * duration-based verdict stays faithful. The clock is restored when `replay()`
 * finishes (or `finish()` is called). Do not run other time-sensitive work on
 * the same event loop while a virtual-time replay is in progress.
 *
 * Create the monitor with `collectingPeriodInMs: 0` so no live collection
 * timer competes with the replay; add `bufferingEventsForSamples: true` and
 * call `createSample()` if samples are wanted.
 *
 * ```typescript
 * const monitor = new ClientMonitor({ collectingPeriodInMs: 0, bufferingEventsForSamples: true });
 * const replayer = new StatsReplayer(monitor);
 *
 * monitor.on('issue', (issue) => raised.push(issue.type));
 *
 * await replayer.replay(fs.readFileSync('session.jsonl', 'utf8').split('\n').filter(Boolean));
 * ```
 */
export class StatsReplayer {
	private readonly _collectors = new Map<string, ReplayStatsCollector>();
	private readonly _tracks = new Map<string, ReplayMediaStreamTrack>();
	private _originalNow?: typeof Date.now;

	public constructor(
		public readonly monitor: ClientMonitor,
		private readonly _options: { useVirtualTime?: boolean } = {},
	) {}

	/** Replays a full recording: an (async) iterable of JSONL lines or parsed entries. */
	public async replay(entries: Iterable<string | ReplayEntry> | AsyncIterable<string | ReplayEntry>): Promise<void> {
		try {
			for await (const entry of entries) {
				await this.replayEntry(typeof entry === 'string' ? JSON.parse(entry) as ReplayEntry : entry);
			}
		} finally {
			this.finish();
		}
	}

	public async replayLine(line: string): Promise<void> {
		if (!line.trim()) return;

		await this.replayEntry(JSON.parse(line) as ReplayEntry);
	}

	/** Feeds one recorded tick and runs a full collection round on it. */
	public async replayEntry(entry: ReplayEntry): Promise<void> {
		if (this._options.useVirtualTime !== false) {
			this._originalNow ??= Date.now;
			Date.now = () => entry.timestamp;
		}

		for (const [peerConnectionId, stats] of entry.peerConnections) {
			this._collectorFor(peerConnectionId).enqueue(stats);
		}

		for (const state of entry.tracks ?? []) {
			this._trackFor(state).apply(state);
		}

		await this.monitor.collect();
	}

	/** Restores the real clock. Called automatically at the end of `replay()`. */
	public finish(): void {
		if (this._originalNow) {
			Date.now = this._originalNow;
			this._originalNow = undefined;
		}
	}

	private _collectorFor(peerConnectionId: string): ReplayStatsCollector {
		let collector = this._collectors.get(peerConnectionId);

		if (!collector) {
			collector = new ReplayStatsCollector();
			this._collectors.set(peerConnectionId, collector);

			const pcMonitor = new PeerConnectionMonitor(
				peerConnectionId,
				collector,
				this.monitor,
				this.monitor.logger,
			);

			this.monitor.addPeerConnectionMonitor(pcMonitor);
		}

		return collector;
	}

	private _trackFor(state: ReplayTrackState): ReplayMediaStreamTrack {
		const key = `${state.peerConnectionId}:${state.id}`;
		let track = this._tracks.get(key);

		if (!track) {
			track = new ReplayMediaStreamTrack(state.id, state.kind);
			this._tracks.set(key, track);

			this.monitor.getPeerConnectionMonitor(state.peerConnectionId)
				?.addMediaStreamTrack(track as unknown as MediaStreamTrack);
		}

		return track;
	}
}
