import EventEmitter from 'eventemitter3';
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { IceCandidatePairMonitor, IcePathKind } from "./IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

/**
 * Why the selected path changed. `initial-selection` is reported the first time
 * a path is observed on an ICE transport and is deliberately not counted as a
 * switch.
 */
export type IcePathTransition =
	| 'initial-selection'
	| 'direct-to-relay'
	| 'relay-to-direct'
	| 'relay-protocol-changed'
	| 'turn-server-changed'
	| 'path-changed';

/** Snapshot of what a path looked like at the moment of a transition. */
export type IcePathEvidence = {
	kind: IcePathKind;
	pairId?: string;
	transportId?: string;
	localCandidateId?: string;
	remoteCandidateId?: string;
	localCandidateType?: string;
	remoteCandidateType?: string;
	protocol?: string;
	relayProtocol?: string;
	turnUrl?: string;
	turnServer?: string;
	localAddress?: string;
	localPort?: number;
	remoteAddress?: string;
	remotePort?: number;
};

export type SelectedIcePathEvents = {
	'changed': [ { transition: IcePathTransition, from?: IcePathEvidence, to: IcePathEvidence } ],
	'close': [],
};

/** How long the path spent in each kind, in milliseconds. */
export type IcePathDurations = Record<IcePathKind, number>;

function emptyDurations(): IcePathDurations {
	return {
		'direct': 0,
		'turn-udp': 0,
		'turn-tcp': 0,
		'turn-tls': 0,
		'turn-unknown': 0,
	};
}

/**
 * The live selected ICE path of one ICE transport.
 *
 * This is the single authoritative interpretation of "what path is this peer
 * connection actually using". It holds no copies of candidate data: every
 * descriptive getter reads through the linked `IceCandidatePairMonitor` and its
 * local/remote `IceCandidateMonitor`s, so the path can never disagree with the
 * stats it was built from.
 *
 * What it *does* own is everything those monitors cannot express:
 *
 * - **Transitions.** It compares the selected pair between ticks and emits a
 *   `'changed'` event (plus the monitor-level `'ice-path-changed'`) describing
 *   what kind of change happened — direct↔relay, relay protocol, TURN server,
 *   or a plain tuple change.
 * - **TURN usage accounting.** Time spent on each path kind, how long it took
 *   to first select a relay, how many switches of each kind happened, and how
 *   much traffic actually flowed over a relay. These are *facts*, not verdicts:
 *   the client does not judge whether TURN usage was appropriate.
 *
 * These accumulators are deliberately **not** part of the client sample. The
 * sample already carries `iceTransports`, `iceCandidatePairs` and
 * `iceCandidates`, so a server can resolve the selected pair and derive the
 * same facts itself, and the sub-sample transitions it would otherwise miss
 * reach it as `ICE_PATH_CHANGED` client events. Shipping the aggregates too
 * would duplicate derivable state and grow a schema shared across repos.
 *
 * A peer connection using BUNDLE has one path; without BUNDLE there is one per
 * media transport, which is why paths are keyed by ICE transport.
 */
export class SelectedIcePath extends EventEmitter<SelectedIcePathEvents> {
	/** Wall-clock time this path was first selected. */
	public readonly createdAt = Date.now();
	public updatedAt = Date.now();
	public closed = false;

	/** Time spent in each path kind. */
	public readonly durations: IcePathDurations = emptyDurations();

	public pathSwitches = 0;
	public directToRelaySwitches = 0;
	public relayToDirectSwitches = 0;
	public relayProtocolSwitches = 0;
	public turnServerSwitches = 0;

	/** When a relay path was first selected on this transport, if ever. */
	public firstRelaySelectedAt?: number;
	public lastSwitchedAt?: number;

	public totalBytesSent = 0;
	public totalBytesReceived = 0;
	public totalPacketsSent = 0;
	public totalPacketsReceived = 0;

	/** The portion of the totals above that travelled over a relay. */
	public relayBytesSent = 0;
	public relayBytesReceived = 0;
	public relayPacketsSent = 0;
	public relayPacketsReceived = 0;

	private _kind: IcePathKind;
	private _turnServer?: string;
	private _tuple: string;
	private _kindSince = Date.now();
	private readonly _switchTimestamps: number[] = [];

	/**
	 * Additional data attached to this path, will not be shipped to the server,
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly key: string,
		private _pair: IceCandidatePairMonitor,
		private readonly _peerConnection: PeerConnectionMonitor,
	) {
		super();

		this._kind = _pair.pathKind;
		this._turnServer = _pair.turnServer;
		this._tuple = _pair.tuple;

		if (this.usingTurn) this.firstRelaySelectedAt = this.createdAt;
	}

	/* ----- links ----- */

