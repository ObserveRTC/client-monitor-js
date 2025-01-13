import * as W3C from '../schema/W3cStatsIdentifiers'

export async function collectStatsFromRtcPeerConnection(peerConnection: RTCPeerConnection): Promise<W3C.RtcStats[]> {
    const stats = await peerConnection.getStats();
    if (!stats) throw new Error('Failed to get stats from RTCPeerConnection');
    
    const result: W3C.RtcStats[] = [];

    // legacy support
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((stats as any).values) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rtcStats = stats as any;
        if (rtcStats.values || typeof rtcStats.values === "function") {
            for (const rtcStatValue of rtcStats.values()) {
                if (
                    !rtcStatValue ||
                    !rtcStatValue.type ||
                    typeof rtcStatValue.type !== "string" ||
                    !rtcStatValue.id ||
                    !rtcStatValue.timestamp ||
                    false
                ) {
                    continue;
                }
                result.push(rtcStatValue);
            }

            return result;
        }
    }

    stats.forEach((report) => {
        if (!report.id) return;
        if (!report.timestamp) return;
        if (!report.type) return;

        result.push(report);
    });

    return result;
}
