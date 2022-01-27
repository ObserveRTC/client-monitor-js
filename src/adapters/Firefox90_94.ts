import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";
import { DefaultAdapter } from "./DefaultAdapter";
import { StatsType } from "../schemas/W3CStatsIdentifier";


export class Firefox94Adapter implements Adapter {
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== 'function') {
            throw new Error(`not rtcStats object: ` + rtcStats);
        }
        for (let rtcStatValue of rtcStats.values()) {
            const rawType = rtcStatValue.type;
            if (!rtcStatValue) continue;
            if (!rawType || typeof rawType !== 'string') continue;
            if (rawType === "inbound-rtp" ||
                rawType === "outbound-rtp" ||
                rawType === "remote-inbound-rtp" ||
                rawType === "remote-outbound-rtp") 
            {
                if (rtcStatValue.mediaType && !rtcStatValue.kind) {
                    rtcStatValue.kind = rtcStatValue.mediaType;
                    delete rtcStatValue.mediaType;
                }
            }

            yield castStats(rawType, rtcStatValue);
        }
    }
}