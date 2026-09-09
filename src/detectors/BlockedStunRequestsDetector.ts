import type { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import type { IcePathKind } from "../monitors/IceCandidatePairMonitor";
// Type-only: the monitor imports this detector, so a value import would close the cycle at runtime.
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
	/** Stats time the path may answer nothing before raising, in ms. Consent runs every ~5 s, so keep it well above that. */
	responseReceivedTimeoutInMs: number;

	/** Stats time to keep waiting while no STUN goes out at all, in ms, before standing down. */
	requestsSentTimeoutInMs: number;
}

/**
 * Reports a path that stopped answering STUN while this endpoint was still asking — the one firewall
 * signature a client can prove on its own. Use it to tell a middlebox dropping STUN, an expired NAT
 * binding or a network vanishing under the socket apart from a path that never worked at all.
 *
 * The pair must have reached `succeeded` first; a path that never answered is ordinary establishment
 * failure and belongs to `IceEstablishmentFailedDetector`. Both counters are read as interval
 * deltas, and "we asked" counts consent as well as connectivity checks, since after nomination
 * consent is the only STUN still leaving. Timing is the transport's own `deltaTime`, so a stalled
 * main thread is not counted as silence. While a finding is open the transport is marked `blocked`.
 *
 * It does not claim which cause is at work, only that the path went silent under questioning.
 *
 * Issue raised: `blocked-stun-requests`. Monitor event: `blocked-transport`. Connection attribute:
 * `PeerConnectionMonitor.blockedTransport`. Config: `blockedStunRequestsDetector`.
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

		// Not applicable until a pair has answered once — which is not blindness, so the flag stays false.
		if (!pair || pair.state !== 'succeeded') {
			return this._silentForInMs !== undefined ? this._clear('ice has not verified this path') : undefined;
		}

		if (pair.deltaResponsesReceived === undefined) {
			this.inputsUnavailable = true;

			return this._silentForInMs !== undefined ? this._clear('stun responses are not reported') : undefined;
		}

		// Either counter alone proves some STUN went out, so only both missing is blindness.
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

		this.iceTransport.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload,
		});
	}

	/** Ends the silence window, resolving the issue if one was raised. */
	private _clear(comment: string) {
		this._silentForInMs = undefined;
		this._requestsSentWhileSilent = 0;

		if (this._raisedAt === undefined) return;

		this.iceTransport.blocked = false;

		const issue = this.iceTransport.issues.get(this._issueKey);

		if (issue) {
			this.iceTransport.issues.resolve({
				key: this._issueKey,
				comment,
				payload: { ...issue.payload, durationInMs: Date.now() - this._raisedAt } as BlockedTransportIssuePayload,
				resolvedAt: Date.now(),
			});
		}

		this._raisedAt = undefined;
	}

	private get _issueKey() {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${this.iceTransport.id}`;
	}
}
