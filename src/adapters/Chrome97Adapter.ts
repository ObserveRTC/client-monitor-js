import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";


export class Chrome97Adapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== 'function') {
            throw new Error(`not rtcStats object: ` + rtcStats);
        }
        for (const rtcStatValue of rtcStats.values()) {
            const rawType = rtcStatValue.type;
            if (!rtcStatValue) continue;
            if (!rawType || typeof rawType !== 'string') continue;
            if (rawType === "inbound-rtp" || rawType === "outbound-rtp") {
                if (rtcStatValue.mediaType && !rtcStatValue.kind) {
                    rtcStatValue.kind = rtcStatValue.mediaType;
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
    }
}