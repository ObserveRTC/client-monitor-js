/**
 * A deliberately small SDP reader: it pulls out the facts the monitor can use and ignores the rest.
 * Not a general SDP library — no serialisation, no validation beyond what reading needs, and any
 * line it does not recognise is skipped rather than rejected, so a browser adding attributes never
 * breaks parsing.
 */

export type SdpDirection = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';

export type SdpSetupRole = 'actpass' | 'active' | 'passive' | 'holdconn';

export type SdpCodec = {
	payloadType: number;
	/** `kind/encoding`, as the stats API spells it: `audio/opus`, `video/VP8`, `video/rtx`. */
	mimeType: string;
	clockRate?: number;
	channels?: number;
	/** The raw `a=fmtp` value, comparable with `CodecStats.sdpFmtpLine`. */
	sdpFmtpLine?: string;
	/** `a=fmtp` split into key/value pairs; keys lower-cased. */
	parameters: Record<string, string>;
	/** `a=rtcp-fb` values for this payload type (and for `*`), e.g. `nack`, `nack pli`, `transport-cc`. */
	rtcpFeedback: string[];
}

export type SdpMediaSection = {
	kind: string;
	mid?: string;
	/** `0` on a rejected or stopped section. */
	port: number;
	protocol: string;
	direction: SdpDirection;
	/** In m-line order, which is the sender's preference order. */
	codecs: SdpCodec[];
	extensions: { id: number, uri: string }[];
	ssrcs: number[];
	ssrcGroups: { semantics: string, ssrcs: number[] }[];
	rids: { id: string, direction: 'send' | 'recv' }[];
	/** Raw `a=simulcast` value, when present. */
	simulcast?: string;
	rtcpMux: boolean;
	rtcpRsize: boolean;
	setup?: SdpSetupRole;
	/** `b=AS` in kbps, when present. */
	bandwidthAsInKbps?: number;
	/** `b=TIAS` in bps, when present. */
	bandwidthTiasInBps?: number;
}

export type ParsedSdp = {
	/** Session version from the `o=` line; it increases with every change the endpoint makes. */
	sessionVersion?: number;
	iceLite: boolean;
	iceOptions: string[];
	/** `a=group:BUNDLE` groups, each a list of mids. */
	bundleGroups: string[][];
	extmapAllowMixed: boolean;
	/** Session-level `a=setup`, which media-level values override. */
	setup?: SdpSetupRole;
	mediaSections: SdpMediaSection[];
}

const DIRECTIONS = new Set<string>([ 'sendrecv', 'sendonly', 'recvonly', 'inactive' ]);
const SETUP_ROLES = new Set<string>([ 'actpass', 'active', 'passive', 'holdconn' ]);

