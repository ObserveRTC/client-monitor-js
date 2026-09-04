import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** How many local candidates of each type ICE managed to gather before giving up. */
export type IceLocalCandidateCounts = {
	host: number;
	srflx: number;
	relay: number;
	prflx: number;
	/** Candidates whose `candidateType` the stats source did not report. */
	unknown: number;
};

/**
 * `localCandidateCounts` and `candidatePairStates` are the summary of what was actually tried, which
 * is the whole diagnostic value of the issue: they say whether the client got as far as a reflexive
 * or relay candidate, and how far the checks against the far end got. `sustainedForInMs` is how long
 * the connection had been failing to establish when the issue was raised; `durationInMs` is filled in
 * if it establishes later.
 */
export type IceEstablishmentFailedIssuePayload = {
	peerConnectionId: string;
	connectionState?: string;
	iceGatheringState?: string;
	localIceCandidateCount: number;
	localCandidateCounts: IceLocalCandidateCounts;
	/** Every distinct `state` seen across the candidate pairs, deduplicated and sorted. */
	candidatePairStates: string[];
	candidatePairCount: number;
	sustainedForInMs: number;
	durationInMs?: number;
};

const ISSUE_TYPE = 'ice-establishment-failed';

export type IceEstablishmentFailedDetectorConfig = {
	/**
	 * How long (in milliseconds) the connection must go on failing to
	 * establish before the issue is raised, measured in accumulated stats
	 * time rather than wall clock. It should comfortably exceed
	 * `icePathEstablishmentDetector.thresholdInMs`, since a connection that
	 * is merely slow is not yet one that failed.
	 */
	thresholdInMs: number;
}

/**
 * The call that never connected — by a wide margin the most common connectivity failure a user
 * actually reports, and until this detector existed the one thing the library could not put in
 * `activeIssues`. Layer 3 emitted an event when establishment dragged on and recommended a restart,
 * but an event is a notification: it is gone the moment it fires, it does not resolve, and nothing
 * asking "what is wrong with this session right now" could see it. So the single most user-visible
 * failure produced an empty issue list, which read as a healthy call.
 *
 * The condition is deliberately three facts together, none of them sufficient alone. Local
 * candidates exist, so this is emphatically not the no-network case — `IceReachabilityDetector` owns
 * that, and the two are mutually exclusive by construction rather than by suppression. The peer
 * connection has never reached `connected`, so this is establishment failing rather than a working
 * call that later broke, which the layer-5 detectors own. And no candidate pair has ever been
 * nominated or reached `succeeded`, which is what distinguishes "checks are still running and might
 * yet win" from "nothing ever won": a connection where a pair succeeded and DTLS is what stalled is
 * a different fault with a different owner. All three have to hold for the whole of
 * `thresholdInMs`, accumulated from the peer connection's own `deltaTime`, because ICE checking
 * legitimately takes seconds and a threshold measured in wall time would punish a slow collection
 * rather than a slow connection.
 *
 * The payload carries what was tried rather than only that it failed, which is where the candidate
 * types and the pair `nominated`/`state` fields — collected by this library since forever and read
 * by nothing — finally earn their place. Host candidates only means gathering never reached a STUN
 * server. Host and reflexive but no relay means TURN was never configured or never answered, which
 * is the single most common cause of a call that only fails between certain networks. Relay
 * candidates present with every pair still `in-progress` or `failed` means the relay itself is not
 * reachable or the far end never answered the checks. That is the difference between a
 * misconfiguration, a firewall and a dead peer, and it is all in the stats already.
 *
 * What it deliberately does not claim: which side is at fault. Every fact here is local — what this
 * endpoint gathered and how its own checks went — and a far end that never sent an answer looks
 * exactly like a far end whose candidates cannot be reached. The counts are evidence for a human
 * or a server-side correlation to work with, not a verdict.
 *
 * Issue raised: `ice-establishment-failed`, resolved if the connection establishes after all or
 * when the peer connection closes. Config: `iceEstablishmentFailedDetector`.
 *
 * Category: Connectivity
 * Layer: 3 — Path establishment
 *
 */
export class IceEstablishmentFailedDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'ice-establishment-failed-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;

	private _everConnected = false;
	private _everNominated = false;
	private _sustainedForInMs = 0;
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this._issueKey = `${ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.iceEstablishmentFailedDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) {
			this._resolve('peer connection closed');

			return;
		}

		const connectionState = this.peerConnection.connectionState;

		if (connectionState === 'connected') {
			this._everConnected = true;
		}

		// Latched, not sampled: a pair that won once is proof establishment got
		// there, however the pair looks on any later tick.
		for (const pair of this.peerConnection.iceCandidatePairs) {
			if (pair.nominated === true || pair.state === 'succeeded') {
				this._everNominated = true;
				break;
			}
		}

		if (this._everConnected || this._everNominated) {
			this._sustainedForInMs = 0;

			this._resolve('ice path established');

			return;
		}

		// With no local candidates there is nothing to have failed *with*, and
		// `no-available-ice-candidate` is the issue that owns that case.
		if (this.peerConnection.localIceCandidates.length === 0) {
			this._sustainedForInMs = 0;

			return;
		}

		this._sustainedForInMs += this.peerConnection.deltaTime ?? 0;

		if (this._sustainedForInMs < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		this._raisedAt = Date.now();

		this.peerConnection.parent.raiseIssue<IceEstablishmentFailedIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				connectionState,
				iceGatheringState: this.peerConnection.iceGatheringState,
				localIceCandidateCount: this.peerConnection.localIceCandidates.length,
				localCandidateCounts: this._localCandidateCounts(),
				candidatePairStates: this._candidatePairStates(),
				candidatePairCount: this.peerConnection.iceCandidatePairs.length,
				sustainedForInMs: this._sustainedForInMs,
			},
		});
	}

	private _localCandidateCounts(): IceLocalCandidateCounts {
		const counts: IceLocalCandidateCounts = { host: 0, srflx: 0, relay: 0, prflx: 0, unknown: 0 };

		for (const candidate of this.peerConnection.localIceCandidates) {
			switch (candidate.candidateType) {
				case 'host': counts.host += 1; break;
				case 'srflx': counts.srflx += 1; break;
				case 'relay': counts.relay += 1; break;
				case 'prflx': counts.prflx += 1; break;
				default: counts.unknown += 1; break;
			}
		}

		return counts;
	}

	private _candidatePairStates(): string[] {
		const states = new Set<string>();

		for (const pair of this.peerConnection.iceCandidatePairs) {
			states.add(pair.state ?? 'unknown');
		}

		return [ ...states ].sort();
	}

	private _resolve(comment: string) {
		if (this._raisedAt === undefined) return;

		const raisedAt = this._raisedAt;

		this._raisedAt = undefined;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		if (!issue) return;

		clientMonitor.resolveIssue<IceEstablishmentFailedIssuePayload>(this._issueKey, {
			comment,
			payload: {
				...(issue.payload as IceEstablishmentFailedIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}
}
