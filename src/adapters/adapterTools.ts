/* eslint-disable @typescript-eslint/no-explicit-any */
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import * as W3C from "../schema/W3cStatsIdentifiers";

/**
 * Shared building blocks for the per-browser stats adapters. Each helper
 * fixes one class of deviation from the W3C webrtc-stats spec; the browser
 * adapters compose the ones their browser needs.
 *
 * Adapters do three things and no more:
 *
 * 1. **fold** a value into the standard field it provably belongs to (a
 *    renamed member, a legacy report that carries the same measurement),
 *    removing the duplicate afterwards,
 * 2. **infer references** — the `*Id` fields that wire one report to another,
 * 3. **map** a legacy enum spelling onto the value the spec (and the
 *    monitors) accept.
 *
 * Inferring a reference is safe where computing a measurement is not: a
 * reference is a structural link, and the report graph either determines it
 * or it doesn't. When it is ambiguous the field is left unset rather than
 * guessed. A *measured* value is never invented — an approximated number is
 * indistinguishable downstream from one the browser actually reported, and a
 * detector cannot tell that it is judging a guess.
 *
 * Nothing is thrown away except a value that survives elsewhere: a member
 * folded into its standard name, or a legacy report whose contents were
 * relocated. Members the spec dropped but a browser still fills — a candidate
 * pair's `priority`, Chromium's `contentType`, Firefox's `selected` — are
 * left on the stat. Monitors copy through whatever they receive, so those
 * remain visible for investigation, and removing them would only destroy
 * information the browser handed us.
 *
 * Everything feature-detects from the stats themselves rather than parsing
 * browser versions, so an adapter applied to an already-conformant report is
 * a no-op.
 *
 * **When to add a version-scoped adapter.** Almost never, and specifically
 * not for "this field only exists from version N" — that is what the
 * `undefined` checks here already handle, which is why one adapter per browser
 * covers every version in the field. Reach for a version gate only when the
 * report cannot tell you: the same field, present in every version, *meaning*
 * something different in a range — a unit change, a counter switching from
 * monotonic to per-interval, a value that is actively wrong in known builds.
 * There is nothing to detect in those cases, so the version is the only
 * signal. Prefer the data whenever it can answer: a reported user-agent
 * version is the less trustworthy of the two, since Edge/Opera/Brave lag
 * Chromium and do not report its version, WebViews version themselves oddly,
 * and UA reduction freezes minor versions.
 *
 * When one is genuinely needed, add it *alongside* the browser adapter in
 * `Sources.addStatsAdapters`, which already has `monitor.browser.name` and
 * `.version`, rather than gating inside the shared code:
 *
 * ```typescript
 * case 'firefox': {
 *     pcMonitor.statsAdapters.add(new FirefoxStatsAdapter());
 *     if (majorVersion < 142) pcMonitor.statsAdapters.add(new FirefoxJitterUnitsAdapter());
 *     break;
 * }
 * ```
 *
 * Name it after the deviation it corrects, not the version that introduced it.
 * `FirefoxJitterUnitsAdapter` still says what it does after the next boundary
 * moves; a name like `Firefox94StatsAdapter` (this library's former one, which
 * despite the name ran on every Firefox) says nothing at all.
 */

/**
 * Folds a legacy member into its standard name: fills the standard field when
 * it is absent, then removes the duplicate. The value always survives.
 */
export function foldField(stat: any, legacyField: string, standardField: string): void {
	if (stat[legacyField] === undefined) return;
	if (stat[standardField] === undefined) stat[standardField] = stat[legacyField];

	delete stat[legacyField];
}

/**
 * `mediaType` is the pre-2021 name of `kind` and every engine still emits it
 * on RTP stream stats.
 */
export function foldMediaTypeIntoKind(stat: any): void {
	foldField(stat, 'mediaType', 'kind');
}

const RTP_STREAM_TYPES: readonly string[] = [
	W3C.StatsType.inboundRtp,
	W3C.StatsType.outboundRtp,
	W3C.StatsType.remoteInboundRtp,
	W3C.StatsType.remoteOutboundRtp,
];

export function isRtpStreamStats(stat: RtcStats): boolean {
	return RTP_STREAM_TYPES.includes(stat.type);
}

/**
 * Members the deprecated `track` report carried that the spec since moved
 * onto `inbound-rtp` — the same measurement under the same name, so folding
 * them is a relocation, not a derivation. Copied only when the RTP report
 * doesn't already have the field, so a browser that provides both keeps the
 * fresher RTP value.
 */
