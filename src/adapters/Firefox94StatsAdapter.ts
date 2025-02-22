import { RtcStats } from "../schema/W3cStatsIdentifiers";
import * as W3C from "../schema/W3cStatsIdentifiers";

export class Firefox94StatsAdapter {
	public readonly name = 'firefox94StatsAdapter';

	public adapt(rtcStats: RtcStats[]): RtcStats[] {
		for (const rtcStatValue of rtcStats) {
			if (!rtcStatValue) continue;
			const rawType = rtcStatValue.type;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const rawValue = rtcStatValue as any;
			if (!rawType || typeof rawType !== "string") continue;
			if (
					rawType === W3C.StatsType.inboundRtp ||
					rawType === W3C.StatsType.outboundRtp ||
					rawType === W3C.StatsType.remoteInboundRtp ||
					rawType === W3C.StatsType.remoteOutboundRtp
			) {
					if (rawValue.mediaType && !rawValue.kind) {
							rawValue.kind = rawValue.mediaType;
							delete rawValue.mediaType;
					}
			}
			// firefox put the track identifier inside brackets ({})
			// if (rawValue.trackIdentifier) {
			// 		rawValue.trackIdentifier = rawValue.trackIdentifier.replace("{", "").replace("}", "");
			// }
		}

		return rtcStats;
	}
}