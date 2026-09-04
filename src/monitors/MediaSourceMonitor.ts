import { MediaSourceStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { positiveDelta } from "../utils/common";

export class MediaSourceMonitor implements MediaSourceStats {
	private _visited = true;
	
	timestamp: number;
	id: string;
	kind: MediaKind;
	audioLevel?: number | undefined;
	trackIdentifier?: string;
	totalAudioEnergy?: number | undefined;
	totalSamplesDuration?: number | undefined;
	echoReturnLoss?: number | undefined;
	echoReturnLossEnhancement?: number | undefined;
	width?: number | undefined;
	height?: number | undefined;
	frames?: number | undefined;
	framesPerSecond?: number | undefined;

	// derived fields
	public deltaFrames?: number | undefined;
	public deltaTotalAudioEnergy?: number | undefined;
	public deltaSamplesDuration?: number | undefined;

	/**
	 * Milliseconds between this stats report and the previous one, from the
	 * reports' own timestamps. Detectors accumulate this to measure how long a
	 * condition has held, so a late or skipped collection still measures the
	 * time the condition actually held underneath.
	 */
	deltaTime?: number | undefined;

	/** Frames per second the capture source actually produced in this interval. */
	public sourceFps?: number | undefined;

	/**
	 * RMS audio level over this interval, from `totalAudioEnergy`. Unlike the
	 * instantaneous `audioLevel` it does not read zero between speech bursts,
	 * so it is the value to compare against a silence threshold.
	 */
	public rmsAudioLevel?: number | undefined;

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
		options: MediaSourceStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.kind = options.kind as MediaKind;

		Object.assign(this, options);
	}
	

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	/**
	 * Milliseconds of **stats time** this monitor has observed, accumulated from
	 * `deltaTime` — the clock every window and duration in the library is measured
	 * on, and the one thing `Date.now()` must never stand in for.
	 *
	 * It advances by what each collection actually cost rather than by one nominal
	 * period, so a late or skipped collection widens a window by the time the
	 * condition really held underneath. It never goes backwards and it is not a
	 * timestamp: only differences between two readings of it mean anything.
	 */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getTrack() {
		return this._peerConnection.mappedOutboundTracks.get(this.trackIdentifier ?? '');
	}

	/** Every outbound stream encoded from this source (several with simulcast). */
	public getOutboundRtps() {
		return this._peerConnection.outboundRtps.filter((outboundRtp) => outboundRtp.mediaSourceId === this.id);
	}

	public accept(stats: Omit<MediaSourceStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			return; // logger?
		}
		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;
		const elapsedInSec = elapsedInMs / 1000;

		this.deltaFrames = positiveDelta(stats.frames, this.frames);
		this.deltaTotalAudioEnergy = positiveDelta(stats.totalAudioEnergy, this.totalAudioEnergy);
		this.deltaSamplesDuration = positiveDelta(stats.totalSamplesDuration, this.totalSamplesDuration);

		// Deliberately NOT `deltaFrames / elapsed`. `positiveDelta` clamps a
		// counter that went backwards to 0, and a source whose counter restarted
		// — a replaced track, a re-acquired device — would then read as 0 fps,
		// which is indistinguishable from a camera that has died. A restart is
		// not a measurement, so the interval yields no frame rate at all.
		const framesDelta = stats.frames !== undefined && this.frames !== undefined
			? stats.frames - this.frames
			: undefined;

		this.sourceFps = framesDelta !== undefined && 0 <= framesDelta
			? framesDelta / elapsedInSec
			: undefined;

		this.rmsAudioLevel = this.deltaTotalAudioEnergy !== undefined &&
			this.deltaSamplesDuration !== undefined &&
			this.deltaSamplesDuration > 0
			? Math.sqrt(this.deltaTotalAudioEnergy / this.deltaSamplesDuration)
			: undefined;

		Object.assign(this, stats);
	}

	public createSample(): MediaSourceStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			kind: this.kind,
			audioLevel: this.audioLevel,
			trackIdentifier: this.trackIdentifier,
			totalAudioEnergy: this.totalAudioEnergy,
			totalSamplesDuration: this.totalSamplesDuration,
			echoReturnLoss: this.echoReturnLoss,
			echoReturnLossEnhancement: this.echoReturnLossEnhancement,
			width: this.width,
			height: this.height,
			frames: this.frames,
			framesPerSecond: this.framesPerSecond,
			attachments: this.attachments,
		};
	}
}