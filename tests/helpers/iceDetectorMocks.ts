import { IssueRegistry, IssueRegistrySink } from "../../src/utils/IssueRegistry";
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Stand-ins for the peer connection, ICE transport and candidate pair that the
 * connectivity detectors read. They live apart from `detectorMocks.ts`, whose
 * peer connection is track-oriented: an ICE detector never looks at a track and
 * reaches instead for transports, candidate pairs and candidates.
 *
 * The important thing they model is `deltaTime`. Every condition clock in these
 * detectors accumulates the monitored object's own `deltaTime` rather than
 * wall-clock elapsed, so a spec drives time by calling `tick(ms)` before each
 * `update()`. That is not a convenience: a spec that advanced fake timers would
 * be testing something the detectors no longer read.
 */

export type TestIssue = {
	id: string;
	type: string;
	key?: string;
	payload: Record<string, unknown>;
};

type EventHandler = (event: Record<string, unknown>) => void;

/**
 * One block per connectivity detector, matching `ClientMonitorConfig` — each
 * detector reads its own key and nothing else, so a spec that wants to retune
 * one of them edits one block and cannot reach another detector by accident.
 * The values are the shipped defaults from `ClientMonitor`.
 */
export class MockClientMonitor {
	public config: Record<string, any> = {
		iceReachabilityDetector: {
			thresholdInMs: 6000,
		},
		iceTraversalDetector: {},
		icePathEstablishmentDetector: {
			thresholdInMs: 5000,
			createEvent: true,
		},
		iceEstablishmentFailedDetector: {
			thresholdInMs: 15000,
		},
		dtlsHandshakeFailedDetector: {},
		dtlsHandshakeStalledDetector: {
			stalledThresholdInMs: 6000,
		},
		iceDisconnectedDetector: {
			disconnectedThresholdInMs: 5000,
		},
		iceConnectionFailedDetector: {},
		iceTransportStalledDetector: {
			transportStallThresholdInMs: 5000,
		},
		unstableIcePathDetector: {
			pathSwitchWindowInMs: 30000,
			pathSwitchThreshold: 3,
		},
		iceRestartDetector: {
			createEvent: true,
		},
		iceRestartRecommendationDetector: {
			createEvent: true,
			iceRestartRecommendationThresholdInMs: 10000,
			iceRestartRecommendationCooldownInMs: 15000,
			restartRecommendationThresholdInMs: 10000,
			restartRecommendationCooldownInMs: 15000,
		},
	};

	public readonly activeIssues = new Map<string, TestIssue>();
	public readonly addedEvents: { type: string; payload?: Record<string, unknown> }[] = [];

	private _handlers: { [key: string]: EventHandler[] } = {};
	private _nextId = 0;

	public emit(eventName: string, eventData: Record<string, unknown>) {
		(this._handlers[eventName] ?? []).forEach((handler) => handler(eventData));
	}

	public on(eventName: string, handler: EventHandler) {
		(this._handlers[eventName] ??= []).push(handler);
	}

	public addEvent(event: { type: string; payload?: Record<string, unknown> }) {
		this.addedEvents.push(event);
	}

	public raiseIssue(key: string, input: { type: string; payload?: Record<string, unknown> }) {
		const existing = this.activeIssues.get(key);

		if (existing) {
			existing.payload = input.payload ?? {};
			existing.type = input.type;
			this.emit('issue-updated', existing as unknown as Record<string, unknown>);

			return existing;
		}

		const issue: TestIssue = {
			id: `iss_${this._nextId++}`,
			type: input.type,
			key,
			payload: input.payload ?? {},
		};

		this.activeIssues.set(key, issue);
		this.emit('issue', issue as unknown as Record<string, unknown>);

		return issue;
	}

	public resolveIssue(key: string, opts?: { comment?: string; payload?: Record<string, unknown>; resolvedAt?: number }) {
		const found = this.activeIssues.get(key);

		if (!found) return undefined;

		this.activeIssues.delete(key);

		const resolved = {
			...found,
			payload: opts?.payload ?? found.payload,
			resolvedAt: opts?.resolvedAt ?? Date.now(),
			comment: opts?.comment,
		};

		this.emit('issue-resolved', resolved as unknown as Record<string, unknown>);

		return resolved;
	}

	public getIssues() {
		return [ ...this.activeIssues.values() ];
	}

	public getIssuesByType(type: string) {
		return this.getIssues().filter((issue) => issue.type === type);
	}
	/**
	 * What a per-monitor `IssueRegistry` forwards into. It routes back through this mock's own
	 * `raiseIssue` / `resolveIssue`, so assertions on `activeIssues` read exactly as before.
	 */
	public readonly issueUplink: IssueRegistrySink = {
		notify: (issue: any) => { this.raiseIssue(issue.type, issue); },
		raise: (issue: any) => { this.raiseIssue(issue.key, issue); },
		update: (issue: any) => { this.raiseIssue(issue.key, issue); },
		resolve: (issue: any) => { this.resolveIssue(issue.key, issue); },
	};

}