const TRACK_TO_INBOUND_FIELDS: readonly string[] = [
	'trackIdentifier',
	'framesReceived',
	'framesDropped',
	'frameWidth',
	'frameHeight',
	'freezeCount',
	'totalFreezesDuration',
	'pauseCount',
	'totalPausesDuration',
	'audioLevel',
	'totalAudioEnergy',
	'totalSamplesDuration',
	'jitterBufferDelay',
	'jitterBufferEmittedCount',
];

/**
 * Folds the deprecated `track` (and drops the deprecated `stream`) reports —
 * still emitted by Safari ≤ 16 and Chrome ≤ M111 — into the standard shape:
 * the fields the spec moved to `inbound-rtp` are copied onto the referencing
 * report (most importantly `trackIdentifier`, without which the monitor
 * cannot bind the stream to a `MediaStreamTrack` at all), the now-dangling
 * `trackId` reference is removed, and the deprecated reports are dropped.
 *
 * Returns a filtered array; the input array is not modified in length.
 */
export function foldLegacyTrackStats(stats: RtcStats[]): RtcStats[] {
	let trackReports: Map<string, any> | undefined;

	for (const stat of stats) {
		if (stat.type === W3C.StatsType.track) {
			(trackReports ??= new Map()).set(stat.id, stat);
		}
	}

	if (!trackReports) {
		// no legacy reports: only drop `stream` leftovers if any slipped through
		return stats.some((stat) => stat.type === W3C.StatsType.stream)
			? stats.filter((stat) => stat.type !== W3C.StatsType.stream)
			: stats;
	}

	for (const stat of stats) {
		const raw = stat as any;

		if (raw.trackId === undefined) continue;
		if (stat.type !== W3C.StatsType.inboundRtp && stat.type !== W3C.StatsType.outboundRtp) continue;

		const track = trackReports.get(raw.trackId);

		if (track) {
			if (stat.type === W3C.StatsType.inboundRtp) {
				for (const field of TRACK_TO_INBOUND_FIELDS) {
					if (raw[field] === undefined && track[field] !== undefined) raw[field] = track[field];
				}
			}
			// the spec links outbound-rtp to its track via media-source; keep the
			// identifier reachable for browsers that lack media-source stats too
			if (raw.trackIdentifier === undefined && track.trackIdentifier !== undefined) {
				raw.trackIdentifier = track.trackIdentifier;
			}
		}

		delete raw.trackId;
	}

	return stats.filter((stat) => stat.type !== W3C.StatsType.track && stat.type !== W3C.StatsType.stream);
}

/**
 * Restores `outbound-rtp.mediaSourceId` for browsers that omit it (Firefox
 * never emits it). The reference is what links a sent stream to the source
 * feeding it, and from there to the `MediaStreamTrack` — without it outbound
 * track monitoring cannot start at all.
 *
 * Resolved by `trackIdentifier` when the outbound report carries one, else by
 * kind when exactly one media source of that kind exists — with a single
 * camera or microphone that is a certainty, and simulcast encodings of the
 * same source all resolve to it. With several sources of one kind (camera +
 * screen share) the report does not determine the link, so it is left unset.
 */
export function inferOutboundMediaSourceId(stats: RtcStats[]): void {
	let mediaSources: any[] | undefined;

	for (const stat of stats) {
		if (stat.type !== W3C.StatsType.outboundRtp) continue;
		const outbound = stat as any;

		if (outbound.mediaSourceId !== undefined) continue;

		mediaSources ??= stats.filter((candidate) => candidate.type === W3C.StatsType.mediaSource);

		let source: any | undefined;

		if (outbound.trackIdentifier !== undefined) {
			source = mediaSources.find((mediaSource) => mediaSource.trackIdentifier === outbound.trackIdentifier);
		}

		if (!source) {
			const sameKind = mediaSources.filter((mediaSource) => mediaSource.kind === outbound.kind);

			if (sameKind.length === 1) source = sameKind[0];
		}

		if (source) outbound.mediaSourceId = source.id;
	}
}

/** Report types that carry a `transportId` reference in the spec. */
const TRANSPORT_REFERRING_TYPES: readonly string[] = [
	W3C.StatsType.inboundRtp,
	W3C.StatsType.outboundRtp,
	W3C.StatsType.remoteInboundRtp,
	W3C.StatsType.remoteOutboundRtp,
	W3C.StatsType.codec,
	W3C.StatsType.candidatePair,
	W3C.StatsType.localCandidate,
	W3C.StatsType.remoteCandidate,
];

/**
 * Restores the `transportId` reference for browsers that omit it (Firefox
 * before 153 on every RTP report, Safari through 17.3 on `codec`). It is what
 * links a stream or candidate to its ICE transport, and therefore to the
 * connection-level view of the call.
 *
 * Only applied when the report contains exactly one transport — with BUNDLE
 * negotiated, which is the normal case, every stream runs over it and the
 * link is determined. A report with several transports (or none) is left
 * alone.
 */
