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
	key: string;
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
	public remoteOutboundTrackPaused = false;
	public track: MockMediaStreamTrack;

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
}

export class MockOutboundTrackMonitor {
	public readonly direction = 'outbound';
	public track: MockMediaStreamTrack;

	private _mediaSource: any = null;
	private _outboundRtps: any[] = [];

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
