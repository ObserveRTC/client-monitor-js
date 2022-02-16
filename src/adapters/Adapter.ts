import { StatsEntry } from "../utils/StatsVisitor";
import { logger } from "../utils/logger";
import { Chrome86Adapter } from "./Chrome86Adapter";
import { DefaultAdapter } from "./DefaultAdapter";
import { W3CStats } from "@observertc/schemas";
import { Firefox94Adapter } from "./Firefox90_94";
import { Safari14Adapter } from "./Safari14Adapter";

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
}


function createFirefoxAdapter(version?: string): Adapter {
    if (!version) {
        return new DefaultAdapter();
    }
    const majorVersion = version.split(".")[0];
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
}

function createSafariAdapter(version?: string): Adapter {
    if (!version) {
        return new DefaultAdapter();
    }
    const majorVersion = version.split(".")[0];
    switch (majorVersion) {
        case "16":
        case "15":
        case "14":
            return new Safari14Adapter();
        default:
            logger.warn(`Cannot recognize chrome version ${version}`);
        case AdapterTypes.DefaultAdapter:
            return new DefaultAdapter();
    }
}

export function createAdapter(providedConfig?: AdapterConfig): Adapter {
    const config = Object.assign(defaultConfig, providedConfig);
    if (!config || !config.browserType) {
        return new DefaultAdapter();
    }
    switch (config.browserType.toLowerCase()) {
        case "chrome":
            return createChromeAdapter(config.browserVersion);
        case "firefox":
            return createFirefoxAdapter(config.browserVersion);
        case "safari":
            return createSafariAdapter(config.browserVersion);
        default:
            // logger.info(`Browser type ${config.browserType} is not recognized`);
            return new DefaultAdapter();
    }
}

/*eslint-disable @typescript-eslint/no-explicit-any */
export function castStats(rtcStatType: string, rtcStatValue: any): StatsEntry | undefined {
    switch (rtcStatType.toLowerCase()) {
        case W3CStats.StatsType.codec:
            return [W3CStats.StatsType.codec, rtcStatValue as W3CStats.RtcCodecStats];
        case W3CStats.StatsType.inboundRtp:
            return [W3CStats.StatsType.inboundRtp, rtcStatValue as W3CStats.RtcInboundRtpStreamStats];
        case W3CStats.StatsType.outboundRtp:
            return [W3CStats.StatsType.outboundRtp, rtcStatValue as W3CStats.RtcOutboundRTPStreamStats];
        case W3CStats.StatsType.remoteInboundRtp:
            return [W3CStats.StatsType.remoteInboundRtp, rtcStatValue as W3CStats.RtcRemoteInboundRtpStreamStats];
        case W3CStats.StatsType.remoteOutboundRtp:
            return [W3CStats.StatsType.remoteOutboundRtp, rtcStatValue as W3CStats.RtcRemoteOutboundRTPStreamStats];
        case W3CStats.StatsType.mediaSource:
            return [W3CStats.StatsType.mediaSource, rtcStatValue as W3CStats.RtcMediaSourceCompoundStats];
        case W3CStats.StatsType.csrc:
            return [W3CStats.StatsType.csrc, rtcStatValue as W3CStats.RtcRtpContributingSourceStats];
        case W3CStats.StatsType.peerConnection:
            return [W3CStats.StatsType.peerConnection, rtcStatValue as W3CStats.RtcPeerConnectionStats];
        case W3CStats.StatsType.dataChannel:
            return [W3CStats.StatsType.dataChannel, rtcStatValue as W3CStats.RtcDataChannelStats];
        case W3CStats.StatsType.stream:
            return undefined; // unsupported
        case W3CStats.StatsType.track:
            return undefined; // unsupported
        case W3CStats.StatsType.transceiver:
            return [W3CStats.StatsType.transceiver, rtcStatValue as W3CStats.RtcRtpTransceiverStats];
        case W3CStats.StatsType.sender:
            return [W3CStats.StatsType.sender, rtcStatValue as W3CStats.RtcSenderCompoundStats];
        case W3CStats.StatsType.receiver:
            return [W3CStats.StatsType.receiver, rtcStatValue as W3CStats.RtcReceiverCompoundStats];
        case W3CStats.StatsType.transport:
            return [W3CStats.StatsType.transport, rtcStatValue as W3CStats.RtcTransportStats];
        case W3CStats.StatsType.sctpTransport:
            return [W3CStats.StatsType.sctpTransport, rtcStatValue as W3CStats.RtcSctpTransportStats];
        case W3CStats.StatsType.candidatePair:
            return [W3CStats.StatsType.candidatePair, rtcStatValue as W3CStats.RtcIceCandidatePairStats];
        case W3CStats.StatsType.localCandidate:
            return [W3CStats.StatsType.localCandidate, rtcStatValue as W3CStats.RtcLocalCandidateStats];
        case W3CStats.StatsType.remoteCandidate:
            return [W3CStats.StatsType.remoteCandidate, rtcStatValue as W3CStats.RtcRemoteCandidateStats];
        case W3CStats.StatsType.certificate:
            return [W3CStats.StatsType.certificate, rtcStatValue as W3CStats.RtcCertificateStats];
        case W3CStats.StatsType.iceServer:
            return [W3CStats.StatsType.iceServer, rtcStatValue as W3CStats.RtcIceServerStats];
        default:
            return undefined;
    }
}

