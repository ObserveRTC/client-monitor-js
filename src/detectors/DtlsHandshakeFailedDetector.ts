import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export type DtlsHandshakeFailedIssuePayload = {
	peerConnectionId: string;
	transportId: string;
	dtlsState?: string;
	iceState?: string;
	selectedCandidatePairId?: string;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
};

const ISSUE_TYPE = 'dtls-handshake-failed';

/** No tunables — a terminal state needs no threshold. `{}` enables the detector, `null` disables it. */
export type DtlsHandshakeFailedDetectorConfig = Record<string, never>;

/**
 * Reports `dtlsState` reading `failed`: the secure transport refusing to come up over a network
 * path that works. Use it to separate this from an ICE failure one layer below — a mismatched
 * certificate fingerprint, a peer that speaks no offered DTLS version, a middlebox that passes
 * STUN and drops handshake records — where the whole class would otherwise present as a peer
 * connection generically slow to leave `connecting`.
 *
 * `failed` is terminal, so the issue is raised on the first tick that reports it, once per
 * transport. Only a later `connected` resolves it — in practice an ICE restart that re-keyed the
 * transport; a drop back to `new`/`connecting` is not yet evidence of anything.
 *
 * Raises `dtls-handshake-failed`. Emits `dtls-handshake-failed`.
 * Config: `dtlsHandshakeFailedDetector`.
 *
 * Category: Connectivity
 * Layer: 4 — Secure transport
 *
 */
export class DtlsHandshakeFailedDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'dtls-handshake-failed-detector';
	public disabled = false;
	public includeIssueInSample = true;

	/** Transport id → raise time. Only raised transports are in here. */
	private readonly _raisedAt = new Map<string, number>();

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.closed) return;

		for (const transport of this.peerConnection.iceTransports) {
			this._checkTransport(transport);
		}

		for (const transportId of [ ...this._raisedAt.keys() ]) {
			if (this.peerConnection.iceTransports.some((transport) => transport.id === transportId)) continue;

			this._resolve(transportId, 'ice transport is gone');
		}
	}

	private _checkTransport(transport: IceTransportMonitor) {
		const dtlsState = transport.dtlsState;

		if (dtlsState === 'connected') {
			// The only way out of `failed`: an ICE restart re-keyed the transport.
			return this._resolve(transport.id, 'dtls handshake completed');
		}

		if (dtlsState !== 'failed') return;
		if (this._raisedAt.has(transport.id)) return;

		this._raisedAt.set(transport.id, Date.now());

		const payload: DtlsHandshakeFailedIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			transportId: transport.id,
			dtlsState,
			iceState: transport.iceState,
			selectedCandidatePairId: transport.selectedCandidatePairId,
		};

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dtls-handshake-failed', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		this.peerConnection.issues.raise({
				key: this._issueKey(transport.id),
				includeInSample: this.includeIssueInSample,
				type: ISSUE_TYPE,
				payload,
			}
		);
	}

	private _resolve(transportId: string, comment: string) {
		const raisedAt = this._raisedAt.get(transportId);

		if (raisedAt === undefined) return;

		this._raisedAt.delete(transportId);

		const key = this._issueKey(transportId);
		const issue = this.peerConnection.issues.get(key);

		if (!issue) return;

		this.peerConnection.issues.resolve({
			key: key,
			comment,
			payload: {
				...(issue.payload as DtlsHandshakeFailedIssuePayload),
				durationInMs: Date.now() - raisedAt,
			},
			resolvedAt: Date.now(),
		});
	}

	private _issueKey(transportId: string) {
		return `${ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-transport-${transportId}`;
	}
}
