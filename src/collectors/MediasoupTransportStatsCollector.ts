import { ClientMonitor, InboundRtpStats } from "..";
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import { StatsCollector } from "./StatsCollector";
import { createLogger } from "../utils/logger";
import * as mediasoup from 'mediasoup-client';
import { convertRTCStatsReport } from "./utils";

const logger = createLogger('MediasoupTransportStatsCollector');

export class MediasoupTransportStatsCollector implements StatsCollector {
	public lastStats: RtcStats[] = [];
	public _stats: RtcStats[] = [];
	public readonly producers = new Map<string, mediasoup.types.Producer>();

	public get browser() {
		return this.clientMonitor.browser 
	}

	public constructor(
		public readonly transport: mediasoup.types.Transport,
		public readonly clientMonitor: ClientMonitor,
	) {
		// empty
		this._newProducers = this._newProducers.bind(this);
		
		this.transport.observer.once('close', () => {
			this.transport.observer.off('newproducer', this._newProducers);
		});
		this.transport.observer.on('newproducer', this._newProducers);
	}

	public async getStats(): Promise<RtcStats[]> {
		try {
			this.lastStats = convertRTCStatsReport(await this.transport.getStats());
			
			// rip out the probator
			for (const stats of this.lastStats) {
				if (stats.type === 'inbound-rtp' ) {
					const inboundRtpStats = stats as unknown as InboundRtpStats;
					if (inboundRtpStats.trackIdentifier === 'probator') continue;
				}
				this._stats.push(stats);
			}

			try {
				await this._extend();
			} catch (err) {
				logger.error('Error extending stats', err);
			}
	
			return this._stats;

		} catch (err) {
				logger.error('Error getting stats report', err);
				return [];
		}
	}

	private _newProducers(producer: mediasoup.types.Producer) {
		producer.observer.once('close', () => {
			this.producers.delete(producer.id);
		});
		this.producers.set(producer.id, producer);
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