export class MockCandidatePair {
	public state: string | undefined = 'succeeded';
	public nominated: boolean | undefined = undefined;
	public deltaBytesSent: number | undefined = 0;
	public deltaBytesReceived: number | undefined = 0;
	public currentRoundTripTime: number | undefined = 0.05;
	public lastPacketReceivedTimestamp: number | undefined = 0;
	public localUsernameFragment: string | undefined = undefined;
	public pathKind = 'direct';

	public constructor(
		public id = 'pair-1',
		public transportId: string | undefined = 'transport-1',
	) {
	}

	public get pathKey() {
		return this.transportId ?? 'unknown-ice-transport';
	}

	public getLocalCandidate() {
		return { usernameFragment: this.localUsernameFragment };
	}
}

export class MockIceTransport {
	/**
	 * The transport's own registry. In the real object it uplinks into its peer connection, which
	 * uplinks into the client — three layers. Here it goes straight to the client's uplink,
	 * because the mock connection is not always attached when a transport is built.
	 */
	public issues!: IssueRegistry;
	public dtlsState: string | undefined = 'connected';
	public selectedCandidatePairId: string | undefined = 'pair-1';
	public iceLocalUsernameFragment: string | undefined = 'ufrag-1';
	public deltaSelectedCandidatePairChanges: number | undefined = undefined;
	public deltaTime: number | undefined = undefined;
	public everConnected = false;

	public constructor(
		public id = 'transport-1',
		public iceState: string | undefined = 'connected',
		public pair: MockCandidatePair | undefined = new MockCandidatePair(),
	) {
		if (iceState === 'connected' || iceState === 'completed') this.everConnected = true;
	}

	/**
	 * Advances the transport's stats clock by `elapsedInMs`, which is the only
	 * clock the condition timers in these detectors read. Also maintains
	 * `everConnected` the way `IceTransportMonitor.accept()` does.
	 */
	public tick(elapsedInMs = 1000) {
		this.deltaTime = elapsedInMs;

		if (this.iceState === 'connected' || this.iceState === 'completed') this.everConnected = true;

		return this;
	}

	public getSelectedCandidatePair() {
		return this.pair;
	}

	/**
	 * Set by `MockPeerConnectionMonitor` when the transport is attached, so the RTP
	 * readers below can resolve the streams the way the real monitor does.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public peerConnection: any;

	public getInboundRtps() {
		return (this.peerConnection?.inboundRtps ?? []).filter(
			(rtp: { transportId?: string }) => rtp.transportId === this.id,
		);
	}

	public getOutboundRtps() {
		return (this.peerConnection?.outboundRtps ?? []).filter(
			(rtp: { transportId?: string }) => rtp.transportId === this.id,
		);
	}
}

export class MockPeerConnectionMonitor {
	public peerConnectionId = 'test-pc-id';
	public parent = new MockClientMonitor();
	/** This connection's own active issues, uplinked into the client monitor. */
	public readonly issues: IssueRegistry = new IssueRegistry(this.parent.issueUplink);
	public closed = false;
	public connectionState: string | undefined = 'connected';
	public connectingStartedAt: number | undefined = undefined;
	public iceGatheringState: string | undefined = undefined;
	public deltaTime: number | undefined = undefined;
	private _iceTransports: MockIceTransport[] = [];

	public get iceTransports(): MockIceTransport[] {
		return this._iceTransports;
	}

	/** Attaching a transport back-links it, so its RTP readers can resolve streams. */
	public set iceTransports(transports: MockIceTransport[]) {
		this._iceTransports = transports;

		for (const transport of transports) {
			transport.peerConnection = this;
			// Three layers in the real object; the mock collapses the middle one, because a
			// transport is often built before any connection is attached to it.
			transport.issues = new IssueRegistry(this.parent.issueUplink);
		}
	}
	public iceCandidatePairs: MockCandidatePair[] = [];
	public iceCandidates: { direction: 'local' | 'remote', candidateType?: string }[] = [];

	/**
	 * Bidirectional by default: the inbound-stall check only judges a transport
	 * that carries inbound RTP. A send-only SFU publish transport has none, and
	 * has its own regression test.
	 */
	public inboundRtps: { transportId?: string }[] = [ { transportId: 'transport-1' } ];
	public outboundRtps: { transportId?: string }[] = [ { transportId: 'transport-1' } ];

	public constructor() {
		// Through the setter, so the default transport is back-linked like any other.
		this.iceTransports = [ new MockIceTransport() ];
	}

	public get localIceCandidates() {
		return this.iceCandidates.filter((candidate) => candidate.direction === 'local');
	}

	/** Advances the peer connection's own stats clock. */
	public tick(elapsedInMs = 1000) {
		this.deltaTime = elapsedInMs;

		for (const transport of this.iceTransports) transport.tick(elapsedInMs);

		return this;
	}

	public setTransports(...transports: MockIceTransport[]) {
		this.iceTransports = transports;
	}

	/** Mirrors the real monitor's connectionState setter behaviour. */
	public setConnectionState(state: string | undefined) {
		this.connectionState = state;
		if (state === 'connecting') this.connectingStartedAt = Date.now();
		else if (state !== 'connected') this.connectingStartedAt = undefined;
	}
}
