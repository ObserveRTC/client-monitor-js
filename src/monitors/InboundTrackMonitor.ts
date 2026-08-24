import { AudioDesyncDetector } from "../detectors/AudioDesyncDetector";
import { Detectors } from "../detectors/Detectors";
import { FreezedVideoTrackDetector } from "../detectors/FreezedVideoTrackDetector";
import { DryInboundTrackDetector } from "../detectors/DryInboundTrackDetector";
import { CalculatedScore } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { InboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { PlayoutDiscrepancyDetector } from "../detectors/PlayoutDiscrepancyDetector";
import { AudioConcealmentDetector } from "../detectors/AudioConcealmentDetector";
import { JitterBufferStressDetector } from "../detectors/JitterBufferStressDetector";
import { DecoderPerformanceDetector } from "../detectors/DecoderPerformanceDetector";
import { StuckDecoderDetector } from "../detectors/StuckDecoderDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";

export type InboundTrackContentType = 'camera' | 'screenshare';

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';
	public dtxMode = false;
	public remoteOutboundTrackPaused = false;

	/**
	 * What kind of content this track carries. Only meaningful for video
	 * tracks — audio tracks leave it `undefined`, and an undefined video track
	 * is scored as camera content. Screen-share tracks are scored differently
	 * from camera tracks — no frame-rate expectations, since mostly-static
	 * content legitimately runs at very low and bursty frame rates — so
	 * getting this right matters for the track score.
	 *
	 * Unlike the outbound side, a remote track exposes no `displaySurface`
	 * to auto-detect from (the construction-time check below almost never
	 * fires for received tracks), so the application usually declares it
	 * explicitly — typically right after the track monitor appears:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)?.setContentType('screenshare');
	 * ```
	 */
	public contentType?: InboundTrackContentType;

	public calculatedScore: CalculatedScore = {
		weight: 0,
		value: undefined,
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public get scoreReasons() {
		return this.calculatedScore.reasons;
	}

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
		public readonly track: MediaStreamTrack,
		private readonly _inboundRtp: InboundRtpMonitor,
		attachments?: Record<string, unknown>,
	) {
		this.attachments = attachments;

		// Kept for symmetry with the outbound side: `displaySurface` exists
		// exclusively on display capture, so when it is present the verdict is
		// safe. Remote tracks practically never expose it — see `contentType`.
		if (typeof track.getSettings === 'function' &&
			(track.getSettings() as { displaySurface?: string }).displaySurface !== undefined) {
			this.contentType = 'screenshare';
		}

		const monitorConfig = this.getPeerConnection().parent.config;
		this.detectors = new Detectors();
		if (monitorConfig.dryInboundTrackDetector !== null) {
			this.detectors.add(new DryInboundTrackDetector(this));
		}

		if (monitorConfig.codecChangeDetector !== null) {
			this.detectors.add(new CodecChangeDetector(this));
		}

		if (this.kind === 'audio') {
			if (monitorConfig.audioDesyncDetector !== null) {
				this.detectors.add(new AudioDesyncDetector(this));
			}
			if (monitorConfig.audioConcealmentDetector !== null) {
				this.detectors.add(new AudioConcealmentDetector(this));
			}
			if (monitorConfig.jitterBufferStressDetector !== null) {
				this.detectors.add(new JitterBufferStressDetector(this));
			}
			this.calculatedScore.weight = 1;
		} else if (this.kind === 'video') {
			// one detector owns freeze state and the repair loop; each config
			// key gates its half inside
			if (monitorConfig.videoFreezesDetector !== null || monitorConfig.videoRecoveryDetector !== null) {
				this.detectors.add(new FreezedVideoTrackDetector(this));
			}
			if (monitorConfig.playoutDiscrepancyDetector !== null) {
				this.detectors.add(new PlayoutDiscrepancyDetector(this));
			}
			if (monitorConfig.decoderPerformanceDetector !== null) {
				this.detectors.add(new DecoderPerformanceDetector(this));
			}
			if (monitorConfig.stuckDecoderDetector !== null) {
				this.detectors.add(new StuckDecoderDetector(this));
			}
			if (monitorConfig.videoResolutionChangeDetector !== null) {
				this.detectors.add(new VideoResolutionChangeDetector(this));
			}
			this.calculatedScore.weight = 2;
		}

		// for mediasoup probator we don't need to run detectors
		if (this.track.id === 'probator') {
			this.detectors.clear();
		}
	}

	public getInboundRtp() {
		return this._inboundRtp;
	}

	/** True when this track carries screen-share content. See `contentType`. */
	public get isScreenShare() {
		return this.contentType === 'screenshare';
	}

	/**
	 * Explicitly declares what content this track carries. Call it when the
	 * application knows the received track is a screen share — inbound tracks
	 * cannot be auto-detected, so this is the primary way to mark one:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)?.setContentType('screenshare');
	 * ```
	 */
	public setContentType(contentType: InboundTrackContentType): void {
		this.contentType = contentType;
	}

	public getPeerConnection() {
		return this._inboundRtp.getPeerConnection();
	}

	public get kind() {
		return this._inboundRtp.kind;
	}

	public get bitrate() {
		return this._inboundRtp.bitrate;
	}

	public get jitter() {
		return this._inboundRtp.jitter;
	}

	public get fractionLost() {
		return this._inboundRtp.deltaFractionLost;
	}

	public update() {
		this.detectors.update();
	}

	public createSample(): InboundTrackSample {
			return {
				id: this.track.id,
				kind: this.track.kind,
				timestamp: Date.now(),
				attachments: this.attachments,
				score: this.score,
				scoreReasons: sampledScoreReasons(
					this.calculatedScore.reasons,
					this.getPeerConnection()?.parent.config.sendScoreReasonsToServer,
				),
			};
		}
}