function parseFmtpParameters(value: string): Record<string, string> {
	const result: Record<string, string> = {};

	for (const part of value.split(';')) {
		const trimmed = part.trim();

		if (!trimmed) continue;

		const eq = trimmed.indexOf('=');

		if (eq < 0) result[trimmed.toLowerCase()] = '';
		else result[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim();
	}

	return result;
}

function toInt(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;

	const parsed = Number.parseInt(value, 10);

	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parses an SDP blob. Never throws; an empty or malformed input yields an empty description. */
export function parseSdp(sdp: string): ParsedSdp {
	const result: ParsedSdp = {
		iceLite: false,
		iceOptions: [],
		bundleGroups: [],
		extmapAllowMixed: false,
		mediaSections: [],
	};
	let section: SdpMediaSection | undefined;
	let codecsByPt = new Map<number, SdpCodec>();
	let wildcardFeedback: string[] = [];

	const closeSection = () => {
		if (!section) return;

		for (const codec of section.codecs) codec.rtcpFeedback.push(...wildcardFeedback);
		result.mediaSections.push(section);
	};

	for (const rawLine of sdp.split(/\r?\n/)) {
		const line = rawLine.trim();

		if (line.length < 2 || line[1] !== '=') continue;

		const letter = line[0];
		const value = line.slice(2);

		if (letter === 'o') {
			result.sessionVersion = toInt(value.split(' ')[2]);
			continue;
		}
		if (letter === 'm') {
			closeSection();

			const [ kind = '', port, protocol = '', ...formats ] = value.split(' ');

			codecsByPt = new Map();
			wildcardFeedback = [];
			section = {
				kind,
				port: toInt(port) ?? 0,
				protocol,
				direction: 'sendrecv',
				codecs: [],
				extensions: [],
				ssrcs: [],
				ssrcGroups: [],
				rids: [],
				rtcpMux: false,
				rtcpRsize: false,
			};
			for (const format of formats) {
				const payloadType = toInt(format);

				if (payloadType === undefined) continue;

				const codec: SdpCodec = { payloadType, mimeType: `${kind}/unknown`, parameters: {}, rtcpFeedback: [] };

				codecsByPt.set(payloadType, codec);
				section.codecs.push(codec);
			}
			continue;
		}
		if (letter === 'b' && section) {
			const [ type, amount ] = value.split(':');

			if (type === 'AS') section.bandwidthAsInKbps = toInt(amount);
			else if (type === 'TIAS') section.bandwidthTiasInBps = toInt(amount);
			continue;
		}
		if (letter !== 'a') continue;

		const colon = value.indexOf(':');
		const name = colon < 0 ? value : value.slice(0, colon);
		const attr = colon < 0 ? '' : value.slice(colon + 1);

		if (!section) {
			// Session level.
			if (name === 'ice-lite') result.iceLite = true;
			else if (name === 'ice-options') result.iceOptions = attr.split(' ').filter(Boolean);
			else if (name === 'extmap-allow-mixed') result.extmapAllowMixed = true;
			else if (name === 'setup' && SETUP_ROLES.has(attr)) result.setup = attr as SdpSetupRole;
			else if (name === 'group') {
				const [ semantics, ...mids ] = attr.split(' ');

				if (semantics === 'BUNDLE') result.bundleGroups.push(mids.filter(Boolean));
			}
			continue;
		}

		if (DIRECTIONS.has(name)) {
			section.direction = name as SdpDirection;
			continue;
		}

		switch (name) {
			case 'mid':
				section.mid = attr;
				break;
			case 'rtcp-mux':
				section.rtcpMux = true;
				break;
			case 'rtcp-rsize':
				section.rtcpRsize = true;
				break;
			case 'setup':
				if (SETUP_ROLES.has(attr)) section.setup = attr as SdpSetupRole;
				break;
			case 'simulcast':
				section.simulcast = attr;
				break;
			case 'ice-options':
				// Media-level ice-options apply to the whole bundle in practice.
				if (result.iceOptions.length === 0) result.iceOptions = attr.split(' ').filter(Boolean);
				break;
			case 'rtpmap': {
				const [ pt, encoding = '' ] = attr.split(' ');
				const codec = codecsByPt.get(toInt(pt) ?? -1);

				if (!codec) break;

				const [ encodingName = 'unknown', clockRate, channels ] = encoding.split('/');

				codec.mimeType = `${section.kind}/${encodingName}`;
				codec.clockRate = toInt(clockRate);
				codec.channels = toInt(channels);
				break;
			}
			case 'fmtp': {
				const space = attr.indexOf(' ');
				const codec = codecsByPt.get(toInt(attr.slice(0, space)) ?? -1);

				if (!codec || space < 0) break;

				codec.sdpFmtpLine = attr.slice(space + 1).trim();
				codec.parameters = parseFmtpParameters(codec.sdpFmtpLine);
				break;
			}
			case 'rtcp-fb': {
				const space = attr.indexOf(' ');

				if (space < 0) break;

				const pt = attr.slice(0, space);
				const feedback = attr.slice(space + 1).trim();

				if (pt === '*') wildcardFeedback.push(feedback);
				else codecsByPt.get(toInt(pt) ?? -1)?.rtcpFeedback.push(feedback);
				break;
			}
			case 'extmap': {
				const [ idAndDirection = '', uri ] = attr.split(' ');
				const id = toInt(idAndDirection.split('/')[0]);

				if (id !== undefined && uri) section.extensions.push({ id, uri });
				break;
			}
			case 'ssrc': {
				const ssrc = toInt(attr.split(' ')[0]);

				if (ssrc !== undefined && !section.ssrcs.includes(ssrc)) section.ssrcs.push(ssrc);
				break;
			}
			case 'ssrc-group': {
				const [ semantics = '', ...ssrcs ] = attr.split(' ');

				section.ssrcGroups.push({
					semantics,
					ssrcs: ssrcs.map((s) => toInt(s)).filter((s): s is number => s !== undefined),
				});
				break;
			}
			case 'rid': {
				const [ id, direction ] = attr.split(' ');

				if (id && (direction === 'send' || direction === 'recv')) section.rids.push({ id, direction });
				break;
			}
		}
	}
	closeSection();

	return result;
}

/**
 * The SDP with credentials removed, for shipping: `a=ice-pwd` values are replaced. The ICE password
 * is a live credential for as long as the session lasts; nothing the monitor reports needs it.
 */
export function redactSdp(sdp: string): string {
	return sdp.replace(/^(a=ice-pwd:).*$/gm, '$1<redacted>');
}

/** Whether a direction includes sending (`send` side) or receiving. */
export const directionSends = (direction?: SdpDirection) => direction === 'sendrecv' || direction === 'sendonly';
export const directionReceives = (direction?: SdpDirection) => direction === 'sendrecv' || direction === 'recvonly';
