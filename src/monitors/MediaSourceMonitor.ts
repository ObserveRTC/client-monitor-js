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

	/** Milliseconds since the previous stats report, from the reports' own timestamps. */
	deltaTime?: number | undefined;


	/** Frames per second the capture source actually produced in this interval. */
	public producedFps?: number | undefined;

	/**
	 * RMS audio level over this interval. Unlike the instantaneous `audioLevel` it does not
	 * read zero between speech bursts, so it is what a silence threshold should compare against.
	 */
	public rmsAudioLevel?: number | undefined;

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
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

	/** Accumulated stats time. Only differences between two readings mean anything. */
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

		// Not `deltaFrames`: that clamps a restarted counter to 0, which would read as 0 fps
		// and be indistinguishable from a dead camera. A restart yields no frame rate at all.
		const framesDelta = stats.frames !== undefined && this.frames !== undefined
			? stats.frames - this.frames
			: undefined;

		this.producedFps = framesDelta !== undefined && 0 <= framesDelta
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