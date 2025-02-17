import * as W3CStats from '../schema/W3cStatsIdentifiers';
import { createLogger } from '../utils/logger';

const logger = createLogger('StatsAdapter');

export interface StatsGenerator {
	generate(): W3CStats.RtcStats[]
}

export class StatsGenerators {
	private readonly _generators: StatsGenerator[] = [];

	public add(generator: StatsGenerator) {
		this._generators.push(generator);
	}

	public remove(generator: StatsGenerator) {
		const index = this._generators.indexOf(generator);
		if (index < 0) return;
		this._generators.splice(index, 1);
	}

	public generate(): W3CStats.RtcStats[] {
		const result: W3CStats.RtcStats[] = [];

		for (const adapter of this._generators) {
			try {
				const stats = adapter.generate();
				if (stats && 0 < stats.length) {
					result.push(...stats);
				}
			} catch (err) {
				logger.warn('Error adapting stats', err);
			}
		}

		return result;
	}
}