export function inferTransportId(stats: RtcStats[]): void {
	let transportId: string | undefined;

	for (const stat of stats) {
		if (stat.type !== W3C.StatsType.transport) continue;
		if (transportId !== undefined) return; // more than one transport: ambiguous

		transportId = stat.id;
	}

	if (transportId === undefined) return;

	for (const stat of stats) {
		const raw = stat as any;

		if (raw.transportId !== undefined) continue;
		if (!TRANSPORT_REFERRING_TYPES.includes(stat.type)) continue;

		raw.transportId = transportId;
	}
}

/**
 * Pairs of report types describing the same stream from the two ends, and the
 * reference each side uses to name the other.
 */
const CROSS_REFERENCES: readonly { from: string, to: string, field: string }[] = [
	// what the far end reports about the stream we send, and back
	{ from: W3C.StatsType.outboundRtp, to: W3C.StatsType.remoteInboundRtp, field: 'remoteId' },
	{ from: W3C.StatsType.remoteInboundRtp, to: W3C.StatsType.outboundRtp, field: 'localId' },
	// what the far end reports about the stream we receive, and back
	{ from: W3C.StatsType.inboundRtp, to: W3C.StatsType.remoteOutboundRtp, field: 'remoteId' },
	{ from: W3C.StatsType.remoteOutboundRtp, to: W3C.StatsType.inboundRtp, field: 'localId' },
];

/**
 * Restores the `remoteId` / `localId` cross-references between the local and
 * remote view of a stream, matched by SSRC — the synchronization source *is*
 * the stream's identity, so the pairing is determined rather than guessed.
 *
 * Safari 16.4 through 16.6 dropped `inbound-rtp.remoteId` entirely (it exists
 * before and after), which severs an inbound stream from the sender's clock
 * and its RTCP round trip. Resolved only when exactly one report of the
 * partner type carries the SSRC.
 */
export function inferRtpCrossReferences(stats: RtcStats[]): void {
	const bySsrc = new Map<string, RtcStats[]>();

	for (const stat of stats) {
		if (!isRtpStreamStats(stat)) continue;
		const ssrc = (stat as any).ssrc;

		if (ssrc === undefined) continue;

		const key = `${stat.type}:${ssrc}`;
		const bucket = bySsrc.get(key);

		if (bucket) bucket.push(stat);
		else bySsrc.set(key, [stat]);
	}

	for (const stat of stats) {
		const raw = stat as any;

		if (raw.ssrc === undefined) continue;

		for (const { from, to, field } of CROSS_REFERENCES) {
			if (stat.type !== from || raw[field] !== undefined) continue;

			const partners = bySsrc.get(`${to}:${raw.ssrc}`);
			const partner = partners?.length === 1 ? partners[0] : undefined;

			if (partner) raw[field] = partner.id;
		}
	}
}

/**
 * Restores `codecId` on RTP reports that omit it, by matching the codec
 * entries of the same media kind — narrowed to the stream's own transport,
 * and to the matching direction when the browser tags codec entries with the
 * (non-standard, Firefox) `codecType`. Resolved only when a single codec
 * entry survives that narrowing; a report where several codecs of one kind
 * are in play does not determine which one a stream used.
 *
 * Run after {@link inferTransportId}, so the transport narrowing has
 * something to work with.
 */
export function inferCodecId(stats: RtcStats[]): void {
	let codecs: any[] | undefined;

	for (const stat of stats) {
		if (!isRtpStreamStats(stat)) continue;
		const raw = stat as any;

		if (raw.codecId !== undefined || raw.kind === undefined) continue;

		codecs ??= stats.filter((candidate) => candidate.type === W3C.StatsType.codec);

		let candidates = codecs.filter((codec) => typeof codec.mimeType === 'string'
			&& codec.mimeType.toLowerCase().startsWith(`${raw.kind}/`));

		if (raw.transportId !== undefined) {
			const sameTransport = candidates.filter((codec) => codec.transportId === undefined
				|| codec.transportId === raw.transportId);

			if (sameTransport.length > 0) candidates = sameTransport;
		}

		// Firefox tags direction-specific payload types; the stream we send is
		// encoded, the stream we receive is decoded
		if (candidates.some((codec) => codec.codecType !== undefined)) {
			const wanted = stat.type === W3C.StatsType.outboundRtp || stat.type === W3C.StatsType.remoteInboundRtp
				? 'encode'
				: 'decode';
			const sameDirection = candidates.filter((codec) => codec.codecType === undefined
				|| codec.codecType === wanted);

			if (sameDirection.length > 0) candidates = sameDirection;
		}

		if (candidates.length === 1) raw.codecId = candidates[0].id;
	}
}
