import * as W3C from '../schema/W3cStatsIdentifiers'

export type StatsMap = ReturnType<typeof createStatsMap>;

export function createStatsMap(stats: W3C.StatsValue[], unknownStats?: (stats: unknown) => void) {
    const codecs: W3C.CodecStats[] = [];
    const inboundRtps: W3C.InboundRtpStats[] = [];
    const outboundRtps: W3C.OutboundRtpStats[] = [];
    const remoteInboundRtps: W3C.RemoteInboundRtpStats[] = [];
    const remoteOutboundRtps: W3C.RemoteOutboundRtpStats[] = [];
    const mediaSources: W3C.MediaSourceStats[] = [];
    const peerConnections: W3C.PeerConnectionStats[] = [];
    const dataChannels: W3C.DataChannelStats[] = [];
    const transports: W3C.TransportStats[] = [];
    const candidatePairs: W3C.CandidatePairStats[] = [];
    const localCandidates: W3C.LocalCandidateStats[] = [];
    const remoteCandidates: W3C.RemoteCandidateStats[] = [];
    const certificates: W3C.CertificateStats[] = [];
    const mediaPlayouts: W3C.MediaPlayoutStats[] = [];

    // Deprecated 2022-09-21
    // ----------------------
    const transceivers: W3C.TransceiverStats[] = [];
    const contributingSources: W3C.ContributingSourceStats[] = [];
    const senders: W3C.SenderStats[] = [];
    const receivers: W3C.ReceiverStats[] = [];
    const sctpTransports: W3C.SctpTransportStats[] = [];
    const iceServers: W3C.IceServerStats[] = [];

    // Deprecated 2021
    // -----------------
    const streams: W3C.StreamStats[] = [];
    const tracks: W3C.TrackStats[] = [];
    stats.forEach(createStatsVisitor({
        codec: (stats: W3C.CodecStats) => codecs.push(stats),
        inboundRtp: (stats: W3C.InboundRtpStats) => inboundRtps.push(stats),
        outboundRtp: (stats: W3C.OutboundRtpStats) => outboundRtps.push(stats),
        remoteInboundRtp: (stats: W3C.RemoteInboundRtpStats) => remoteInboundRtps.push(stats),
        remoteOutboundRtp: (stats: W3C.RemoteOutboundRtpStats) => remoteOutboundRtps.push(stats),
        mediaSource: (stats: W3C.MediaSourceStats) => mediaSources.push(stats),
        peerConnection: (stats: W3C.PeerConnectionStats) => peerConnections.push(stats),
        dataChannel: (stats: W3C.DataChannelStats) => dataChannels.push(stats),
        iceCandidatePair: (stats: W3C.CandidatePairStats) => candidatePairs.push(stats),
        localCandidate: (stats: W3C.LocalCandidateStats) => localCandidates.push(stats),
        remoteCandidate: (stats: W3C.RemoteCandidateStats) => remoteCandidates.push(stats),
        certificate: (stats: W3C.CertificateStats) => certificates.push(stats),
        mediaPlayout: (stats: W3C.MediaPlayoutStats) => mediaPlayouts.push(stats),
        contributingSource: (stats: W3C.ContributingSourceStats) => contributingSources.push(stats),
        transceiver: (stats: W3C.TransceiverStats) => transceivers.push(stats),
        sender: (stats: W3C.SenderStats) => senders.push(stats),
        receiver: (stats: W3C.ReceiverStats) => receivers.push(stats),
        transport: (stats: W3C.TransportStats) => transports.push(stats),
        sctpTransport: (stats: W3C.SctpTransportStats) => sctpTransports.push(stats),
        iceServer: (stats: W3C.IceServerStats) => iceServers.push(stats),
        streamStats: (stats: W3C.StreamStats) => streams.push(stats),
        trackStats: (stats: W3C.TrackStats) => tracks.push(stats),
        unknownStats,
    }));
    function *generator(): Generator<W3C.StatsValue, void, undefined> {
        yield* codecs;
        yield* inboundRtps;
        yield* outboundRtps;
        yield* remoteInboundRtps;
        yield* remoteOutboundRtps;
        yield* mediaSources;
        yield* peerConnections;
        yield* dataChannels;
        yield* transports;
        yield* candidatePairs;
        yield* localCandidates;
        yield* remoteCandidates;
        yield* certificates;
        yield* mediaPlayouts;
        
        yield* transceivers;
        yield* contributingSources;
        yield* senders;
        yield* receivers;
        yield* sctpTransports;
        yield* iceServers;

        yield* streams;
        yield* tracks;
    }
   
    return {
        'codec': codecs,
        'inbound-rtp': inboundRtps,
        'outbound-rtp': outboundRtps,
        'remote-inbound-rtp': remoteInboundRtps,
        'remote-outbound-rtp': remoteOutboundRtps,
        'media-source': mediaSources,
        'peer-connection': peerConnections,
        'data-channel': dataChannels,
        'transport': transports,
        'candidate-pair': candidatePairs,
        'local-candidate': localCandidates,
        'remote-candidate': remoteCandidates,
        'certificate': certificates,
        'media-playout': mediaPlayouts,

        'transceiver': transceivers,
        'csrc': contributingSources,
        'sender': senders,
        'receiver': receivers,
        'sctp-transport': sctpTransports,
        'ice-server': iceServers,

        'stream': streams,
        'track': tracks,

        [Symbol.iterator]:  (): IterableIterator<W3C.StatsValue> => {
            return generator();
        },
    }
}

