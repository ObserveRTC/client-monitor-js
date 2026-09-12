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

/** A summary of what was actually tried: how far gathering got, and how far the checks against the far end got. */
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
	/** Stats time the connection must go on failing to establish before raising, in ms. Keep it above
	 * `icePathEstablishmentDetector.thresholdInMs` — merely slow is not yet failed. */
	thresholdInMs: number;
}

/**
 * Reports the call that never connected, as a resolvable issue rather than a passing event. The
 * payload carries what was actually tried, so an operator can tell the common causes apart: host
 * candidates only means gathering never reached a STUN server; host and reflexive but no relay means
 * TURN was never configured or never answered; relay candidates with every pair `in-progress` or
 * `failed` means the relay is unreachable or the far end never answered the checks.
 *
 * Three facts must hold together for the whole of `thresholdInMs` in stats time: local candidates
 * exist (so this is not the no-network case `IceReachabilityDetector` owns), the connection has
 * never reached `connected` (so this is establishment failing, not a working call that broke), and
 * no pair was ever nominated or `succeeded` (so a stalled DTLS handshake stays its owner's).
 *
 * It does not claim which side is at fault — every fact here is local.
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

		// Latched, not sampled: a pair that won once stays proof on every later tick.
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

		// Nothing to have failed with — `no-available-ice-candidate` owns that case.
		if (this.peerConnection.localIceCandidates.length === 0) {
			this._sustainedForInMs = 0;

			return;
		}

		this._sustainedForInMs += this.peerConnection.deltaTime ?? 0;

		if (this._sustainedForInMs < this.config.thresholdInMs) return;
		if (this._raisedAt !== undefined) return;

		this._raisedAt = Date.now();

		this.peerConnection.issues.raise({
			key: this._issueKey,
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

		const issue = this.peerConnection.issues.get(this._issueKey);

		if (!issue) return;

		this.peerConnection.issues.resolve({
			key: this._issueKey,
			comment,
			payload: {
				...(issue.payload as IceEstablishmentFailedIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}
}
