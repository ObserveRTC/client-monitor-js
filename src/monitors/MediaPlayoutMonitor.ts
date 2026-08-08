import { Detectors } from "../detectors/Detectors";
import { SynthesizedSamplesDetector } from "../detectors/SynthesizedSamplesDetector";
import { MediaPlayoutStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { positiveDelta } from "../utils/common";

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
	public deltaSynthesizedSamplesEvents?: number | undefined;
	public deltaTotalPlayoutDelay?: number | undefined;
	public deltaSamplesCount?: number | undefined;

	/**
	 * Average playout delay per sample in this interval, in milliseconds —
	 * `totalPlayoutDelay` alone grows forever and cannot be compared to a
	 * threshold.
	 */
	public playoutDelayPerSampleInMs?: number | undefined;

	/**
	 * Share of the playout duration in this interval that was synthesized
	 * (concealment / stretching) rather than real received audio, in `0..1`.
	 */
	public synthesizedSamplesRatio?: number | undefined;
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

		if (this._peerConnection.parent.config.syntheticSamplesDetector !== null) {
			this.detectors.add(
				new SynthesizedSamplesDetector(this),
			);
		}
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
		this.deltaSynthesizedSamplesDuration = positiveDelta(stats.synthesizedSamplesDuration, this.synthesizedSamplesDuration) ?? 0;
		this.deltaSamplesDuration = positiveDelta(stats.totalSamplesDuration, this.totalSamplesDuration) ?? 0;
		this.deltaSynthesizedSamplesEvents = positiveDelta(stats.synthesizedSamplesEvents, this.synthesizedSamplesEvents);
		this.deltaTotalPlayoutDelay = positiveDelta(stats.totalPlayoutDelay, this.totalPlayoutDelay);
		this.deltaSamplesCount = positiveDelta(stats.totalSamplesCount, this.totalSamplesCount);

		if (this.deltaTotalPlayoutDelay !== undefined && this.deltaSamplesCount !== undefined && this.deltaSamplesCount > 0) {
			// totalPlayoutDelay is a sum of per-sample delays in seconds.
			this.playoutDelayPerSampleInMs = (this.deltaTotalPlayoutDelay * 1000) / this.deltaSamplesCount;
		} else {
			this.playoutDelayPerSampleInMs = undefined;
		}

		this.synthesizedSamplesRatio = this.deltaSamplesDuration > 0
			? Math.min(1, this.deltaSynthesizedSamplesDuration / this.deltaSamplesDuration)
			: 0;

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