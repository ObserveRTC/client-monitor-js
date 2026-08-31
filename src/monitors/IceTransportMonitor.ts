import { IceTransportStats } from "../schema/ClientSample";
import { positiveDelta } from "../utils/common";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class IceTransportMonitor implements IceTransportStats {
	private _visited = true;

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
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getSelectedCandidatePair() {
		return this._peerConnection.mappedIceCandidatePairMonitors.get(this.selectedCandidatePairId ?? '');
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