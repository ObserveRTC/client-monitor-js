import type { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import type { IcePathKind } from "../monitors/IceCandidatePairMonitor";
// Type-only: the monitor imports this detector, so a value import would close that
// cycle at runtime.
import type { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import type { Detector } from "./Detector";

export type BlockedTransportIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	/** `direct`, `turn-udp`, `turn-tcp`, `turn-tls` or `turn-unknown`. */
	pathKind?: IcePathKind;
	/** How long the path had been answering nothing when the issue was raised, in stats time. */
	silentForMs: number;
	/** STUN requests — checks plus consent — that went out unanswered during that window. */
	requestsSent: number;
	/** Latest STUN round trip on the pair before it went silent, in seconds. */
	currentRoundTripTime?: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'blocked-stun-requests';

export type BlockedStunRequestsDetectorConfig = {
	/**
	 * How long the path may answer nothing, in milliseconds of stats time, before the
	 * issue is raised. Consent runs roughly every 5 s, so this should comfortably
	 * exceed one interval; it should also stay under the 30 s at which RFC 7675 makes
	 * the browser cease transmission and hand the session to the ICE detectors.
	 */
	responseReceivedTimeoutInMs: number;

	/**
	 * How long the detector keeps waiting while *no* STUN goes out at all, in
	 * milliseconds of stats time, before standing down. Nothing asked means nothing
	 * to conclude from nothing answered.
	 */
	requestsSentTimeoutInMs: number;
}

/**
 * STUN leaving and nothing coming back on a pair that had already succeeded: requests go out,
 * responses stop, and the path answers nothing for `responseReceivedTimeoutInMs`.
 *
 * That is the one firewall signature a client can prove on its own. Our packets demonstrably left,
 * nothing came back, and no local counter explains it — a middlebox dropping STUN, a NAT binding
 * that expired, a network that went away underneath the socket. The detector does not claim which:
 * it reports that the path stopped answering while we were still asking.
 *
 * The pair must have reached `succeeded` first. Before that, a path that has never answered is
 * ordinary establishment failure and `IceEstablishmentFailedDetector` owns it.
 *
 * **Both counters are read as interval deltas, never as totals.** `responsesReceived` and
 * `requestsSent` are cumulative and monotonic, and a pair only reaches `succeeded` because a
 * response arrived — so `0 < responsesReceived` is true forever from the first tick this detector
 * may run, and testing the total can never fire. What the condition means is "no response *in this
 * window*", which is the delta.
 *
 * **"We asked" counts consent as well as checks.** `requestsSent` is connectivity checks only; the
 * spec counts consent separately in `consentRequestsSent`, and after nomination consent is the only
 * STUN still leaving. Requiring `deltaRequestsSent` alone would be the same never-fires trap one
 * counter along. Sparse ticks are expected either way — consent runs every 4–6 s against a shorter
 * collecting period — so the window accumulates silence and only needs *some* request to have gone
 * out during it, rather than one per tick.
 *
 * Every clock is the transport's own `deltaTime`, never wall clock: a saturated main thread delays
 * collections, and that delay must not be counted as time the path spent silent.
 *
 * One instance judges one transport and lives on that transport's monitor. While a finding is open
 * it marks that transport `blocked`, which `PeerConnectionMonitor.blockedTransport` folds up for
 * readers that ask about the connection. A transport that disappears takes its detector — and with
 * it that mark — away, and leaves the issue open, as every monitor-bound detector does.
 *
 * `inputsUnavailable` is set only where a counter the verdict rests on is absent from the report —
 * not where there is simply nothing to judge, which is the ordinary state of any pair that has not
 * succeeded yet.
 *
 * Category: Transport Quality
 * Layer: Delivery reliability
 *
 */
export class BlockedStunRequestsDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'blocked-stun-requests-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	/** Stats time the path has answered nothing, or `undefined` while it is answering. */
	private _silentForInMs?: number;
	/** STUN requests that went out unanswered during that window. */
	private _requestsSentWhileSilent = 0;
	/** Wall clock, and only for the resolved issue's `durationInMs`. */
	private _raisedAt?: number;

	public constructor(
		public readonly iceTransport: IceTransportMonitor,
	) {
	}

	public get peerConnection(): PeerConnectionMonitor {
		return this.iceTransport.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.blockedStunRequestsDetector!;
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		const pair = this.iceTransport.getSelectedCandidatePair();
		const deltaTime = this.iceTransport.deltaTime ?? 0;

		this.inputsUnavailable = false;

		// Nothing to judge until a pair has answered at least once. Not applicable, which
		// is a different statement from being unable to see — the flag stays false.
		if (!pair || pair.state !== 'succeeded') {
			return this._silentForInMs !== undefined ? this._clear('ice has not verified this path') : undefined;
		}

		if (pair.deltaResponsesReceived === undefined) {
			this.inputsUnavailable = true;

			return this._silentForInMs !== undefined ? this._clear('stun responses are not reported') : undefined;
		}

		// Absent on both counters is blindness; absent on one is not, because either
		// alone is enough to say some STUN went out.
		if (pair.deltaRequestsSent === undefined && pair.deltaConsentRequestsSent === undefined) {
			this.inputsUnavailable = true;

			return this._silentForInMs !== undefined ? this._clear('stun requests are not reported') : undefined;
		}

		if (0 < pair.deltaResponsesReceived) {
			return this._silentForInMs !== undefined ? this._clear('stun is answering again') : undefined;
		}

		this._silentForInMs = (this._silentForInMs ?? 0) + deltaTime;
		this._requestsSentWhileSilent += (pair.deltaRequestsSent ?? 0) + (pair.deltaConsentRequestsSent ?? 0);

		// Nothing has been asked for a while either, so nothing answered says nothing.
		if (this._requestsSentWhileSilent < 1) {
			return this.config.requestsSentTimeoutInMs < this._silentForInMs
				? this._clear('no stun requests are going out')
				: undefined;
		}

		if (this._silentForInMs < this.config.responseReceivedTimeoutInMs) return;
		if (this._raisedAt !== undefined) return;

		this._raisedAt = Date.now();
		this.iceTransport.blocked = true;

		const clientMonitor = this.peerConnection.parent;
		const payload: BlockedTransportIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: this.iceTransport.id,
			pathKind: pair.pathKind,
			silentForMs: this._silentForInMs,
			requestsSent: this._requestsSentWhileSilent,
			currentRoundTripTime: pair.currentRoundTripTime,
		};

		clientMonitor.emit('blocked-transport', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		clientMonitor.raiseIssue<BlockedTransportIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	/**
	 * Ends the window, resolving the issue if one was raised. Every call site tests
	 * `_silentForInMs` first: most ticks on a healthy transport answer STUN with no
	 * window open, and there is nothing to end. `_raisedAt` needs no test of its own —
	 * it is only ever set while a window is open, so the one field answers both.
	 */
	private _clear(comment: string) {
		this._silentForInMs = undefined;
		this._requestsSentWhileSilent = 0;

		if (this._raisedAt === undefined) return;

		this.iceTransport.blocked = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		if (issue) {
			clientMonitor.resolveIssue(this._issueKey, {
				comment,
				payload: { ...issue.payload, durationInMs: Date.now() - this._raisedAt },
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}

	private get _issueKey() {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${this.iceTransport.id}`;
	}
}
