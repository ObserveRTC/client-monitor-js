/* eslint-disable @typescript-eslint/no-explicit-any */
import { IceCandidatePairStats, IceTransportStats } from "../schema/ClientSample";
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import * as W3C from "../schema/W3cStatsIdentifiers";
import { StatsAdapter } from "./StatsAdapter";
import {
	foldField,
	foldMediaTypeIntoKind,
	inferCodecId,
	inferOutboundMediaSourceId,
	inferRtpCrossReferences,
	inferTransportId,
	isRtpStreamStats,
} from "./adapterTools";

type SelectedIceCandidatePairStats = (RtcStats & IceCandidatePairStats & { selected?: boolean });

/**
 * Normalizes Firefox's `getStats()` output toward the W3C webrtc-stats spec.
 *
 * Folds — the value survives under its standard name, the duplicate goes:
 * - `mediaType` → `kind`, the legacy alias emitted on every RTP stream report.
 * - `inbound-rtp.discardedPackets` → `packetsDiscarded`, Firefox's own
 *   non-standard alias of the standard counter.
 *
 * Maps `candidate-pair.state: 'cancelled'` → `'failed'`; Firefox retains a
 * value the spec removed from the enum and the monitors do not model.
 *
 * Reconstructs the missing `transport` report (see below), then infers
 * references — this matters most on Firefox, which omits the most:
 * - `outbound-rtp.mediaSourceId`, never emitted, and the link through which a
 *   sent stream reaches its source and its `MediaStreamTrack`. Resolved by
 *   kind when a single source of that kind exists (so simulcast encodings all
 *   resolve to it), left unset when a camera and a screen share make it
 *   ambiguous.
 * - `transportId` on RTP, codec and ICE reports, absent before Firefox 153 —
 *   resolved to the sole transport in the report, native or reconstructed.
 * - `remoteId`/`localId` cross-references and `codecId` where absent, matched
 *   by SSRC and by codec kind/direction respectively.
 *
 * Members the spec dropped but Firefox still fills — `candidate-pair.selected`
 * / `writable` / `readable` / `priority` / `componentId`, `codec.codecType`,
 * and the `csrc` reports — are left in place: the browser measured them, and
 * the monitors carry through whatever they receive. `selected` in particular
 * is the only way to know which pair Firefox is using before Firefox 153.
 *
 * Deliberately NOT touched: brace-wrapped `trackIdentifier` values (`{uuid}`).
 * Firefox wraps `MediaStreamTrack.id` the same way, so the identifier already
 * matches the application's `track.id` exactly as emitted — "cleaning" the
 * braces would break the track binding.
 *
 * Not corrected — the value is simply absent and any replacement would be a
 * guess, which downstream code could not tell apart from a measurement:
 * - `outbound-rtp.qualityLimitationReason` / `qualityLimitationDurations`,
 *   `totalPacketSendDelay` and `targetBitrate` are not implemented.
 * - `media-source` audio entries carry no levels; `media-playout` reports do
 *   not exist; `remote-outbound-rtp` has no round-trip time.
 * - `inbound-rtp.framesRendered` is never emitted.
 *
 * **Stateful**, because the reconstructed transport accumulates counters
 * across ticks — one instance per peer connection, and it must see every
 * tick exactly once. Re-adapting the same tick is harmless (the accumulation
 * is keyed on the collection timestamp), but feeding it a tick it has already
 * seen out of order is not supported.
 */
export class FirefoxStatsAdapter implements StatsAdapter {
	public readonly name = 'firefoxStatsAdapter';

	/**
	 * The transport report reconstructed for Firefox < 153, which ships none.
	 * Counters accumulate here across selected-pair changes so the transport
	 * totals stay continuous the way a native report's would.
	 */
	private readonly _transportStats: IceTransportStats & RtcStats = {
		type: 'transport',
		timestamp: 0,
		id: '',
		packetsSent: 0,
		packetsReceived: 0,
		bytesSent: 0,
		bytesReceived: 0,
		selectedCandidatePairId: undefined,
		selectedCandidatePairChanges: -1,
	};

	private _selectedCandidatePair?: SelectedIceCandidatePairStats;
	private _accumulatedAt?: number;

