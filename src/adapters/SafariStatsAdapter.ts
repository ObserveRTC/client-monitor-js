/* eslint-disable @typescript-eslint/no-explicit-any */
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import * as W3C from "../schema/W3cStatsIdentifiers";
import { StatsAdapter } from "./StatsAdapter";
import {
	foldField,
	foldLegacyTrackStats,
	foldMediaTypeIntoKind,
	inferCodecId,
	inferOutboundMediaSourceId,
	inferRtpCrossReferences,
	inferTransportId,
	isRtpStreamStats,
} from "./adapterTools";

/**
 * Normalizes Safari/WebKit's `getStats()` output toward the W3C webrtc-stats
 * spec. Every fix feature-detects from the report itself, so on a current
 * Safari most of them are no-ops.
 *
 * Folds — the value survives under its standard name, the duplicate goes:
 * - The deprecated `track` reports (emitted through Safari 16.x) → the
 *   matching `inbound-rtp` fields: `trackIdentifier` (absent on `inbound-rtp`
 *   before Safari 16.4, and without it the monitor cannot bind the stream to
 *   a `MediaStreamTrack` at all), freeze/pause counters, frame geometry and
 *   audio levels.
 * - `mediaType` → `kind`, the legacy alias emitted through 16.x.
 * - `data-channel.datachannelid` → `dataChannelIdentifier`, the spec name
 *   (WebKit used the lowercase spelling through Safari 17.6).
 *
 * Maps legacy `candidate-pair.state` spellings onto the values the monitors
 * accept: `'inprogress'` → `'in-progress'`, and `'cancelled'` (dropped from
 * the spec enum) → `'failed'`.
 *
 * Infers references:
 * - `codec.transportId`, spec-required but not filled through Safari 17.3.
 * - `inbound-rtp.remoteId`, which WebKit dropped in Safari 16.4 through 16.6 —
 *   without it an inbound stream is severed from the sender's clock and RTCP
 *   round trip. Matched by SSRC.
 * - `outbound-rtp.mediaSourceId` and `codecId` where an older WebKit omits
 *   them.
 *
 * Members the spec dropped but WebKit still fills — `candidate-pair.priority`
 * / `writable` / `readable`, candidate `deleted`, `codec.codecType`,
 * `transport.rtcpTransportStatsId`, `remote-inbound-rtp.reportsReceived` —
 * are left in place: the browser measured them, and the monitors carry
 * through whatever they receive.
 *
 * Not corrected — the value is simply absent and any replacement would be a
 * guess, which downstream code could not tell apart from a measurement:
 * - `inbound-rtp.framesRendered` and `remote-inbound-rtp.packetsReceived` are
 *   never filled by WebKit (through Safari 26).
 * - `media-playout` reports are never produced, so `inbound-rtp.playoutId`
 *   and every audio-playout metric are unavailable.
 * - `address` is nulled on host and peer-reflexive ICE candidates.
 */
export class SafariStatsAdapter implements StatsAdapter {
	public readonly name = 'safariStatsAdapter';

	public adapt(stats: RtcStats[]): RtcStats[] {
		const result = foldLegacyTrackStats(stats);

		for (const stat of result) {
			if (!stat || typeof stat.type !== 'string') continue;
			const raw = stat as any;

			if (isRtpStreamStats(stat)) {
				foldMediaTypeIntoKind(raw);
				continue;
			}

			switch (stat.type) {
				case W3C.StatsType.dataChannel: {
					foldField(raw, 'datachannelid', 'dataChannelIdentifier');
					break;
				}
				case W3C.StatsType.candidatePair: {
					if (raw.state === 'inprogress') raw.state = 'in-progress';
					else if (raw.state === 'cancelled') raw.state = 'failed';
					break;
				}
			}
		}

		inferOutboundMediaSourceId(result);
		inferTransportId(result);
		inferRtpCrossReferences(result);
		inferCodecId(result);

		return result;
	}
}
