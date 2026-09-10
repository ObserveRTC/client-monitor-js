import { IssueRegistry, IssueRegistrySink } from "../../src/utils/IssueRegistry";
import { SliceConfig, SlicedWindow } from "../../src/utils/SlicedWindow";
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The subset of an inbound track's totals these mocks feed. */
type MockWindowValues = {
	totalFramesReceived: number | null;
	totalFramesRendered: number | null;
	totalFramesDecoded: number | null;
	totalFreezeCount: number | null;
	totalFreezesDurationInMs: number | null;
}

const MOCK_WINDOW_VALUES: MockWindowValues = {
	totalFramesReceived: null,
	totalFramesRendered: null,
	totalFramesDecoded: null,
	totalFreezeCount: null,
	totalFreezesDurationInMs: null,
};

/**
 * Minimal stand-ins for the monitor hierarchy, shared by the detector specs.
 *
 * They implement only what a detector actually reaches for — the issue
 * lifecycle, the event emitter, and the getters used to walk from a track to
 * its RTP stats — so a spec can hand a detector a plausible world without
 * constructing a real `ClientMonitor` and a real `RTCPeerConnection`.
 */

export type TestIssue = {
	/** Absent for a fire-and-forget `addIssue`, which has no identity to resolve on. */
	key?: string;
	type: string;
	payload: Record<string, unknown>;
	raisedAt: number;
	updatedAt: number;
};

export type TestResolvedIssue = TestIssue & {
	resolvedAt: number;
	comment?: string;
};

export type TestClientEvent = {
	type: string;
	payload?: Record<string, unknown>;
	timestamp: number;
};

export class MockClientMonitor {
	public config: Record<string, any> = {};
	public activeTab = true;
	/** What the assertions read: where the registry's sink lands. */
	private readonly _store = new Map<string, TestIssue>();

	/**
	 * The terminal registry, as the real `ClientMonitor` owns it. Per-monitor registries uplink
	 * into `activeIssues.asSink`, and a real monitor built on this mock finds the same thing
	 * there that it would on the real client.
	 */
	public readonly activeIssues: IssueRegistry = new IssueRegistry({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		notify: (issue: any) => { this.addIssue(issue); },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		raise: (issue: any) => { this.raiseIssue(issue.key, issue); },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		update: (issue: any) => { this.raiseIssue(issue.key, issue); },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		resolve: (issue: any) => { this.resolveIssue(issue.key, issue); },
	});
	public readonly raisedIssues: TestIssue[] = [];
	public readonly resolvedIssues: TestResolvedIssue[] = [];
	public readonly events: TestClientEvent[] = [];
	public readonly emitted: { name: string, payload: any }[] = [];

	private _handlers: Record<string, ((payload: any) => void)[]> = {};

	public lastCollectingStatsAt = 0;
	public durationOfCollectingStatsInMs = 0;
	public outboundRtps: any[] = [];
	public inboundRtps: any[] = [];
	public cpuPerformanceAlertOn = false;

	public emit(name: string, payload?: any) {
		this.emitted.push({ name, payload });
		(this._handlers[name] ?? []).forEach((handler) => handler(payload));
	}

	public on(name: string, handler: (payload: any) => void) {
		(this._handlers[name] ??= []).push(handler);

		return this;
	}

	public addEvent(event: { type: string, payload?: Record<string, unknown>, timestamp?: number }) {
		this.events.push({
			type: event.type,
			payload: event.payload,
			timestamp: event.timestamp ?? Date.now(),
		});
	}

	/**
	 * The fire-and-forget counterpart of `raiseIssue`: reported, buffered, and never
	 * entered into `activeIssues`, because there is no condition that could later be
	 * found resolved. `raisedIssues` collects both kinds, so assertions about what a
	 * detector reported read the same either way; `getIssues()` is what separates
	 * them, and it must never grow an entry from here.
	 */
	public addIssue(input: { type: string, payload?: Record<string, unknown>, timestamp?: number }) {
		const issue: TestIssue = {
			key: undefined,
			type: input.type,
			payload: input.payload ?? {},
			raisedAt: input.timestamp ?? Date.now(),
			updatedAt: input.timestamp ?? Date.now(),
		};

		this.raisedIssues.push(issue);
		this.emit('issue', issue);

		return issue;
	}

