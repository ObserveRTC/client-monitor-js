import { InboundRtpMonitor } from "./monitors/InboundRtpMonitor";
import { InboundTrackMonitor } from "./monitors/InboundTrackMonitor";
import { PeerConnectionMonitor } from "./monitors/PeerConnectionMonitor";
import { ClientSample } from "./schema/ClientSample"
import { RtcStats } from "./schema/W3cStatsIdentifiers";

export type AcceptedClientIssue = {
	type: string,
	payload?: Record<string, unknown> | boolean | string | number,
	timestamp: number,
}

export type AcceptedClientEvent = {
	type: string,
	payload?: Record<string, unknown> | boolean | string | number,
	timestamp: number,
}

export type AcceptedClientMetaData = {
	type: string,
	payload?: Record<string, unknown> | boolean | string | number,
	timestamp: number,
}

export type ClientMonitorEvents = {
	'sample-created': [
		ClientSample
	],
	"stats-collected": [{
		durationOfCollectingStatsInMs: number,
		collectedStats: [string, RtcStats[]][],
	}],
	'close': [],
	'issue': [AcceptedClientIssue],
	// detector events
	'congestion': [{
		peerConnectionMonitor: PeerConnectionMonitor,
		targetIncomingBitrateAfterCongestion: number | undefined;
		targetIncomingBitrateBeforeCongestion: number | undefined;
		targetOutgoingBitrateAfterCongestion: number | undefined;
		targetOutgoingBitrateBeforeCongestion: number | undefined;
		highestSeenOutgoingBitrateBeforeCongestion: number | undefined;
		highestSeenIncomingBitrateBeforeCongestion: number | undefined;
	}],
	'cpulimitation': [],
	'audio-desync-track': [trackMonitor: InboundTrackMonitor],
	'freezed-video-track': [trackMonitor: InboundTrackMonitor],
	'stucked-inbound-track': [trackMonitor: InboundTrackMonitor],
	'too-long-pc-connection-establishment': [peerConnectionMonitor: PeerConnectionMonitor]
	'score': [
		clientScore: number,
		remarks?: string[],
	],
	// 'new-peer-connnection-monitor': [
	// 	peerConnectionMonitor: PeerConnectionMonitor,
	// ]
	// 'new-inbound-rtp-monitor': [
	// 	inboundRtpMonitor: InboundRtpMonitor,
	// ]
	// 'new-inbound-track-monitor': [
	// 	inboundTrackMonitor: InboundTrackMonitor,
	// ]
	// 'new-outbound-track-monitor': [
	// 	outboundTrackMonitor: InboundTrackMonitor,
	// ]
	// 'new-outbound-rtp-monitor': [
	// 	outboundRtpMonitor: InboundRtpMonitor,
	// ],
	// 'new-data-channel-monitor': [
	// 	dataChannelMonitor: DataChannelMonitor,
	// ],
	// 'new-ice-transport-monitor': [
	// 	iceTransportMonitor: IceTransportMonitor,
	// ],
}