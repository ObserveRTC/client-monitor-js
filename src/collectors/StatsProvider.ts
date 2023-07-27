
export type StatsProvider = ReturnType<typeof createStatsProvider>;

export function createStatsProvider(
	getStats: () => Promise<RTCStatsReport>,
	peerConnectionId: string,
	peerConnectionLabel?: string,
) {
	return {
		peerConnectionId,
		peerConnectionLabel,
		getStats,
	}
}