	public raiseIssue(key: string, input: { type: string, payload?: Record<string, unknown> }) {
		const now = Date.now();
		const existing = this._store.get(key);

		if (existing) {
			existing.payload = input.payload ?? {};
			existing.updatedAt = now;
			this.emit('issue-updated', existing);

			return existing;
		}

		const issue: TestIssue = {
			key,
			type: input.type,
			payload: input.payload ?? {},
			raisedAt: now,
			updatedAt: now,
		};

		this._store.set(key, issue);
		this.raisedIssues.push(issue);
		this.emit('issue', issue);

		return issue;
	}

	/**
	 * What a per-monitor registry forwards into: this mock's terminal registry, seen as a sink —
	 * exactly the wiring the real monitors use. Its own sink lands in `_store`, so every existing
	 * assertion about `activeIssues`, `raisedIssues` and `resolvedIssues` keeps reading the same.
	 */
	public get issueUplink(): IssueRegistrySink {
		return this.activeIssues.asSink;
	}

	public resolveIssue(key: string, opts?: { comment?: string, payload?: Record<string, unknown>, resolvedAt?: number }) {
		const found = this._store.get(key);

		if (!found) return undefined;

		this._store.delete(key);

		const resolved: TestResolvedIssue = {
			...found,
			payload: opts?.payload ?? found.payload,
			resolvedAt: opts?.resolvedAt ?? Date.now(),
			comment: opts?.comment,
		};

		this.resolvedIssues.push(resolved);
		this.emit('issue-resolved', resolved);

		return resolved;
	}

	/** Issues currently active, as an array. */
	public getIssues() {
		return [...this._store.values()];
	}

	public isIssueActive(key: string) {
		return this._store.has(key);
	}

	/** The last issue raised with the given type, if any. */
	public issueOfType(type: string) {
		return this.raisedIssues.filter((issue) => issue.type === type).pop();
	}

	/** Monitor events emitted under the given name. */
	public emittedOf(name: string) {
		return this.emitted.filter((entry) => entry.name === name);
	}

	/** Client events buffered with the given type. */
	public eventsOf(type: string) {
		return this.events.filter((event) => event.type === type);
	}
}

export class MockPeerConnectionMonitor {
	public peerConnectionId = 'pc-1';

	/**
	 * Track id to track monitor, as the real peer connection keeps it. Only a
	 * detector that has to reach *another* track needs it — `AVDesyncPlayoutDetector`
	 * resolves its audio track's linked video track through here — but it is
	 * cheap enough to hand every mock, and an empty map is the honest stand-in
	 * for a peer connection carrying one track.
	 */
	public readonly mappedInboundTracks = new Map<string, any>();

	/** This connection's own active issues, uplinked into the client monitor. */
	public readonly issues: IssueRegistry;

	public constructor(
		public parent: MockClientMonitor = new MockClientMonitor(),
	) {
		this.issues = new IssueRegistry(this.parent.issueUplink);
	}

	public getPeerConnection() {
		return this;
	}
}

export class MockMediaStreamTrack {
	public id: string;
	public kind: string;
	public label = 'Mock Device';
	public muted = false;
	public enabled = true;
	public readyState: 'live' | 'ended' = 'live';

	private _settings: Record<string, unknown> = {};

	public constructor(kind: string, id = `${kind}-track-1`) {
		this.kind = kind;
		this.id = id;
	}

	public getSettings() {
		return this._settings;
	}

	public setSettings(settings: Record<string, unknown>) {
		this._settings = settings;
	}
}

export class MockInboundTrackMonitor {
	/** This track's own active issues, uplinked into the client monitor. */
	public readonly issues: IssueRegistry;
	public readonly direction = 'inbound';
	public paused = false;
	public remoteOutboundTrackPaused = false;
	public track: MockMediaStreamTrack;

	/**
	 * The lip-sync skew the real `InboundTrackMonitor` derives before its
	 * detectors run — this audio track's playout minus its linked video track's,
	 * positive when audio is ahead. A spec sets it directly; how it is derived
	 * from the two `estimatedPlayoutTimestamp` values, and when it goes
	 * `undefined`, is covered against the real monitor in
	 * tests/monitors/LinkedVideoTrack.spec.ts.
	 */
	public linkedVideoPlayoutDiffInMs?: number;

