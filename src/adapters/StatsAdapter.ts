import * as W3CStats from '../schema/W3cStatsIdentifiers';


export interface StatsAdapter {
	name: string;
	adapt(stats: W3CStats.RtcStats[]): W3CStats.RtcStats[];
	postAdapt?(stats: W3CStats.RtcStats[]): W3CStats.RtcStats[];
}