	public getPeerConnection(): PeerConnectionMonitor {
		return this._peerConnection;
	}

	/** The candidate pair currently selected on this transport. */
	public get pair(): IceCandidatePairMonitor {
		return this._pair;
	}

	public get localCandidate() {
		return this._pair.getLocalCandidate();
	}

	public get remoteCandidate() {
		return this._pair.getRemoteCandidate();
	}

	public get iceTransport() {
		return this._pair.getIceTransport();
	}

	/* ----- descriptive getters (all read through the linked monitors) ----- */

	public get pairId() {
		return this._pair.id;
	}

	public get transportId() {
		return this._pair.transportId;
	}

	public get kind(): IcePathKind {
		return this._pair.pathKind;
	}

	public get usingTurn(): boolean {
		return this._pair.usingTurn;
	}

	public get usingTcp(): boolean {
		return this._pair.usingTcp;
	}

	public get relayProtocol() {
		return this._pair.relayProtocol;
	}

	public get turnUrl() {
		return this._pair.turnUrl;
	}

	public get turnServer() {
		return this._pair.turnServer;
	}

	public get tuple() {
		return this._pair.tuple;
	}

	public get protocol() {
		return this.localCandidate?.protocol;
	}

	public get localCandidateType() {
		return this.localCandidate?.candidateType;
	}

	public get remoteCandidateType() {
		return this.remoteCandidate?.candidateType;
	}

	public get localAddress() {
		return this.localCandidate?.address;
	}

	public get localPort() {
		return this.localCandidate?.port;
	}

	public get localAddressFamily() {
		return this.localCandidate?.addressFamily;
	}

	public get remoteAddress() {
		return this.remoteCandidate?.address;
	}

	public get remotePort() {
		return this.remoteCandidate?.port;
	}

	public get remoteAddressFamily() {
		return this.remoteCandidate?.addressFamily;
	}

	public get currentRoundTripTime() {
		return this._pair.currentRoundTripTime;
	}

	public get state() {
		return this._pair.state;
	}

	/* ----- derived TURN usage facts ----- */

	/** How long this path has existed. */
	public get durationInMs(): number {
		return this.updatedAt - this.createdAt;
	}

	/** Total time spent on a relay path, across all relay protocols. */
	public get relayDurationInMs(): number {
		return this.durations['turn-udp']
			+ this.durations['turn-tcp']
			+ this.durations['turn-tls']
			+ this.durations['turn-unknown'];
	}

	/**
	 * Time from the path being established to the first relay selection.
	 * `undefined` when a relay was never selected.
	 */
	public get timeToFirstRelayInMs(): number | undefined {
		return this.firstRelaySelectedAt === undefined ? undefined : this.firstRelaySelectedAt - this.createdAt;
	}

	/** Share of the observed traffic that travelled over a relay (0..1). */
	public get relayBytesRatio(): number | undefined {
		const total = this.totalBytesSent + this.totalBytesReceived;

		if (total <= 0) return undefined;

		return (this.relayBytesSent + this.relayBytesReceived) / total;
	}

	/** How many path switches happened at or after `timestamp`. */
	public getSwitchCountSince(timestamp: number): number {
		let result = 0;

		for (let i = this._switchTimestamps.length - 1; 0 <= i; --i) {
			const switchedAt = this._switchTimestamps[i];

			if (switchedAt === undefined || switchedAt < timestamp) break;
			++result;
		}

		return result;
	}

	/* ----- lifecycle ----- */

