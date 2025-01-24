import { AudioDesyncDetector } from "../detectors/AudioDesyncDetector";
import { Detectors } from "../detectors/Detectors";
import { FreezedVideoTrackDetector } from "../detectors/FreezedVideoTrackDetector";
import { DryInboundTrackDetector } from "../detectors/DryInboundTrack";
import { CalculatedScore } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { TrackSample } from "../schema/ClientSample";

export class InboundTrackMonitor {
	public static applyOnAppDataAtSampling = <T extends Record<string, unknown> = Record<string, unknown>>(appData: Record<string, unknown>) => {
		return {
			...appData,
		};
	}

	public appData?: Record<string, unknown>;

	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';
	public dtxMode = false;

	public calculatedScore: CalculatedScore = {
		weight: 1,
		value: undefined,
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public constructor(
		public readonly track: MediaStreamTrack,
		private readonly _inboundRtp: InboundRtpMonitor,
	) {
		this.detectors = new Detectors(
			new DryInboundTrackDetector(this),
		);

		if (this.kind === 'audio') {
			this.detectors.add(new AudioDesyncDetector(this));
		} else if (this.kind === 'video') {
			this.detectors.add(new FreezedVideoTrackDetector(this));
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

	public createSample(): TrackSample {
			return {
				id: this.track.id,
				kind: this.track.kind,
				timestamp: Date.now(),
				appData: this.appData,
				score: this.score,
			};
		}
}