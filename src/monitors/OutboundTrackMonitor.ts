import { Detectors } from "../detectors/Detectors";
import { DryOutboundTrackDetector } from "../detectors/DryOutboundTrackDetector";
import { CaptureFailureDetector } from "../detectors/CaptureFailureDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";
import { SourceEncoderBottleneckDetector } from "../detectors/SourceEncoderBottleneckDetector";
import { SimulcastLayerDetector } from "../detectors/SimulcastLayerDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { OutboundTrackSample } from "../schema/ClientSample";
import { CalculatedScore } from "../scores/CalculatedScore";
import { MediaSourceMonitor } from "./MediaSourceMonitor";
import { OutboundRtpMonitor } from "./OutboundRtpMonitor";

export class OutboundTrackMonitor {
	public readonly direction = 'outbound';
	public readonly detectors: Detectors;
	public readonly mappedOutboundRtps = new Map<number, OutboundRtpMonitor>();
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';

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
		private _mediaSource: MediaSourceMonitor,
		attachments?: Record<string, unknown>,
	) {
		this.attachments = attachments;
		this.detectors = new Detectors();

		const monitorConfig = this.getPeerConnection().parent.config;

		if (monitorConfig.dryOutboundTrackDetector !== null) {
			this.detectors.add(new DryOutboundTrackDetector(this));
		}
		if (monitorConfig.captureFailureDetector !== null) {
			this.detectors.add(new CaptureFailureDetector(this));
		}
		if (monitorConfig.codecChangeDetector !== null) {
			this.detectors.add(new CodecChangeDetector(this));
		}

		if (this.kind === 'audio') this.calculatedScore.weight = 1;
		else if (this.kind === 'video') {
			if (monitorConfig.sourceEncoderBottleneckDetector !== null) {
				this.detectors.add(new SourceEncoderBottleneckDetector(this));
			}
			if (monitorConfig.simulcastLayerDetector !== null) {
				this.detectors.add(new SimulcastLayerDetector(this));
			}
			if (monitorConfig.videoResolutionChangeDetector !== null) {
				this.detectors.add(new VideoResolutionChangeDetector(this));
			}
			this.calculatedScore.weight = 2;
		}
	}


	public getPeerConnection() {
		return this._mediaSource.getPeerConnection();
	}

	/** The capture source feeding this track. */
	public getMediaSource() {
		return this._mediaSource;
	}

	public get kind() {
		return this.track.kind;
	}

	bitrate?: number;
	jitter?: number;
	fractionLost?: number;
	sendingPacketRate?: number;
	remoteReceivedPacketRate?: number;

	public update() {
		this.bitrate = 0;
		this.jitter = 0;
		this.fractionLost = 0;
		this.sendingPacketRate = 0;
		this.remoteReceivedPacketRate = 0;

		for (const outboundRtp of this.mappedOutboundRtps.values()) {
			this.bitrate += outboundRtp.bitrate ?? 0;
			this.jitter += outboundRtp.getRemoteInboundRtp()?.jitter ?? 0;
			this.fractionLost += outboundRtp.getRemoteInboundRtp()?.deltaFractionLost ?? 0;
			this.sendingPacketRate += outboundRtp.packetRate ?? 0;
			this.remoteReceivedPacketRate += outboundRtp.getRemoteInboundRtp()?.packetRate ?? 0;
		}

		this.detectors.update();
	}

	public getOutboundRtps() {
		return Array.from(this.mappedOutboundRtps.values());
	}

	/** Allocation-free on purpose — several detectors call this every stats tick. */
	public getHighestLayer() {
		let first: OutboundRtpMonitor | undefined;
		let count = 0;
		let highestLayer: OutboundRtpMonitor | undefined;
		let highestBitrate = 0;

		for (const outboundRtp of this.mappedOutboundRtps.values()) {
			count += 1;
			first ??= outboundRtp;

			if (outboundRtp.bitrate && outboundRtp.bitrate > highestBitrate) {
				highestLayer = outboundRtp;
				highestBitrate = outboundRtp.bitrate;
			}
		}

		if (count === 0) return undefined;
		if (count === 1) return first;

		return highestLayer;
	}

	public createSample(): OutboundTrackSample {
		let scoreReasons: string | undefined;
		if (this.kind === 'audio') {
			scoreReasons = this.getPeerConnection()?.parent.scoreCalculator?.encodeOutboundAudioScoreReasons?.(this.calculatedScore.reasons);
		} else if (this.kind === 'video') {
			scoreReasons = this.getPeerConnection()?.parent.scoreCalculator?.encodeOutboundVideoScoreReasons?.(this.calculatedScore.reasons);
		}

		return {
			id: this.track.id,
			kind: this.kind,
			timestamp: Date.now(),
			attachments: this.attachments,
			score: this.score,
			scoreReasons,
		};
	}
}