import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";
export class DefaultAdapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined>  {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== 'function') {
            throw new Error(`not rtcStats object: ` + rtcStats);
        }
        for (const rtcStatValue of rtcStats.values()) {
            const rawType = rtcStatValue.type;
            if (!rawType || typeof rawType !== 'string') continue;
            yield castStats(rawType, rtcStatValue);
        }
    }
}