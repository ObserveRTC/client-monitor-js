import * as W3CStats from '../schema/W3cStatsIdentifiers';
import { createLogger } from '../utils/logger';
import { StatsAdapter } from './StatsAdapter';

const logger = createLogger('StatsAdapter');

export class StatsAdapters {
	public readonly adapters = new Map<string, StatsAdapter>();

	public add(adapter: StatsAdapter) {
		if (this.adapters.has(adapter.name)) {
			return logger.warn('Adapter with name already exists', adapter.name);
		}

		this.adapters.set(adapter.name, adapter);
	}

	public remove(adapter: StatsAdapter | string) {
		if (typeof adapter === 'string') {
			return this.adapters.delete(adapter);
		}
		return this.adapters.delete(adapter.name);
	}

	public adapt(input: W3CStats.RtcStats[]): W3CStats.RtcStats[] {
		let result: W3CStats.RtcStats[] = input;

		for (const adapter of this.adapters.values()) {
			try {
				result = adapter.adapt(result);
			} catch (err) {
				logger.warn('Error adapting stats', err);
			}
		}

		return result;
	}

	public postAdapt(input: W3CStats.RtcStats[]): W3CStats.RtcStats[] {
		let result: W3CStats.RtcStats[] = input;

		for (const adapter of this.adapters.values()) {
			if (!adapter.postAdapt) continue;
			try {
				result = adapter.postAdapt(result);
			} catch (err) {
				logger.warn('Error post adapting stats', err);
			}
		}

		return result;
	}
}