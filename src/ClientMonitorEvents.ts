import { InboundRtpMonitor } from "./monitors/InboundRtpMonitor";
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
		peerConnection: PeerConnectionMonitor,
		targetIncomingBitrateAfterCongestion: number | undefined;
		targetIncomingBitrateBeforeCongestion: number | undefined;
		targetOutgoingBitrateAfterCongestion: number | undefined;
		targetOutgoingBitrateBeforeCongestion: number | undefined;
		highestSeenOutgoingBitrateBeforeCongestion: number | undefined;
		highestSeenIncomingBitrateBeforeCongestion: number | undefined;
	}],
	'cpulimitation': [],
	'audio-desync': [{
		trackId: string,
	}],
	'freezed-video': [{
		inboundRtp: InboundRtpMonitor,
	}],
	'stucked-inbound-track': [{
		inboundRtp: InboundRtpMonitor,
	}],
	'too-long-pc-connection-establishment': [{
			peerConnection: PeerConnectionMonitor,
	}]
	
}