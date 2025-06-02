import { AudioDesyncDetector } from "../detectors/AudioDesyncDetector";
import { Detectors } from "../detectors/Detectors";
import { FreezedVideoTrackDetector } from "../detectors/FreezedVideoTrackDetector";
import { DryInboundTrackDetector } from "../detectors/DryInboundTrackDetector";
import { CalculatedScore } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { InboundTrackSample } from "../schema/ClientSample";
import { PlayoutDiscrepancyDetector } from "../detectors/PlayoutDiscrepancyDetector";

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';
	public dtxMode = false;
	public remoteOutboundTrackPaused = false;

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
		this.detectors = new Detectors(
			new DryInboundTrackDetector(this),
		);

		if (this.kind === 'audio') {
			this.detectors.add(new AudioDesyncDetector(this));
			this.calculatedScore.weight = 1;
		} else if (this.kind === 'video') {
			this.detectors.add(new FreezedVideoTrackDetector(this));
			this.detectors.add(new PlayoutDiscrepancyDetector(this));
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
		return this._inboundRtp.fractionLost;
	}

	public update() {
		this.detectors.update();
	}

	public createSample(): InboundTrackSample {
			let scoreReasons: string | undefined;
			if (this.kind === 'audio') {
				scoreReasons = this.getPeerConnection()?.parent.scoreCalculator?.encodeInboundAudioScoreReasons?.(this.calculatedScore.reasons);
			} else if (this.kind === 'video') {
				scoreReasons = this.getPeerConnection()?.parent.scoreCalculator?.encodeInboundVideoScoreReasons?.(this.calculatedScore.reasons);
			}
			
			return {
				id: this.track.id,
				kind: this.track.kind,
				timestamp: Date.now(),
				attachments: this.attachments,
				score: this.score,
				scoreReasons,
			};
		}
}