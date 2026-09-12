import { IssueRegistry } from "../utils/IssueRegistry";
import { IceTransportStats } from "../schema/ClientSample";
import { BlockedStunRequestsDetector, BlockedTransportIssuePayload } from "../detectors/BlockedStunRequestsDetector";
import { Detectors } from "../detectors/Detectors";
import { positiveDelta } from "../utils/common";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

/**
 * Every issue a ICE transport can carry, keyed by the detector that raises it. This is what
 * `issues` is typed to, so a detector cannot raise a type this monitor has no business reporting,
 * and adding a detector without adding it here fails to compile at that detector's `raise`.
 */
export type IceTransportIssues = {
	[BlockedStunRequestsDetector.ISSUE_TYPE]: BlockedTransportIssuePayload,
}

export class IceTransportMonitor implements IceTransportStats {
	private _visited = true;

	/**
	 * Detectors whose findings are about this one transport, run once per collection by
	 * `PeerConnectionMonitor`. Binding them here ties their state and lifetime to the transport.
	 */
	public readonly detectors: Detectors;

	/**
	 * This ICE transport's own active issues, uplinked into its peer connection's registry. Its
	 * detectors raise, update and resolve here and nowhere else — writes travel up, so a
	 * resolution sent straight to a higher layer would leave this copy standing forever.
	 */
	public readonly issues: IssueRegistry<IceTransportIssues>;

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
	 * How many times the browser switched the selected candidate pair since the previous tick.
	 * `undefined` until the transport has had a selection, since the first one is not churn.
	 */
	deltaSelectedCandidatePairChanges?: number | undefined;

	/** Milliseconds since the previous stats report, from the reports' own timestamps. */
	deltaTime?: number | undefined;

	/**
	 * True once this transport has ever reached `connected` or `completed`, never false again.
	 * Separates a path that never established from one that established and was then lost.
	 */
	everConnected = false;

	/**
	 * True while STUN requests keep going out on this transport and nothing comes back.
	 * `PeerConnectionMonitor.blockedTransport` folds this over the live transports, and is
	 * where callers should read it.
	 */
	public blocked = false;

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: IceTransportStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;

		Object.assign(this, options);

		this.issues = new IssueRegistry<IceTransportIssues>(
			this._peerConnection.issues.asSink,
		);
		this.detectors = new Detectors();

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
	 * Milliseconds of stats time this monitor has observed, accumulated from `deltaTime`.
	 * Every window and duration in the library is measured on this clock, never on `Date.now()`;
	 * it is not a timestamp, so only differences between two readings mean anything.
	 */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getSelectedCandidatePair() {
		return this._peerConnection.mappedIceCandidatePairMonitors.get(this.selectedCandidatePairId ?? '');
	}

	/**
	 * The outbound RTP streams carried by this transport. A plain `transportId` lookup:
	 * restoring the id where a browser omits it is the stats adapters' job, not this one's.
	 */
	public getOutboundRtps() {
		return this._peerConnection.outboundRtps.filter((rtp) => rtp.transportId === this.id);
	}

	/** The inbound RTP streams carried by this transport. See `getOutboundRtps()`. */
	public getInboundRtps() {
		return this._peerConnection.inboundRtps.filter((rtp) => rtp.transportId === this.id);
	}

	/** The live `SelectedIcePath` of this transport, when one exists. */
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

		// Only counted once the transport already had a selection: the counter also increments
		// on the first one, and treating that as a switch would read every setup as churn.
		this.deltaSelectedCandidatePairChanges = this.selectedCandidatePairId !== undefined
			? positiveDelta(stats.selectedCandidatePairChanges, this.selectedCandidatePairChanges)
			: undefined;

		Object.assign(this, stats);
	}

	public createSample(): IceTransportStats {
		// Constant after the handshake, so emitted in the first sample and again only on change
		// (the ufrag changes exactly at an ICE restart).
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