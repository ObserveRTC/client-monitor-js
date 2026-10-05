import type { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { ClientMetaTypes } from "../schema/ClientMetaTypes";
import {
	directionReceives,
	directionSends,
	parseSdp,
	ParsedSdp,
	redactSdp,
	SdpCodec,
	SdpDirection,
	SdpMediaSection,
} from "../utils/sdp";

/** What `RTCPeerConnection.localDescription` / `remoteDescription` hand out, or what signaling carries. */
export type SdpDescriptionInput = {
	type: RTCSdpType | string;
	sdp?: string;
};

/** One accepted description: the raw SDP and what was read out of it. */
export type SdpDescription = {
	type: string;
	sdp: string;
	parsed: ParsedSdp;
	acceptedAt: number;
}

/**
 * One media section as the two descriptions settled it, from this endpoint's point of view.
 * Built only once an offer from one side is paired with an answer (or pranswer) from the other.
 */
export type SdpNegotiatedMediaSection = {
	mid?: string;
	kind: string;
	localDirection: SdpDirection;
	remoteDirection: SdpDirection;
	/** This endpoint sends on it: it offered or accepted sending, and the far end receives. */
	sending: boolean;
	/** This endpoint receives on it. */
	receiving: boolean;
	/** The section was rejected (port 0 in the answer). */
	rejected: boolean;
	/** The answer's codec list, in its preference order, as mime types. */
	codecs: string[];
	/** The first codec that is not a repair format (`rtx`, `red`, `ulpfec`, `flexfec-03`), or undefined. */
	primaryCodec?: string;
	/**
	 * Opus `usedtx=1` in the far end's description: the far end asked this endpoint to send with DTX.
	 * A preference, not a guarantee — the encoder decides.
	 */
	sendDtx: boolean;
	/** Opus `usedtx=1` in this endpoint's description: it asked the far end to send with DTX. */
	receiveDtx: boolean;
	/** Opus `useinbandfec=1` in the far end's description. */
	sendInbandFec: boolean;
	/** Opus `useinbandfec=1` in this endpoint's description. */
	receiveInbandFec: boolean;
	/** `red` is in the answer's codec list for this section. */
	red: boolean;
	/** `transport-cc` feedback negotiated on the primary codec. */
	transportCc: boolean;
	/** Simulcast layers this endpoint sends (`a=rid ... send`, or an `ssrc-group:SIM`), `0` if none. */
	sendSimulcastLayers: number;
}

const REPAIR_FORMATS = new Set([ 'rtx', 'red', 'ulpfec', 'flexfec-03' ]);

const encodingOf = (mimeType: string) => (mimeType.split('/')[1] ?? '').toLowerCase();

const findOpus = (section?: SdpMediaSection): SdpCodec | undefined =>
	section?.codecs.find((codec) => encodingOf(codec.mimeType) === 'opus');

const isAnswer = (description?: SdpDescription) =>
	description?.type === 'answer' || description?.type === 'pranswer';

/**
 * Tracks the local and remote session descriptions of one peer connection, reads the facts the
 * stats API does not carry — DTX, in-band FEC, RED, simulcast, ICE lite, DTLS role, BUNDLE — and
 * publishes them on its {@link PeerConnectionMonitor}.
 *
 * It is fed, not bound: the application (or a source binding) calls `acceptLocalDescription` /
 * `acceptRemoteDescription` with the description it applied — normally through
 * `ClientMonitor.acceptLocalDescription(peerConnectionId, description)`. Each accepted description
 * is also added to the next sample as `LOCAL_SDP` / `REMOTE_SDP` metadata when the monitor's
 * `sendSdpMetadataToServer` is on (off by default), with `a=ice-pwd` redacted; one identical to the previous description on the same side is not added twice.
 *
 * It trusts what it is given. A description that was rejected by `setLocalDescription` or rolled
 * back is still read as applied, so accept a description after the call that applied it resolved.
 */
export class SdpMonitor {
	public localDescription?: SdpDescription;
	public remoteDescription?: SdpDescription;

	/** How many local / remote descriptions have been accepted, duplicates excluded. */
	public localDescriptionsCount = 0;
	public remoteDescriptionsCount = 0;

	/** Per media section, as the last complete offer/answer settled it. Empty until one completes. */
	public negotiatedMediaSections: SdpNegotiatedMediaSection[] = [];

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
	) {
	}

	public acceptLocalDescription(description: SdpDescriptionInput): SdpDescription | undefined {
		const accepted = this._accept(description, this.localDescription);

		if (!accepted) return undefined;

		this.localDescription = accepted;
		++this.localDescriptionsCount;
		this._report(ClientMetaTypes.LOCAL_SDP, accepted);
		this._update();

		return accepted;
	}

	public acceptRemoteDescription(description: SdpDescriptionInput): SdpDescription | undefined {
		const accepted = this._accept(description, this.remoteDescription);

		if (!accepted) return undefined;

		this.remoteDescription = accepted;
		++this.remoteDescriptionsCount;
		this._report(ClientMetaTypes.REMOTE_SDP, accepted);
		this._update();

		return accepted;
	}

	/** `offerer` when this endpoint's side of the last completed negotiation was the offer. */
	public get negotiationRole(): 'offerer' | 'answerer' | undefined {
		if (!this.localDescription || !this.remoteDescription) return undefined;
		if (isAnswer(this.localDescription) && this.remoteDescription.type === 'offer') return 'answerer';
		if (isAnswer(this.remoteDescription) && this.localDescription.type === 'offer') return 'offerer';

		return undefined;
	}

	private _accept(description: SdpDescriptionInput, previous?: SdpDescription): SdpDescription | undefined {
		if (this._peerConnection.closed) return undefined;
		// A rollback carries no SDP of its own; there is nothing to read.
		if (!description?.sdp || description.type === 'rollback') return undefined;
		if (previous && previous.type === description.type && previous.sdp === description.sdp) return undefined;

		return {
			type: description.type,
			sdp: description.sdp,
			parsed: parseSdp(description.sdp),
			acceptedAt: Date.now(),
		};
	}

	private _report(type: ClientMetaTypes, description: SdpDescription) {
		if (this._peerConnection.parent.config.sendSdpMetadataToServer !== true) return;

		this._peerConnection.parent.addMetaData({
			type,
			payload: {
				peerConnectionId: this._peerConnection.peerConnectionId,
				type: description.type,
				sdp: redactSdp(description.sdp),
			},
			timestamp: description.acceptedAt,
		});
	}

	private _update() {
		const pc = this._peerConnection;
		const local = this.localDescription?.parsed;
		const remote = this.remoteDescription?.parsed;
		const role = this.negotiationRole;

		// Facts of one side alone are published as soon as that side is known.
		pc.remoteIceLite = remote?.iceLite;
		pc.localIceLite = local?.iceLite;

		if (!local || !remote || !role) return;

		const answer = role === 'offerer' ? remote : local;

		this.negotiatedMediaSections = this._negotiate(local, remote, answer);
		pc.negotiationRole = role;
		pc.dtlsRole = this._dtlsRole(role, answer);
		pc.bundled = this._bundled(answer);
		this._publishSummary();
	}

	private _negotiate(local: ParsedSdp, remote: ParsedSdp, answer: ParsedSdp): SdpNegotiatedMediaSection[] {
		const matchOf = (sections: SdpMediaSection[], section: SdpMediaSection, index: number) =>
			(section.mid !== undefined ? sections.find((s) => s.mid === section.mid) : undefined) ?? sections[index];

		return answer.mediaSections.map((answerSection, index) => {
			const localSection = matchOf(local.mediaSections, answerSection, index);
			const remoteSection = matchOf(remote.mediaSections, answerSection, index);
			const localDirection = localSection?.direction ?? 'inactive';
			const remoteDirection = remoteSection?.direction ?? 'inactive';
			const rejected = answerSection.port === 0;
			const sending = !rejected && directionSends(localDirection) && directionReceives(remoteDirection);
			const receiving = !rejected && directionReceives(localDirection) && directionSends(remoteDirection);
			const primary = answerSection.codecs.find((codec) => !REPAIR_FORMATS.has(encodingOf(codec.mimeType)));
			const localOpus = findOpus(localSection);
			const remoteOpus = findOpus(remoteSection);
			const simulcastRids = localSection?.rids.filter((rid) => rid.direction === 'send').length ?? 0;
			const simGroup = localSection?.ssrcGroups.find((group) => group.semantics === 'SIM')?.ssrcs.length ?? 0;

			return {
				mid: answerSection.mid,
				kind: answerSection.kind,
				localDirection,
				remoteDirection,
				sending,
				receiving,
				rejected,
				codecs: answerSection.codecs.map((codec) => codec.mimeType),
				primaryCodec: primary?.mimeType,
				sendDtx: sending && remoteOpus?.parameters.usedtx === '1',
				receiveDtx: receiving && localOpus?.parameters.usedtx === '1',
				sendInbandFec: sending && remoteOpus?.parameters.useinbandfec === '1',
				receiveInbandFec: receiving && localOpus?.parameters.useinbandfec === '1',
				red: answerSection.codecs.some((codec) => encodingOf(codec.mimeType) === 'red'),
				transportCc: primary?.rtcpFeedback.includes('transport-cc') ?? false,
				sendSimulcastLayers: sending ? Math.max(simulcastRids, simGroup) : 0,
			};
		});
	}

	/** RFC 8842: the answerer's `active` makes it the DTLS client, `passive` the server. */
	private _dtlsRole(role: 'offerer' | 'answerer', answer: ParsedSdp): 'client' | 'server' | undefined {
		const setup = answer.mediaSections.find((section) => section.setup)?.setup ?? answer.setup;

		if (setup !== 'active' && setup !== 'passive') return undefined;

		const answererIsClient = setup === 'active';

		return (role === 'answerer') === answererIsClient ? 'client' : 'server';
	}

	private _bundled(answer: ParsedSdp): boolean {
		const mids = answer.mediaSections
			.filter((section) => section.port !== 0 && section.mid !== undefined)
			.map((section) => section.mid as string);

		return 0 < mids.length && answer.bundleGroups.some((group) => mids.every((mid) => group.includes(mid)));
	}

	private _publishSummary() {
		const pc = this._peerConnection;
		const audio = this.negotiatedMediaSections.filter((section) => section.kind === 'audio' && !section.rejected);
		const video = this.negotiatedMediaSections.filter((section) => section.kind === 'video' && !section.rejected);
		const unique = (values: (string | undefined)[]) =>
			[ ...new Set(values.filter((value): value is string => value !== undefined)) ];

		pc.negotiatedAudioCodecs = unique(audio.map((section) => section.primaryCodec));
		pc.negotiatedVideoCodecs = unique(video.map((section) => section.primaryCodec));
		pc.sendingAudioDtx = audio.some((section) => section.sendDtx);
		pc.receivingAudioDtx = audio.some((section) => section.receiveDtx);
		pc.sendingAudioInbandFec = audio.some((section) => section.sendInbandFec);
		pc.receivingAudioInbandFec = audio.some((section) => section.receiveInbandFec);
		pc.audioRedNegotiated = audio.some((section) => section.red);
		pc.sendingSimulcast = video.some((section) => 1 < section.sendSimulcastLayers);
	}
}
