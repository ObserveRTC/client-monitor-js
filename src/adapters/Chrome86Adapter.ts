import { Adapter, castStats } from "./Adapter";
import { StatsEntry } from "../utils/StatsVisitor";


export class Chrome86Adapter implements Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public *adapt(rtcStats: any): Generator<StatsEntry | undefined, void, undefined> {
        if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== 'function') {
            throw new Error(`not rtcStats object: ` + rtcStats);
        }
        const tracks = new Map<string, any>();
        for (const rtcStatValue of rtcStats.values()) {
            if (rtcStatValue && rtcStatValue.type === "track") {
                tracks.set(rtcStatValue.ssrc, rtcStatValue);
            }
        }
        for (let rtcStatValue of rtcStats.values()) {
            const rawType = rtcStatValue.type;
            if (!rtcStatValue) continue;
            if (!rawType || typeof rawType !== 'string') continue;
            if (rawType === "inbound-rtp" || rawType === "outbound-rtp") {
                if (rtcStatValue.ssrc) {
                    const trackStats = tracks.get(rtcStatValue.ssrc);
                    if (trackStats) {
                        rtcStatValue = {
                            ...trackStats,
                            ...rtcStatValue,
                        }
                        trackStats._observertc_outbTrack = rawType === "outbound-rtp";
                        trackStats._observertc_inbTrack = rawType === "inbound-rtp";
                    }
                }
                if (rtcStatValue.mediaType && !rtcStatValue.kind) {
                    rtcStatValue.kind = rtcStatValue.mediaType;
                }
                if (rawType === "inbound-rtp" && rtcStatValue.trackId && !rtcStatValue.receiverId) {
                    rtcStatValue.receiverId = rtcStatValue.trackId;
                }
                if (rawType === "outbound-rtp" && rtcStatValue.trackId && !rtcStatValue.senderId) {
                    rtcStatValue.senderId = rtcStatValue.trackId;
                }
            } else if (rawType === "local-candidate" || rawType === "remote-candidate") {
                if (rtcStatValue.ip && !rtcStatValue.address) {
                    rtcStatValue.address = rtcStatValue.ip;
                }
            }
            yield castStats(rawType, rtcStatValue);
        }
        for (const trackStats of tracks.values()) {
            if (trackStats._observertc_outbTrack === true) {
                yield castStats("sender", trackStats);
            } else if (trackStats._observertc_inbTrack === true) {
                yield castStats("receiver", trackStats);
            }
        }
    }
}