import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";
import { createLogger } from "../utils/logger";

const logger = createLogger("DefaultAdapter");

export class DefaultAdapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== "function") {
            logger.warn(`not rtcStats object is provided to the adapter: `, rtcStats);
            return;
        }
        for (const rtcStatValue of rtcStats.values()) {
            const rawType = rtcStatValue.type;
            if (!rawType || typeof rawType !== "string") continue;
            yield castStats(rawType, rtcStatValue);
        }
    }
}
