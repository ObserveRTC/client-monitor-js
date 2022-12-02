import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";
import { createLogger } from "../utils/logger";

const logger = createLogger("Firefox94Adapter");

export class Firefox94Adapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== "function") {
            logger.warn(`not rtcStats object is provided to the adapter: `, rtcStats);
            return;
        }
        // logger.warn("rtcStatValue", rtcStats, Array.from(rtcStats.values()));
        for (const rtcStatValue of rtcStats.values()) {
            if (!rtcStatValue) continue;
            const rawType = rtcStatValue.type;
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
            // firefox put the track identifier inside brackets ({})
            if (rtcStatValue.trackIdentifier) {
                rtcStatValue.trackIdentifier = rtcStatValue.trackIdentifier.replace("{", "").replace("}", "");
            }


            yield castStats(rawType, rtcStatValue);
        }
    }
}
