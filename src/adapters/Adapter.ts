import { StatsEntry } from "../utils/StatsVisitor";
import { logger } from "../utils/logger";
import { Chrome86Adapter } from "./Chrome86Adapter";
import { twoWayEnum } from "../utils/reverseEnums";
import { DefaultAdapter } from "./DefaultAdapter";
import { StatsType, RtcCodecStats, RtcInboundRtpStreamStats, RtcOutboundRTPStreamStats, RtcRemoteInboundRtpStreamStats, RtcRemoteOutboundRTPStreamStats, RtcMediaSourceCompoundStats, RtcRtpContributingSourceStats, RtcPeerConnectionStats, RtcDataChannelStats, RtcRtpTransceiverStats, RtcTransportStats, RtcSctpTransportStats, RtcCertificateStats, RtcIceServerStats, RtcReceiverCompoundStats, RtcSenderCompoundStats, RtcIceCandidatePairStats, RtcLocalCandidateStats, RtcRemoteCandidateStats } from "../schemas/W3CStatsIdentifier";
import { Firefox94Adapter } from "./Firefox90_94";

export const TwoWayRtcStatsType = twoWayEnum(StatsType);

export enum AdapterTypes {
    Chrome91Adapter = "Chrome91",
    DefaultAdapter = "DefaultAdapter",
}

export type AdapterConfig = {
    /**
     * the type of the browser, e.g.: chrome, firefox, safari
     */
    browserType?: string,
    /**
     * the version of the browser, e.g.: 97.xx.xxxxx
     */
    browserVersion?: string,
}

type AdapterConstructorType = AdapterConfig;

const defaultConfig: AdapterConstructorType = {

}

export interface Adapter {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    adapt(data: any): Generator<StatsEntry | undefined, void, undefined>;
}

function createChromeAdapter(version?: string): Adapter {
    if (!version) {
        return new DefaultAdapter();
    }
    const majorVersion = version.split(".")[0];
    switch (majorVersion) {
        /*eslint-disable no-fallthrough */
        case "99":
        case "98":
        case "97":
        case "96":
        case "95":
        case "94":
        case "93":
        case "92":
        case "91":
        case "90":
        case "89":
        case "88":
        case "87":
        case "86":
            return new Chrome86Adapter();
        default:
            logger.warn(`Cannot recognize chrome version ${version}`);
        /* eslint-disable no-fallthrough */
        case AdapterTypes.DefaultAdapter:
            return new DefaultAdapter();
    }
    return new DefaultAdapter();
}


function createFirefoxAdapter(version?: string): Adapter {
    if (!version) {
        return new DefaultAdapter();
    }
    const majorVersion = version.split(".")[0];
    console.warn(majorVersion);
    switch (majorVersion) {
        case "94":
        case "93":
        case "92":
        case "91":
        case "90":
            return new Firefox94Adapter();
        default:
            logger.warn(`Cannot recognize chrome version ${version}`);
        case AdapterTypes.DefaultAdapter:
            return new DefaultAdapter();
    }
    return new DefaultAdapter();
}

export function createAdapter(providedConfig?: AdapterConfig): Adapter {
    const config = Object.assign(defaultConfig, providedConfig);
    if (!config || !config.browserType) {
        return new DefaultAdapter();
    }
    switch (config.browserType) {
        case "chrome":
        case "Chrome":
            return createChromeAdapter(config.browserVersion);
        case "Firefox":
        case "firefox":
            return createFirefoxAdapter(config.browserVersion);
        default:
            // logger.info(`Browser type ${config.browserType} is not recognized`);
            return new DefaultAdapter();
    }
}

/*eslint-disable @typescript-eslint/no-explicit-any */
export function castStats(rtcStatType: string, rtcStatValue: any): StatsEntry | undefined {
    switch (rtcStatType.toLowerCase()) {
        case StatsType.codec:
            return [StatsType.codec, rtcStatValue as RtcCodecStats];
        case StatsType.inboundRtp:
            return [StatsType.inboundRtp, rtcStatValue as RtcInboundRtpStreamStats];
        case StatsType.outboundRtp:
            return [StatsType.outboundRtp, rtcStatValue as RtcOutboundRTPStreamStats];
        case StatsType.remoteInboundRtp:
            return [StatsType.remoteInboundRtp, rtcStatValue as RtcRemoteInboundRtpStreamStats];
        case StatsType.remoteOutboundRtp:
            return [StatsType.remoteOutboundRtp, rtcStatValue as RtcRemoteOutboundRTPStreamStats];
        case StatsType.mediaSource:
            return [StatsType.mediaSource, rtcStatValue as RtcMediaSourceCompoundStats];
        case StatsType.csrc:
            return [StatsType.csrc, rtcStatValue as RtcRtpContributingSourceStats];
        case StatsType.peerConnection:
            return [StatsType.peerConnection, rtcStatValue as RtcPeerConnectionStats];
        case StatsType.dataChannel:
            return [StatsType.dataChannel, rtcStatValue as RtcDataChannelStats];
        case StatsType.stream:
            return undefined; // unsupported
        case StatsType.track:
            return undefined; // unsupported
        case StatsType.transceiver:
            return [StatsType.transceiver, rtcStatValue as RtcRtpTransceiverStats];
        case StatsType.sender:
            return [StatsType.sender, rtcStatValue as RtcSenderCompoundStats];
        case StatsType.receiver:
            return [StatsType.receiver, rtcStatValue as RtcReceiverCompoundStats];
        case StatsType.transport:
            return [StatsType.transport, rtcStatValue as RtcTransportStats];
        case StatsType.sctpTransport:
            return [StatsType.sctpTransport, rtcStatValue as RtcSctpTransportStats];
        case StatsType.candidatePair:
            return [StatsType.candidatePair, rtcStatValue as RtcIceCandidatePairStats];
        case StatsType.localCandidate:
            return [StatsType.localCandidate, rtcStatValue as RtcLocalCandidateStats];
        case StatsType.remoteCandidate:
            return [StatsType.remoteCandidate, rtcStatValue as RtcRemoteCandidateStats];
        case StatsType.certificate:
            return [StatsType.certificate, rtcStatValue as RtcCertificateStats];
        case StatsType.iceServer:
            return [StatsType.iceServer, rtcStatValue as RtcIceServerStats];
        default:
            return undefined;
    }
}

