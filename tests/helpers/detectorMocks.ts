/* eslint-disable @typescript-eslint/no-explicit-any */

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
	public readonly activeIssues = new Map<string, TestIssue>();
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
		const existing = this.activeIssues.get(key);

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

		this.activeIssues.set(key, issue);
		this.raisedIssues.push(issue);
		this.emit('issue', issue);

		return issue;
	}

	public resolveIssue(key: string, opts?: { comment?: string, payload?: Record<string, unknown>, resolvedAt?: number }) {
		const found = this.activeIssues.get(key);

		if (!found) return undefined;

		this.activeIssues.delete(key);

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
		return [...this.activeIssues.values()];
	}

	public isIssueActive(key: string) {
		return this.activeIssues.has(key);
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

	public constructor(
		public parent: MockClientMonitor = new MockClientMonitor(),
	) {}

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

	private _inboundRtp: any = null;

	public constructor(
		kind: string,
		public readonly peerConnection = new MockPeerConnectionMonitor(),
	) {
		this.track = new MockMediaStreamTrack(kind);
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
	}

	public getLinkedVideoTrack() {
		return this.linkedVideoTrack;
	}
}

export class MockOutboundTrackMonitor {
	public readonly direction = 'outbound';
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
	}

	public get kind() {
		return this.track.kind;
	}

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
}
