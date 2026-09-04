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

/**
 * `DtlsHandshakeFailedDetector` has no tunables — a terminal state needs no threshold, so there is
 * nothing to move. The type exists so the detector can be disabled on its own: `{}` enables it,
 * `null` disables it.
 */
export type DtlsHandshakeFailedDetectorConfig = Record<string, never>;

/**
 * Reports the secure transport itself refusing to come up: `dtlsState` reads
 * `failed`. The ICE detectors own "the network path failed"; this owns the
 * failure one layer above it, where a path that works carries a handshake that
 * does not — a certificate fingerprint that does not match what was signalled,
 * a peer that will not speak a DTLS version this one offers, or a middlebox
 * that lets the small well-known STUN packets through and drops the handshake
 * records. Without this the whole class presents as a peer connection that is
 * generically slow to leave `connecting`, and every one of those causes points
 * at a different fix.
 *
 * There is nothing to wait for and nothing to average: `failed` is the
 * browser's terminal verdict on this key exchange, so the issue is raised on
 * the first tick that reports it, with no maturity guard and no duration
 * threshold. It is raised once per transport rather than once per tick, since
 * the state stays `failed` until something re-keys the transport.
 *
 * Only a later `connected` resolves it, which in practice means an ICE restart
 * re-ran the handshake and the new generation succeeded. A transport that drops
 * back to `new`/`connecting` after the restart is not yet evidence of anything —
 * the second handshake may fail exactly like the first — so the issue stays open
 * until one actually completes, or until the transport disappears.
 *
 * Raises `dtls-handshake-failed`. Emits `dtls-handshake-failed`.
 * Config: `dtlsHandshakeFailedDetector` — `{}` registers this detector, `null`
 * leaves it unregistered. The block holds no values: `failed` is not a matter of
 * degree, so there is nothing here to tune. `DtlsHandshakeStalledDetector` has
 * its own key and its own `stalledThresholdInMs`.
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

	/** Transport id → when this detector raised the issue for it. Only raised transports are in here. */
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
			// A handshake that completed: the only way out of `failed`, and it takes an
			// ICE restart re-keying the transport to get here.
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

		clientMonitor.raiseIssue<DtlsHandshakeFailedIssuePayload>(
			this._issueKey(transport.id),
			{
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

		const clientMonitor = this.peerConnection.parent;
		const key = this._issueKey(transportId);
		const issue = clientMonitor.activeIssues.get(key);

		if (!issue) return;

		clientMonitor.resolveIssue<DtlsHandshakeFailedIssuePayload>(key, {
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
