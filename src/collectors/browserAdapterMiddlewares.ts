import { Middleware } from "../utils/Processor";
import { CollectedStats } from "../Collectors";

export function createTrackStatsAdapterMiddleware(): Middleware<CollectedStats> {
    return (data, next) => {
        for (const { statsMap } of data) {
            for (const statsValue of [...statsMap["inbound-rtp"], ...statsMap['outbound-rtp']]) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rtcStatValue = statsValue as any;
                if (rtcStatValue.mediaType && !rtcStatValue.kind) {
                    rtcStatValue.kind = rtcStatValue.mediaType;
                }
                if (rtcStatValue.type === "inbound-rtp" && rtcStatValue.trackId && !rtcStatValue.receiverId) {
                    rtcStatValue.receiverId = rtcStatValue.trackId;
                }
                if (rtcStatValue.type === "outbound-rtp" && rtcStatValue.trackId && !rtcStatValue.senderId) {
                    rtcStatValue.senderId = rtcStatValue.trackId;
                }
                if (rtcStatValue.trackId) {
                    const trackStats = statsMap['track'].find(trackStat => trackStat.id === rtcStatValue.trackId);
                    if (trackStats) {
                        if (statsValue.type === "outbound-rtp" && !statsMap['sender'].find(sender => sender.id === trackStats.id)) {
                            statsMap['sender'].push({
                                ...trackStats,
                                type: "sender",
                                ssrc: rtcStatValue.ssrc,
                                kind: rtcStatValue.kind,
                            });
                        } else if (statsValue.type === "inbound-rtp" && !statsMap['receiver'].find(receiver => receiver.id === trackStats.id)) {
                            statsMap['receiver'].push({
                                ...trackStats,
                                type: "receiver",
                                ssrc: rtcStatValue.ssrc,
                                kind: rtcStatValue.kind,
                            });
                        }
                    }
                }

            }
        }
        return next(data);
    };
}

export function createFirefox94AdapterMiddleware(): Middleware<CollectedStats> {
    return (data, next) => {
        for (const { statsMap } of data) {
            for (const rtcStatValue of statsMap) {
                if (!rtcStatValue) continue;
                const rawType = rtcStatValue.type;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawValue = rtcStatValue as any;
                if (!rawType || typeof rawType !== "string") continue;
                if (
                    rawType === "inbound-rtp" ||
                    rawType === "outbound-rtp" ||
                    rawType === "remote-inbound-rtp" ||
                    rawType === "remote-outbound-rtp"
                ) {
                    if (rawValue.mediaType && !rawValue.kind) {
                        rawValue.kind = rawValue.mediaType;
                        delete rawValue.mediaType;
                    }
                }
                // firefox put the track identifier inside brackets ({})
                if (rawValue.trackIdentifier) {
                    rawValue.trackIdentifier = rawValue.trackIdentifier.replace("{", "").replace("}", "");
                }
            }
        }
        return next(data);
    };
}
