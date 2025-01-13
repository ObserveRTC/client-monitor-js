import * as W3CStats from '../schema/W3cStatsIdentifiers';
import { createLogger } from '../utils/logger';

const logger = createLogger('StatsAdapter');

export type StatsAdapter = (stats: W3CStats.RtcStats[]) => void;

export class StatsAdapters {
	private readonly _adapters: StatsAdapter[] = [];

	public add(adapter: StatsAdapter) {
		this._adapters.push(adapter);
	}

	public remove(adapter: StatsAdapter) {
		const index = this._adapters.indexOf(adapter);
		if (index < 0) return;
		this._adapters.splice(index, 1);
	}

	public adapt(stats: W3CStats.RtcStats[]) {
		for (const adapter of this._adapters) {
			try {
				adapter(stats);
			} catch (err) {
				logger.warn('Error adapting stats', err);
			}
		}
	}
}