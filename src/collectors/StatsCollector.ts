import { RtcStats } from "../schema/W3cStatsIdentifiers";

export interface StatsCollector {
	lastStats: RtcStats[];

	getStats(): Promise<RtcStats[]>;
}