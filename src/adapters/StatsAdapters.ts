import * as W3CStats from '../schema/W3cStatsIdentifiers';
import { createLogger, Logger } from '../utils/logger';
import { StatsAdapter } from './StatsAdapter';

const MODULE_NAME = 'StatsAdapter';

export class StatsAdapters {
	public readonly adapters = new Map<string, StatsAdapter>();

	public constructor(private readonly logger: Logger = createLogger()) {
	}

	public add(adapter: StatsAdapter) {
		if (this.adapters.has(adapter.name)) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Adapter with name already exists', adapter.name);
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
				this.logger.warn(`[${MODULE_NAME}]:`, 'Error adapting stats', err);
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
				this.logger.warn(`[${MODULE_NAME}]:`, 'Error post adapting stats', err);
			}
		}

		return result;
	}
}