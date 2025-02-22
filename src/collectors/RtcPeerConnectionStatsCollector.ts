import { ClientMonitor } from "..";
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import { StatsCollector } from "./StatsCollector";
import { createLogger } from "../utils/logger";
import { convertRTCStatsReport } from "./utils";

const logger = createLogger('RtcPeerConnectionStatsCollector');

export class RtcPeerConnectionStatsCollector implements StatsCollector {
	public lastStats: RtcStats[] = [];

	public get browser() {
		return this.clientMonitor.browser 
	}

	public constructor(
		public readonly peerConnection: RTCPeerConnection,
		public readonly clientMonitor: ClientMonitor,
	) {
		// empty
	}

	public async getStats(): Promise<RtcStats[]> {
		try {
			this.lastStats = convertRTCStatsReport(await this.peerConnection.getStats());
			
			try {
				await this._extend();
			} catch (err) {
				logger.error('Error extending stats', err);
			}
	
			return this.lastStats;

		} catch (err) {
				logger.error('Error getting stats report', err);
				return [];
		}
	}

	private async _extend() {
		if (!this.lastStats || !this.browser) {
			return;
		}

		switch (this.browser.name) {
			case 'chrome': {
				break;
			}
			case 'edge': {
				break;
			}
			case 'opera': {
				break;
			}
			case 'safari': {
				break;
			}
			case 'firefox': {
				this._firefoxTrackStats();
				break;
			}
			case 'unknown' : {
				break;
			}
		}
	}

	private _firefoxTrackStats() {
		// get the track ids, then run the getStats again.
	}
}