import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";
import { createLogger } from "../utils/logger";

const logger = createLogger("Safari14Adapter");

export class Firefox94Adapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== "function") {
            logger.warn(`not rtcStats object is provided to the adapter: `, rtcStats);
            return;
        }
        logger.warn("rtcStatValue", rtcStats, Array.from(rtcStats.values()));
        for (const rtcStatValue of rtcStats.values()) {
            const rawType = rtcStatValue.type;
            if (!rtcStatValue) continue;
            if (!rawType || typeof rawType !== "string") continue;
            if (
                rawType === "inbound-rtp" ||
                rawType === "outbound-rtp" ||
                rawType === "remote-inbound-rtp" ||
                rawType === "remote-outbound-rtp"
            ) {
                if (rtcStatValue.mediaType && !rtcStatValue.kind) {
                    rtcStatValue.kind = rtcStatValue.mediaType;
                    delete rtcStatValue.mediaType;
                }
            }

            yield castStats(rawType, rtcStatValue);
        }
    }
}
