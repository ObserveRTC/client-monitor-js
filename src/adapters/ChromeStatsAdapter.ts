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
 * Normalizes Chromium-based browsers' (Chrome, Edge, Opera) `getStats()`
 * output toward the W3C webrtc-stats spec. Chromium is the closest to the
 * spec of the engines, so most of this is a no-op on a current version.
 *
 * Folds — the value survives under its standard name, the duplicate goes:
 * - `mediaType` → `kind`, the legacy alias still emitted unconditionally on
 *   every RTP stream report.
 * - `ip` → `address` on ICE candidate reports; Chromium emits both spellings
 *   with identical values.
 * - The deprecated `track`/`stream` reports and their `trackId` reference
 *   (Chrome ≤ M111) → the matching `inbound-rtp` fields.
 *
 * Infers references: `mediaSourceId`, `transportId`, the `remoteId`/`localId`
 * cross-references and `codecId` are filled in when absent. Chromium emits
 * them all, so this is a safety net for older versions and for stats arriving
 * through a relay that dropped them.
 *
 * Chromium's non-standard extras — `contentType`, `googTimingFrameInfo`,
 * `candidate-pair.writable`/`priority`, candidate `networkType`/`isRemote`,
 * `transport.rtcpTransportStatsId` — are deliberately left in place. The spec
 * dropped them, but the browser measured them and the monitors carry through
 * whatever they receive, so they stay available for investigation.
 *
 * Not corrected — the value is simply absent and any replacement would be a
 * guess, which downstream code could not tell apart from a measurement:
 * - `inbound-rtp.framesRendered` and `remote-inbound-rtp.packetsReceived` are
 *   never emitted.
 * - `candidate-pair.requestsSent` counts only STUN checks sent before the
 *   first response; every later check is folded into `consentRequestsSent`,
 *   so the sum of the two is the real "all STUN requests sent".
 * - `inbound-rtp.packetsDiscarded` is populated for audio only.
 */
export class ChromeStatsAdapter implements StatsAdapter {
	public readonly name = 'chromeStatsAdapter';

	public adapt(stats: RtcStats[]): RtcStats[] {
		const result = foldLegacyTrackStats(stats);

		for (const stat of result) {
			if (!stat || typeof stat.type !== 'string') continue;
			const raw = stat as any;

			if (isRtpStreamStats(stat)) {
				foldMediaTypeIntoKind(raw);
				continue;
			}

			if (stat.type === W3C.StatsType.localCandidate || stat.type === W3C.StatsType.remoteCandidate) {
				foldField(raw, 'ip', 'address');
			}
		}

		inferOutboundMediaSourceId(result);
		inferTransportId(result);
		inferRtpCrossReferences(result);
		inferCodecId(result);

		return result;
	}
}
