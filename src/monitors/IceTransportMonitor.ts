import { IceTransportStats } from "../schema/ClientSample";
import { BlockedStunRequestsDetector } from "../detectors/BlockedStunRequestsDetector";
import { Detectors } from "../detectors/Detectors";
import { positiveDelta } from "../utils/common";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class IceTransportMonitor implements IceTransportStats {
	private _visited = true;

	/**
	 * The detectors bound to this transport, run once per collection by
	 * `PeerConnectionMonitor`.
	 *
	 * A transport-level registry exists because some findings are about one transport
	 * rather than about the connection as a whole. Binding a detector here gives it
	 * plain per-transport state instead of a map keyed by transport id, and makes its
	 * lifecycle the transport's: a transport that is replaced gets a new monitor and
	 * with it a detector whose clocks start from zero, and one that goes away takes its
	 * detector with it rather than having to be swept for.
	 */
	public readonly detectors: Detectors;

	timestamp: number;
	id: string;
	packetsSent?: number | undefined;
	packetsReceived?: number | undefined;
	bytesSent?: number | undefined;
	bytesReceived?: number | undefined;
	iceRole?: string | undefined;
	iceLocalUsernameFragment?: string | undefined;
	dtlsState?: string | undefined;
	iceState?: string | undefined;
	selectedCandidatePairId?: string | undefined;
	localCertificateId?: string | undefined;
	remoteCertificateId?: string | undefined;
	tlsVersion?: string | undefined;
	dtlsCipher?: string | undefined;
	dtlsRole?: string | undefined;
	srtpCipher?: string | undefined;
	selectedCandidatePairChanges?: number | undefined;
	ccfbMessagesSent?: number | undefined;
	ccfbMessagesReceived?: number | undefined;

	deltaPacketsSent?: number | undefined;
	deltaPacketsReceived?: number | undefined;
	deltaBytesSent?: number | undefined;
	deltaBytesReceived?: number | undefined;
	sendingBitrate?: number | undefined;
	receivingBitrate?: number | undefined;
	/**
	 * How many times the browser switched the selected candidate pair since the
	 * previous tick, from the native `selectedCandidatePairChanges` counter
	 * (Chrome 80+, Firefox 155+; absent on Safari). `undefined` until the
	 * transport has had a selection: the spec counter also increments on the
	 * very first none → some selection, which is not churn.
	 */
	deltaSelectedCandidatePairChanges?: number | undefined;

	/**
	 * Milliseconds between this stats report and the previous one, taken from the
	 * reports' own `timestamp` fields rather than from when collection ran.
	 * Detectors asking "how long has this condition held" accumulate this rather
	 * than wall-clock elapsed: when a collection runs late or is skipped, this
	 * still measures the time the condition actually held underneath, instead of
	 * the time the library happened to spend not looking.
	 */
	deltaTime?: number | undefined;

	/**
	 * True once this transport has ever reached `connected` or `completed`, and
	 * never false again. It is what separates a path that never established from
	 * one that established and was then lost — two conditions with different
	 * causes and different fixes that `iceState === 'failed'` alone conflates.
	 */
	everConnected = false;

	/**
	 * True while `BlockedStunRequestsDetector` has an open finding on this transport:
	 * STUN requests keep going out and nothing comes back. Set when it raises, cleared
	 * when it resolves.
	 *
	 * It is stored here, on the transport it is a statement about, so that its lifetime
	 * is correct by construction. A transport that is replaced is dropped from the peer
	 * connection along with its detector, and the flag goes with it — nothing has to
	 * remember to reset it. `PeerConnectionMonitor.blockedTransport` folds this over the
	 * transports that currently exist, which is where callers should read it.
	 */
	public blocked = false;

	/**
	 * Additional data attached to this stats, will be shipped to the server
	 */
	attachments?: Record<string, unknown> | undefined;
	/**
	 * Additional data attached to this stats, will not be shipped to the server,
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: IceTransportStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;

		Object.assign(this, options);

		this.detectors = new Detectors();

		// Gated on its own config key, like every other detector: `null` leaves it
		// unregistered on every transport of every peer connection.
		if (_peerConnection.parent.config.blockedStunRequestsDetector !== null) {
			this.detectors.add(new BlockedStunRequestsDetector(this));
		}
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	/**
	 * Milliseconds of **stats time** this monitor has observed, accumulated from
	 * `deltaTime` — the clock every window and duration in the library is measured
	 * on, and the one thing `Date.now()` must never stand in for.
	 *
	 * It advances by what each collection actually cost rather than by one nominal
	 * period, so a late or skipped collection widens a window by the time the
	 * condition really held underneath. It never goes backwards and it is not a
	 * timestamp: only differences between two readings of it mean anything.
	 */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getSelectedCandidatePair() {
		return this._peerConnection.mappedIceCandidatePairMonitors.get(this.selectedCandidatePairId ?? '');
	}

	/**
	 * The RTP streams carried by this transport, by their `transportId`.
	 *
	 * A plain reference lookup, because `transportId` is spec-required on every RTP report
	 * and restoring it where a browser omits it is the stats adapters' job — they all run
	 * `inferTransportId()` before the monitors see anything. Re-deriving it here would put
	 * the same rule at two layers, and the monitor's copy would be the one nobody tests
	 * against real browser output.
	 */
	public getOutboundRtps() {
		return this._peerConnection.outboundRtps.filter((rtp) => rtp.transportId === this.id);
	}

	/** The inbound RTP streams carried by this transport. See `getOutboundRtps()`. */
	public getInboundRtps() {
		return this._peerConnection.inboundRtps.filter((rtp) => rtp.transportId === this.id);
	}

	/**
	 * The live `SelectedIcePath` of this transport, when one exists. Paths are
	 * keyed by the candidate pair's `pathKey`, which is the transport id for
	 * every native flow, so this resolves for anything but the pathless
	 * legacy fallbacks.
	 */
	public getSelectedIcePath() {
		return this._peerConnection.mappedSelectedIcePaths.get(this.id);
	}

	public accept(stats: Omit<IceTransportStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		const elapsedInSec = elapsedInMs / 1000;

		if (elapsedInMs <= 0) {
			return; // logger?
		}

		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;

		if (stats.iceState === 'connected' || stats.iceState === 'completed') {
			this.everConnected = true;
		}

		if (this.packetsSent !== undefined && stats.packetsSent !== undefined && this.packetsSent <= stats.packetsSent) {
			this.deltaPacketsSent = stats.packetsSent - this.packetsSent;
		} else {
			this.deltaPacketsSent = undefined;
		}
		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined && this.packetsReceived <= stats.packetsReceived) {
			this.deltaPacketsReceived = stats.packetsReceived - this.packetsReceived;
		} else {
			this.deltaPacketsReceived = undefined;
		}
		if (this.bytesSent !== undefined && stats.bytesSent !== undefined && this.bytesSent <= stats.bytesSent) {
			this.deltaBytesSent = stats.bytesSent - this.bytesSent;
			this.sendingBitrate = (this.deltaBytesSent * 8) / elapsedInSec;
		} else {
			this.deltaBytesSent = undefined;
			this.sendingBitrate = undefined;
		}
		if (this.bytesReceived !== undefined && stats.bytesReceived !== undefined && this.bytesReceived <= stats.bytesReceived) {
			this.deltaBytesReceived = stats.bytesReceived - this.bytesReceived;
			this.receivingBitrate = (this.deltaBytesReceived * 8) / elapsedInSec;
		} else {
			this.deltaBytesReceived = undefined;
			this.receivingBitrate = undefined;
		}

		// Only counted once the transport already had a selection: the spec counter
		// also increments going from no selected pair to having one (its very first
		// selection), and treating that as a switch would read every connection
		// setup as churn. A backwards counter (reset) yields `undefined`, never 0.
		this.deltaSelectedCandidatePairChanges = this.selectedCandidatePairId !== undefined
			? positiveDelta(stats.selectedCandidatePairChanges, this.selectedCandidatePairChanges)
			: undefined;

		Object.assign(this, stats);
	}

	public createSample(): IceTransportStats {
		// Constant after the handshake, so re-sending them every sample carries no
		// information: they are emitted in the first sample and again only when one
		// of them changes (the ufrag changes exactly at an ICE restart — a change
		// worth seeing). `sendIceTransportMetadataOnChangeOnly: false` restores the
		// legacy every-sample emission.
		const staticMetadata: Pick<IceTransportStats,
			'iceRole' | 'iceLocalUsernameFragment' | 'localCertificateId' | 'remoteCertificateId'
			| 'tlsVersion' | 'dtlsCipher' | 'dtlsRole' | 'srtpCipher'> = {
			iceRole: this.iceRole,
			iceLocalUsernameFragment: this.iceLocalUsernameFragment,
			localCertificateId: this.localCertificateId,
			remoteCertificateId: this.remoteCertificateId,
			tlsVersion: this.tlsVersion,
			dtlsCipher: this.dtlsCipher,
			dtlsRole: this.dtlsRole,
			srtpCipher: this.srtpCipher,
		};

		let sampledStaticMetadata: typeof staticMetadata | undefined = staticMetadata;

		if (this._peerConnection.parent.config.sendIceTransportMetadataOnChangeOnly) {
			const fingerprint = [
				this.iceRole, this.iceLocalUsernameFragment, this.localCertificateId, this.remoteCertificateId,
				this.tlsVersion, this.dtlsCipher, this.dtlsRole, this.srtpCipher,
			].join('|');

			if (this._sampledStaticMetadataFingerprint === fingerprint) {
				sampledStaticMetadata = undefined;
			} else {
				this._sampledStaticMetadataFingerprint = fingerprint;
			}
		}

		return {
			id: this.id,
			timestamp: this.timestamp,
			packetsSent: this.packetsSent,
			packetsReceived: this.packetsReceived,
			bytesSent: this.bytesSent,
			bytesReceived: this.bytesReceived,
			dtlsState: this.dtlsState,
			iceState: this.iceState,
			selectedCandidatePairId: this.selectedCandidatePairId,
			selectedCandidatePairChanges: this.selectedCandidatePairChanges,
			ccfbMessagesSent: this.ccfbMessagesSent,
			ccfbMessagesReceived: this.ccfbMessagesReceived,
			attachments: this.attachments,
			...(sampledStaticMetadata ?? {}),
		};
	}

	private _sampledStaticMetadataFingerprint?: string;

}