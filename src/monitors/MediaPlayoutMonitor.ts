import { Detectors } from "../detectors/Detectors";
import { SynthesizedSamplesDetector } from "../detectors/SynthesizedSamplesDetector";
import { MediaPlayoutStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class MediaPlayoutMonitor implements MediaPlayoutStats {
	private _visited = true;
	public readonly detectors = new Detectors();

	timestamp: number;
	id: string;
	kind: MediaKind;
	synthesizedSamplesDuration?: number | undefined;
	synthesizedSamplesEvents?: number | undefined;
	totalSamplesDuration?: number | undefined;
	totalPlayoutDelay?: number | undefined;
	totalSamplesCount?: number | undefined;
	
	public deltaSynthesizedSamplesDuration = 0;
	public deltaSamplesDuration = 0;
	/**
	 * Additional data attached to this stats, will be shipped to the server
	 */
	attachments?: Record<string, unknown> | undefined;
	/**
	 * Additional data attached to this stats, will not be shipped to the server, 
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: MediaPlayoutStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.kind = options.kind as MediaKind;

		Object.assign(this, options);

		this.detectors.add(
			new SynthesizedSamplesDetector(this),
		)
	}

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public getPeerConnection() {
		return this._peerConnection;
	}

	public accept(stats: Omit<MediaPlayoutStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}
		if (this.synthesizedSamplesDuration && stats.synthesizedSamplesDuration) {
			this.deltaSynthesizedSamplesDuration = stats.synthesizedSamplesDuration - this.synthesizedSamplesDuration;
		}
		if (this.totalSamplesDuration && stats.totalSamplesDuration) {
			this.deltaSamplesDuration = stats.totalSamplesDuration - this.totalSamplesDuration;
		}

		Object.assign(this, stats);

		this.detectors.update();
	}

	public createSample(): MediaPlayoutStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			kind: this.kind,
			synthesizedSamplesDuration: this.synthesizedSamplesDuration,
			synthesizedSamplesEvents: this.synthesizedSamplesEvents,
			totalSamplesDuration: this.totalSamplesDuration,
			totalPlayoutDelay: this.totalPlayoutDelay,
			totalSamplesCount: this.totalSamplesCount,
			attachments: this.attachments,
		};
	}
}