import { ClientMonitor, CodecStats, InboundRtpStats, MediaSourceStats, OutboundRtpStats } from "..";
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import { StatsCollector } from "./StatsCollector";
import { createLogger } from "../utils/logger";
import * as mediasoup from 'mediasoup-client';
import { convertRTCStatsReport } from "./utils";
import * as W3C from '../schema/W3cStatsIdentifiers';

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
			this._stats = [];

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
				await this._firefoxTrackStats();
				break;
			}
			case 'unknown' : {
				break;
			}
		}
	}

	private async _firefoxTrackStats() {
		// get the track ids, then run the getStats again.
		await Promise.allSettled([...this.producers.values()].map(async producer => {
			const report = await producer.getStats();
			const outboundRtpStats: OutboundRtpStats[] = [];
			let mediaSourceStat: MediaSourceStats | undefined;
			let codecStats: CodecStats | undefined;

			report.forEach(stat => {
				if (stat.type === W3C.StatsType.outboundRtp) outboundRtpStats.push(stat as OutboundRtpStats);
				else if (stat.type === W3C.StatsType.mediaSource) mediaSourceStat = stat as MediaSourceStats;
				else if (stat.type === W3C.StatsType.codec) codecStats = stat as CodecStats;
			});

			for (const outboundRtp of outboundRtpStats) {
				const stat = this._stats.find(stat => stat.id === outboundRtp.id) as (OutboundRtpStats & RtcStats);

				if (!stat) continue;

				
				stat.codecId = codecStats?.id;
				stat.mediaSourceId = mediaSourceStat?.id;
			}
		}));
	}
}