	/** The video track a spec has paired with this audio track, if any. */
	public linkedVideoTrack?: MockInboundTrackMonitor;

	/**
	 * The window detectors on a real inbound track read their counters from. `setInboundRtp` turns
	 * each call into one collection's worth of entries, and the window is sized so its detection
	 * half holds exactly the last one — so a spec that says "this collection carried these frames"
	 * still means that, whether the detector reads the window or the RTP's own deltas.
	 */
	public readonly slicedWindow: SlicedWindow<MockWindowValues, {
		detection: SliceConfig,
		recovery: SliceConfig,
	}>;

	private _inboundRtp: any = null;
	private _statsClockTime = 0;
	private _totals = { received: 0, rendered: 0, decoded: 0, freezes: 0, frozenInMs: 0 };

	public constructor(
		kind: string,
		public readonly peerConnection = new MockPeerConnectionMonitor(),
		/** Widened by a spec whose detector needs more than one collection to judge. */
		windowConfig = {
			numberOfSamples: { detection: 2, recovery: 2, flowDetection: 2, flowRecovery: 2 },
			maxAllowedGapInMs: 60_000,
		},
	) {
		this.track = new MockMediaStreamTrack(kind);
		this.issues = new IssueRegistry(this.peerConnection.parent.issueUplink);
		this.slicedWindow = new SlicedWindow({
			maxAllowedGapInMs: windowConfig.maxAllowedGapInMs,
			totals: MOCK_WINDOW_VALUES,
			slices: {
				detection: { numberOfSamples: windowConfig.numberOfSamples.detection },
				recovery: {
					numberOfSamples: windowConfig.numberOfSamples.recovery,
					offset: windowConfig.numberOfSamples.detection,
				},
				flowDetection: { numberOfSamples: windowConfig.numberOfSamples.flowDetection },
				flowRecovery: {
					numberOfSamples: windowConfig.numberOfSamples.flowRecovery,
					offset: windowConfig.numberOfSamples.flowDetection,
				},
			},
		});
		// One entry to difference the first collection against, as a real track always has.
		this._addWindowEntry();
	}

	public get kind() {
		return this.track.kind;
	}

	public getPeerConnection() {
		return this.peerConnection;
	}

	public getInboundRtp() {
		return this._inboundRtp;
	}

	public setInboundRtp(stats: any) {
		this._inboundRtp = stats;

		const received = stats?.deltaFramesReceived;
		const rendered = stats?.deltaFramesRendered;
		const decoded = stats?.deltaFramesDecoded;

		// A collection reporting no frame counter leaves the totals unreported, which is what the
		// window sees when the browser stops carrying them.
		if (received === undefined && rendered === undefined && decoded === undefined) {
			return this._addWindowEntry({ unreported: true, spanInMs: stats?.deltaTime });
		}

		this._totals.received += received ?? 0;
		this._totals.rendered += rendered ?? 0;
		this._totals.decoded += decoded ?? 0;
		this._totals.freezes += stats?.deltaFreezeCount ?? 0;
		this._totals.frozenInMs += (stats?.deltaTotalFreezesDuration ?? 0) * 1000;
		this._addWindowEntry({ spanInMs: stats?.deltaTime });
	}

	private _addWindowEntry(options: { unreported?: boolean, spanInMs?: number } = {}) {
		this.slicedWindow.add({
			timestamp: this._statsClockTime,
			value: options.unreported
				? {
					totalFramesReceived: null,
					totalFramesRendered: null,
					totalFramesDecoded: null,
					totalFreezeCount: null,
					totalFreezesDurationInMs: null,
				}
				: {
					totalFramesReceived: this._totals.received,
					totalFramesRendered: this._totals.rendered,
					totalFramesDecoded: this._totals.decoded,
					totalFreezeCount: this._totals.freezes,
					totalFreezesDurationInMs: this._totals.frozenInMs,
				},
		});
		// The collection's own span, so a window's duration is the stats time a spec fed it.
		this._statsClockTime += options.spanInMs ?? 1000;
	}

