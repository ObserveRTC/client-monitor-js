import { ClientMonitor } from "../ClientMonitor";
import { ExtensionStat } from "../schema/ClientSample";

/**
 * The latest payload reported under one extension-stat id, kept so the application can read its
 * own metrics back off the monitor instead of holding a copy beside it.
 *
 * One of these exists per id that has been reported. It holds only the most recent payload: this is
 * a current-value store, not a history. It lives while the id keeps being reported and is dropped
 * one collection after it stops — see `ClientMonitor.addExtensionStats`.
 */
export class ExtensionStatsMonitor implements ExtensionStat {
	/**
	 * Whether the id was reported since the last collection. `ClientMonitor` reads and clears it
	 * every collection, and drops the monitor on the collection that finds it already false.
	 */
	public visited = true;

	/** The most recent payload reported under this id; undefined if it was reported without one. */
	public payload?: Record<string, unknown>;

	/** When the payload was last reported, in wall-clock milliseconds. */
	public timestamp = Date.now();

	public constructor(
		public readonly id: string,
		public readonly type: string,
		public readonly clientMonitor: ClientMonitor,
	) {

	}

	public accept(payload?: Record<string, unknown>): void {
		this.visited = true;
		this.payload = payload;
		this.timestamp = Date.now();
	}
}
