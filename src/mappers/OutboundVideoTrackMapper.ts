import { OutboundRtpEntry } from "../entries/StatsEntryInterfaces";
import { OutboundVideoTrack } from "../schemas/ClientSample";
import { Mapper } from "./Mapper";

export class OutboundVideoTrackMapper implements Mapper<OutboundRtpEntry, OutboundVideoTrack> {
    public map(entry: OutboundRtpEntry): OutboundVideoTrack | undefined {
        const trackId = entry.getSender()?.getMediaSource()?.stats?.trackIdentifier;
        const result: OutboundVideoTrack = {
            // ...entry.stats,
            trackId,
        }
        return result;
    }
}