// export type StatsEntry = 
//     | [W3C.StatsType.codec, W3C.RtcCodecStats]
//     | [W3C.StatsType.inboundRtp, W3C.RtcInboundRtpStreamStats]


export type Timestamps = {
    maxTimestamp?: number,
    minTimestamp?: number,
}

export type CreateStatsVisitorConfig = {
    codec: (stats: W3C.CodecStats) => void;
    inboundRtp: (stats: W3C.InboundRtpStats) => void;
    outboundRtp: (stats: W3C.OutboundRtpStats) => void;
    remoteInboundRtp: (stats: W3C.RemoteInboundRtpStats) => void;
    remoteOutboundRtp: (stats: W3C.RemoteOutboundRtpStats) => void;
    mediaSource: (stats: W3C.MediaSourceStats) => void;
    peerConnection: (stats: W3C.PeerConnectionStats) => void;
    dataChannel: (stats: W3C.DataChannelStats) => void;
    iceCandidatePair: (stats: W3C.CandidatePairStats) => void;
    localCandidate: (stats: W3C.LocalCandidateStats) => void;
    remoteCandidate: (stats: W3C.RemoteCandidateStats) => void;
    certificate: (stats: W3C.CertificateStats) => void;
    mediaPlayout: (stats: W3C.MediaPlayoutStats) => void;
    contributingSource: (stats: W3C.ContributingSourceStats) => void;
    transceiver: (stats: W3C.TransceiverStats) => void;
    sender: (stats: W3C.SenderStats) => void;
    receiver: (stats: W3C.ReceiverStats) => void;
    transport: (stats: W3C.TransportStats) => void;
    sctpTransport: (stats: W3C.SctpTransportStats) => void;
    iceServer: (stats: W3C.IceServerStats) => void;
    trackStats?: (stats: W3C.TrackStats) => void;
    streamStats?: (stats: W3C.StreamStats) => void;
    unknownStats?: (stats: unknown) => void;
}

export type StatsVisitor = ReturnType<typeof createStatsVisitor>;

export function createStatsVisitor(config: CreateStatsVisitorConfig) {
    return (statsValue: W3C.StatsValue) => {
        switch (statsValue.type) {
            case 'codec':
                config.codec(statsValue as W3C.CodecStats);
                break;
            case 'inbound-rtp':
                config.inboundRtp(statsValue as W3C.InboundRtpStats);
                break;
            case 'outbound-rtp':
                config.outboundRtp(statsValue as W3C.OutboundRtpStats);
                break;
            case 'remote-inbound-rtp':
                config.remoteInboundRtp(statsValue as W3C.RemoteInboundRtpStats);
                break;
            case 'remote-outbound-rtp':
                config.remoteOutboundRtp(statsValue as W3C.RemoteOutboundRtpStats);
                break;
            case 'media-source':
                config.mediaSource(statsValue as W3C.MediaSourceStats);
                break;
            case 'peer-connection':
                config.peerConnection(statsValue as W3C.PeerConnectionStats);
                break;
            case 'data-channel':
                config.dataChannel(statsValue as W3C.DataChannelStats);
                break;
            case 'transport':
                config.transport(statsValue as W3C.TransportStats);
                break;
            case 'candidate-pair':
                config.iceCandidatePair(statsValue as W3C.CandidatePairStats);
                break;
            case 'local-candidate':
                config.localCandidate(statsValue as W3C.LocalCandidateStats);
                break;
            case 'remote-candidate':
                config.remoteCandidate(statsValue as W3C.RemoteCandidateStats);
                break;
            case 'certificate':
                config.certificate(statsValue as W3C.CertificateStats);
                break;
            case 'media-playout':
                config.mediaPlayout(statsValue as W3C.MediaPlayoutStats);
                break;
            case 'transceiver':
                config.transceiver(statsValue as W3C.TransceiverStats);
                break;
            case 'csrc':
                config.contributingSource(statsValue as W3C.ContributingSourceStats);
                break;
            case 'sender':
                config.sender(statsValue as W3C.SenderStats);
                break;
            case 'receiver':
                config.receiver(statsValue as W3C.ReceiverStats);
                break;
            case 'sctp-transport':
                config.sctpTransport(statsValue as W3C.SctpTransportStats);
                break;
            case 'ice-server':
                config.iceServer(statsValue as W3C.IceServerStats);
                break;
            case 'stream':
                config.streamStats?.(statsValue as W3C.StreamStats);
                break;
            case 'track':
                config.trackStats?.(statsValue as W3C.TrackStats);
                break;
            default:
                config.unknownStats?.(statsValue);
                break;
        }
    }
}

/*eslint-disable @typescript-eslint/no-explicit-any */
export function collectStatsValuesFromRtcStatsReport(rtcStats: any): W3C.StatsValue[] | undefined {
    if (!rtcStats || !rtcStats.values || typeof rtcStats.values !== "function") {
        return;
    }
    const result: W3C.StatsValue[] = [];
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