	public getLinkedVideoTrack() {
		return this.linkedVideoTrack;
	}
}

export class MockOutboundTrackMonitor {
	public readonly direction = 'outbound';
	/** This track's own active issues, uplinked into the client monitor. */
	public readonly issues: IssueRegistry;
	public track: MockMediaStreamTrack;
	public isScreenShare = false;
	public paused = false;
	/**
	 * Set by `PeerConnectionMonitor` from the track's `ended` event, and only ever
	 * for a source that went away by itself — a track the application stopped
	 * reaches `readyState === 'ended'` without it.
	 */
	public sourceEnded = false;

	private _mediaSource: any = null;
	private _outboundRtps: any[] = [];
	private _mediaSourceTimestamp = 0;

	public constructor(
		kind: string,
		public readonly peerConnection = new MockPeerConnectionMonitor(),
	) {
		this.track = new MockMediaStreamTrack(kind);
		this.issues = new IssueRegistry(this.peerConnection.parent.issueUplink);
	}

	public get kind() {
		return this.track.kind;
	}

	/**
	 * What the real `OutboundTrackMonitor` caches once per tick for every detector on the track.
	 * Live here rather than cached, which is equivalent for a spec that sets the settings and then
	 * ticks, and saves the mock a refresh hook.
	 */
	public get trackSettings(): Record<string, unknown> | undefined {
		return this.track.getSettings();
	}

	/** The name the real monitor uses for the same cache; both read the track's own settings. */
	public get settings(): Record<string, unknown> | undefined {
		return this.track.getSettings();
	}

	/** Set by a spec that wants the detectors to see the capture format move. */
	public trackSettingsChanged: boolean | undefined = false;

	public getPeerConnection() {
		return this.peerConnection;
	}

	public getMediaSource() {
		// Each read is a fresh collection tick. Detectors that measure the gap
		// between collections need the stamp to move; specs that care about the
		// exact value set `timestamp` themselves and this leaves it alone.
		if (this._mediaSource && this._mediaSource.timestamp === undefined) {
			this._mediaSourceTimestamp += 2000;

			return { ...this._mediaSource, timestamp: this._mediaSourceTimestamp };
		}

		return this._mediaSource;
	}

	public setMediaSource(mediaSource: any) {
		this._mediaSource = mediaSource;
	}

	public getOutboundRtps() {
		return this._outboundRtps;
	}

	public setOutboundRtps(outboundRtps: any[]) {
		this._outboundRtps = outboundRtps;
	}

	public getHighestLayer() {
		if (this._outboundRtps.length === 0) return undefined;

		return this._outboundRtps.reduce((highest, current) =>
			(current.bitrate ?? 0) > (highest.bitrate ?? 0) ? current : highest);
	}

	/** `OutboundTrackMonitor` publishes this as a property, refreshed each tick. */
	public get highestLayer() {
		return this.getHighestLayer();
	}
}

/**
 * A registry for a spec's own local mock: it routes back into whatever `raiseIssue` /
 * `resolveIssue` that mock already exposes, so assertions written before the registry existed
 * keep reading the same store. Specs that use `MockClientMonitor` do not need this — those
 * monitors carry a registry of their own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mockIssueRegistry(client: any): IssueRegistry {
	return new IssueRegistry({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		notify: (issue: any) => {
			if (client.addIssue) client.addIssue(issue);
			else client.raiseIssue(issue.type, issue);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		raise: (issue: any) => { client.raiseIssue(issue.key, issue); },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		update: (issue: any) => { client.raiseIssue(issue.key, issue); },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		resolve: (issue: any) => { client.resolveIssue(issue.key, issue); },
	});
}

/**
 * The minimum a real monitor needs from a stubbed `parent`: something to uplink its registry
 * into. Writes go nowhere, which is what specs about context, scoring or resolution want — they
 * exercise the monitor, not the issue pipeline.
 */
export const stubClientIssues = () => new IssueRegistry({
	notify: () => { /* discarded */ },
	raise: () => { /* discarded */ },
	update: () => { /* discarded */ },
	resolve: () => { /* discarded */ },
});