	/**
	 * Called once per stats tick with the pair currently selected on this
	 * transport. Accumulates the usage facts and emits a transition when the
	 * path materially changed.
	 */
	public update(pair: IceCandidatePairMonitor): void {
		if (this.closed) return;

		const now = Date.now();
		const previousKind = this._kind;
		const previousTurnServer = this._turnServer;
		const previousTuple = this._tuple;
		const previousEvidence = this._describe();

		// Attribute the elapsed time to the kind the path had during it, then
		// swap in the new pair — the descriptive getters follow it from here on.
		this.durations[previousKind] += Math.max(0, now - this._kindSince);
		this._kindSince = now;
		this._pair = pair;
		this.updatedAt = now;

		this._accumulateTraffic(pair);

		const kind = pair.pathKind;
		const turnServer = pair.turnServer;
		const tuple = pair.tuple;

		if (this.usingTurn && this.firstRelaySelectedAt === undefined) {
			this.firstRelaySelectedAt = now;
		}

		if (kind === previousKind && turnServer === previousTurnServer && tuple === previousTuple) {
			return;
		}

		const transition = resolveTransition(
			{ kind: previousKind, turnServer: previousTurnServer },
			{ kind, turnServer },
		);

		this._kind = kind;
		this._turnServer = turnServer;
		this._tuple = tuple;

		++this.pathSwitches;
		this.lastSwitchedAt = now;
		this._switchTimestamps.push(now);
		// Bounded: detectors evaluate a window, they never need the full history.
		if (64 < this._switchTimestamps.length) this._switchTimestamps.shift();

		switch (transition) {
			case 'direct-to-relay':
				++this.directToRelaySwitches;
				break;
			case 'relay-to-direct':
				++this.relayToDirectSwitches;
				break;
			case 'relay-protocol-changed':
				++this.relayProtocolSwitches;
				break;
			case 'turn-server-changed':
				++this.turnServerSwitches;
				break;
		}

		this._notify(transition, previousEvidence);
	}

	/** Emits the initial-selection transition. Called right after construction. */
	public notifyInitialSelection(): void {
		this._notify('initial-selection', undefined);
	}

	public close(): void {
		if (this.closed) return;
		this.closed = true;

		this.durations[this._kind] += Math.max(0, Date.now() - this._kindSince);

		this.emit('close');
		this.removeAllListeners();
	}

	private _accumulateTraffic(pair: IceCandidatePairMonitor) {
		const bytesSent = pair.deltaBytesSent ?? 0;
		const bytesReceived = pair.deltaBytesReceived ?? 0;
		const packetsSent = pair.deltaPacketsSent ?? 0;
		const packetsReceived = pair.deltaPacketsReceived ?? 0;

		this.totalBytesSent += bytesSent;
		this.totalBytesReceived += bytesReceived;
		this.totalPacketsSent += packetsSent;
		this.totalPacketsReceived += packetsReceived;

		if (!pair.usingTurn) return;

		this.relayBytesSent += bytesSent;
		this.relayBytesReceived += bytesReceived;
		this.relayPacketsSent += packetsSent;
		this.relayPacketsReceived += packetsReceived;
	}

	private _notify(transition: IcePathTransition, from: IcePathEvidence | undefined) {
		const to = this._describe();
		const clientMonitor = this._peerConnection.parent;

		this.emit('changed', { transition, from, to });

		clientMonitor.emit('ice-path-changed', {
			clientMonitor,
			peerConnectionMonitor: this._peerConnection,
			selectedIcePath: this,
			transition,
			from,
			to,
		});

		clientMonitor.addEvent({
			type: ClientEventTypes.PEER_CONNECTION_ICE_PATH_CHANGED,
			payload: {
				peerConnectionId: this._peerConnection.peerConnectionId,
				transition,
				// schema 3.5.0 payloads are flat records of primitives: the
				// path evidence objects travel as JSON documents
				from: from === undefined ? undefined : JSON.stringify(from),
				to: JSON.stringify(to),
			},
		});
	}

	private _describe(): IcePathEvidence {
		const local = this.localCandidate;
		const remote = this.remoteCandidate;

		return {
			kind: this.kind,
			pairId: this.pairId,
			transportId: this.transportId,
			localCandidateId: this._pair.localCandidateId,
			remoteCandidateId: this._pair.remoteCandidateId,
			localCandidateType: local?.candidateType,
			remoteCandidateType: remote?.candidateType,
			protocol: local?.protocol,
			relayProtocol: this.relayProtocol,
			turnUrl: this.turnUrl,
			turnServer: this.turnServer,
			localAddress: local?.address,
			localPort: local?.port,
			remoteAddress: remote?.address,
			remotePort: remote?.port,
		};
	}
}

function resolveTransition(
	previous: { kind: IcePathKind, turnServer?: string },
	current: { kind: IcePathKind, turnServer?: string },
): IcePathTransition {
	const wasRelay = previous.kind !== 'direct';
	const isRelay = current.kind !== 'direct';

	if (!wasRelay && isRelay) return 'direct-to-relay';
	if (wasRelay && !isRelay) return 'relay-to-direct';
	if (wasRelay && isRelay) {
		if (previous.turnServer !== current.turnServer) return 'turn-server-changed';
		if (previous.kind !== current.kind) return 'relay-protocol-changed';
	}

	return 'path-changed';
}
