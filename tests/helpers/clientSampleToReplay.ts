import { ReplayEntry, ReplayTrackState } from "./StatsReplayer";
import { RtcStats } from "../../src/schema/W3cStatsIdentifiers";

/**
 * Turns one captured `ClientSample` line back into a {@link ReplayEntry}.
 *
 * A ClientSample is the monitor's own output: the W3C stats objects grouped by
 * kind with their `type` discriminator dropped, since the group name carries it.
 * Replaying one means putting the discriminator back and flattening the groups.
 * The one thing the grouping actually loses is the local/remote split on ICE
 * candidates, which is recovered from the pairs that reference them.
 */
const GROUPS: [string, string][] = [
	[ 'codecs', 'codec' ],
	[ 'inboundRtps', 'inbound-rtp' ],
	[ 'outboundRtps', 'outbound-rtp' ],
	[ 'remoteInboundRtps', 'remote-inbound-rtp' ],
	[ 'remoteOutboundRtps', 'remote-outbound-rtp' ],
	[ 'mediaSources', 'media-source' ],
	[ 'mediaPlayouts', 'media-playout' ],
	[ 'peerConnectionTransports', 'peer-connection' ],
	[ 'dataChannels', 'data-channel' ],
	[ 'iceTransports', 'transport' ],
	[ 'iceCandidatePairs', 'candidate-pair' ],
	[ 'certificates', 'certificate' ],
];

type SamplePc = Record<string, unknown> & { peerConnectionId: string };

export function clientSampleToReplayEntry(sample: Record<string, unknown>): ReplayEntry {
	const peerConnections: [string, RtcStats[]][] = [];
	const tracks: ReplayTrackState[] = [];

	for (const pc of (sample.peerConnections as SamplePc[] | undefined) ?? []) {
		const stats: RtcStats[] = [];

		for (const [ group, type ] of GROUPS) {
			for (const item of (pc[group] as Record<string, unknown>[] | undefined) ?? []) {
				stats.push({ ...item, type } as unknown as RtcStats);
			}
		}

		// Local or remote is decided by which side of a pair references the id.
		const localIds = new Set<string>();
		const remoteIds = new Set<string>();

		for (const pair of (pc.iceCandidatePairs as Record<string, string>[] | undefined) ?? []) {
			if (pair.localCandidateId) localIds.add(pair.localCandidateId);
			if (pair.remoteCandidateId) remoteIds.add(pair.remoteCandidateId);
		}

		for (const candidate of (pc.iceCandidates as Record<string, unknown>[] | undefined) ?? []) {
			const id = candidate.id as string;

			stats.push({
				...candidate,
				type: remoteIds.has(id) && !localIds.has(id) ? 'remote-candidate' : 'local-candidate',
			} as unknown as RtcStats);
		}

		peerConnections.push([ pc.peerConnectionId, stats ]);

		for (const group of [ 'inboundTracks', 'outboundTracks' ]) {
			for (const track of (pc[group] as Record<string, unknown>[] | undefined) ?? []) {
				tracks.push({
					peerConnectionId: pc.peerConnectionId,
					id: track.id as string,
					kind: track.kind as 'audio' | 'video',
				});
			}
		}
	}

	return { timestamp: sample.timestamp as number, peerConnections, tracks };
}