	public adapt(stats: RtcStats[]): RtcStats[] {
		for (const stat of stats) {
			if (!stat || typeof stat.type !== 'string') continue;
			const raw = stat as any;

			if (isRtpStreamStats(stat)) {
				foldMediaTypeIntoKind(raw);

				if (stat.type === W3C.StatsType.inboundRtp) {
					foldField(raw, 'discardedPackets', 'packetsDiscarded');
				}
				continue;
			}

			if (stat.type === W3C.StatsType.candidatePair && raw.state === 'cancelled') {
				raw.state = 'failed';
			}
		}

		this._addReconstructedTransport(stats);

		inferOutboundMediaSourceId(stats);
		inferTransportId(stats);
		inferRtpCrossReferences(stats);
		inferCodecId(stats);

		return stats;
	}

	/**
	 * Firefox ships no `transport` report before 153, which leaves the
	 * connection-level view — DTLS/ICE state, the selected pair, transport
	 * totals — with nothing behind it. Rebuilds one from the candidate pair
	 * Firefox marks `selected`, so ICE-level monitoring behaves the same
	 * across browsers.
	 *
	 * Every number comes from the pair the browser reported: the totals
	 * accumulate the pair's own deltas, and carry across a pair change rather
	 * than jumping back to the new pair's own counters. A no-op as soon as a
	 * native transport report is present.
	 */
	private _addReconstructedTransport(stats: RtcStats[]): void {
		let selectedCandidatePair: SelectedIceCandidatePairStats | undefined;

		for (const stat of stats) {
			// a native transport report settles it, wherever it appears in the
			// report — so the whole array is scanned before deciding
			if (stat.type === W3C.StatsType.transport) return;
			if (stat.type !== W3C.StatsType.candidatePair) continue;

			const pair = stat as SelectedIceCandidatePairStats;

			if (pair.selected) selectedCandidatePair = pair;
		}

		if (!selectedCandidatePair) return;

		// guard against the same tick being adapted twice: the folds and
		// inferences above are idempotent, accumulating counters is not
		const alreadySeen = this._accumulatedAt === selectedCandidatePair.timestamp
			&& this._selectedCandidatePair?.id === selectedCandidatePair.id;

		if (!alreadySeen) {
			if (this._selectedCandidatePair?.id !== selectedCandidatePair.id) {
				this._transportStats.selectedCandidatePairChanges = (this._transportStats.selectedCandidatePairChanges ?? 0) + 1;
				this._transportStats.selectedCandidatePairId = selectedCandidatePair.id;
				this._transportStats.id = selectedCandidatePair.transportId ?? 'transport_0';
			} else {
				const deltaPacketsReceived = (selectedCandidatePair.packetsReceived ?? 0) - (this._selectedCandidatePair.packetsReceived ?? 0);
				const deltaPacketsSent = (selectedCandidatePair.packetsSent ?? 0) - (this._selectedCandidatePair.packetsSent ?? 0);
				const deltaBytesReceived = (selectedCandidatePair.bytesReceived ?? 0) - (this._selectedCandidatePair.bytesReceived ?? 0);
				const deltaBytesSent = (selectedCandidatePair.bytesSent ?? 0) - (this._selectedCandidatePair.bytesSent ?? 0);

				if (0 < deltaBytesReceived) this._transportStats.bytesReceived = (this._transportStats.bytesReceived ?? 0) + deltaBytesReceived;
				if (0 < deltaBytesSent) this._transportStats.bytesSent = (this._transportStats.bytesSent ?? 0) + deltaBytesSent;
				if (0 < deltaPacketsReceived) this._transportStats.packetsReceived = (this._transportStats.packetsReceived ?? 0) + deltaPacketsReceived;
				if (0 < deltaPacketsSent) this._transportStats.packetsSent = (this._transportStats.packetsSent ?? 0) + deltaPacketsSent;
			}

			this._selectedCandidatePair = selectedCandidatePair;
			this._accumulatedAt = selectedCandidatePair.timestamp;
		}

		this._transportStats.timestamp = selectedCandidatePair.timestamp;

		stats.push(this._transportStats);
	}
}
