import { AudioDesyncDetector } from "../detectors/AudioDesyncDetector";
import { Detectors } from "../detectors/Detectors";
import { FreezedVideoTrackDetector } from "../detectors/FreezedVideoTrackDetector";
import { DryInboundTrackDetector } from "../detectors/DryInboundTrackDetector";
import { CalculatedScore, VideoMotionType } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { InboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { PlayoutDiscrepancyDetector } from "../detectors/PlayoutDiscrepancyDetector";
import { AudioConcealmentDetector } from "../detectors/AudioConcealmentDetector";
import { JitterBufferStressDetector } from "../detectors/JitterBufferStressDetector";
import { DecoderPerformanceDetector } from "../detectors/DecoderPerformanceDetector";
import { InboundFrameSupplyDetector } from "../detectors/InboundFrameSupplyDetector";
import { StuckDecoderDetector } from "../detectors/StuckDecoderDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";

export type InboundTrackContentType = 'camera' | 'screenshare';

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';
	public dtxMode = false;

	/**
	 * True while THIS receiving leg is deliberately paused — the local
	 * mediasoup consumer got `pause()`d (kept in sync by
	 * `MediasoupTransportBinding`). Distinct from
	 * {@link remoteOutboundTrackPaused}: a paused consumer only means this leg
	 * opted out of the flow — the producer may well keep sending to everyone
	 * else. While true, detectors that read the missing bytes as a failure
	 * (dry-inbound-track, stuck decoder, audio concealment, jitter-buffer
	 * stress) stand down instead of raising false issues.
	 */
	public paused = false;

	/**
	 * True while the SENDING side is deliberately silent — the remote producer
	 * got paused, so nobody receives anything on this track. mediasoup-client
	 * has no local signal for this (the pause travels over the application's
	 * own signaling), so the application sets it when that notification
	 * arrives:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)!.remoteOutboundTrackPaused = true;
	 * ```
	 *
	 * The same detectors that respect {@link paused} respect this flag too.
	 */
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

	/**
	 * How much motion this track's content carries, which decides how visible a
	 * given quantizer is and therefore where the `pixelated-video` thresholds
	 * sit. Fast movement masks compression artifacts, so high-motion content
	 * tolerates a coarser quantizer; a slide or a still face shows every blocked
	 * edge and is judged more strictly.
	 *
	 * Nothing in the stats reveals it, so the application declares it when it
	 * knows:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)?.setMotionType('highmotion');
	 * ```
	 *
	 * Left undeclared, screen share is judged as `lowmotion` - unreadable text
	 * is a hard failure - and everything else as `standard`.
	 */
	public motionType?: VideoMotionType;


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
			if (monitorConfig.inboundFrameSupplyDetector !== null) {
				this.detectors.add(new InboundFrameSupplyDetector(this));
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

	/**
	 * Declares how much motion this track's content carries. See
	 * {@link motionType}; `ClientMonitor.setTrackMotionType()` does the same by
	 * track id and works before the track's monitor exists.
	 */
	public setMotionType(motionType: VideoMotionType): void {
		this.motionType = motionType;
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