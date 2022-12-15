import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";
import { createLogger } from "../utils/logger";

const logger = createLogger("Safari14Adapter");

export class Safari14Adapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== "function") {
            logger.warn(`not rtcStats object is provided to the adapter: `, rtcStats);
            return;
        }
        const tracks = new Map<string, any>();
        for (const rtcStatValue of rtcStats.values()) {
            if (rtcStatValue && rtcStatValue.type === "track") {
                tracks.set(rtcStatValue.id, rtcStatValue);
            }
        }
        const senders = new Map<string, any>();
        const receivers = new Map<string, any>();
        for (let rtcStatValue of rtcStats.values()) {
            if (!rtcStatValue) continue;
            const rawType = rtcStatValue.type;
            if (!rawType || typeof rawType !== "string") continue;
            if (rawType === "track") continue;
            if (rawType === "inbound-rtp" || rawType === "outbound-rtp") {
                if (rtcStatValue.trackId) {
                    const trackStats = tracks.get(rtcStatValue.trackId);
                    if (trackStats) {
                        rtcStatValue = {
                            ...trackStats,
                            ...rtcStatValue,
                        };
                        if (rawType === "outbound-rtp") {
                            senders.set(trackStats.id, trackStats);
                        } else if (rawType === "inbound-rtp") {
                            receivers.set(trackStats.id, trackStats);
                        }
                    }
                }
                if (rawType === "inbound-rtp" && rtcStatValue.trackId && !rtcStatValue.receiverId) {
                    rtcStatValue.receiverId = rtcStatValue.trackId;
                }
                if (rawType === "outbound-rtp" && rtcStatValue.trackId && !rtcStatValue.senderId) {
                    rtcStatValue.senderId = rtcStatValue.trackId;
                }
            }
            yield castStats(rawType, rtcStatValue);
        }
        for (const trackStats of senders.values()) {
            yield castStats("sender", trackStats);
        }
        for (const trackStats of receivers.values()) {
            yield castStats("receiver", trackStats);
        }
    }
}
