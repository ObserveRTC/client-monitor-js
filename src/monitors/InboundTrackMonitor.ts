import { AudioDesyncDetector } from "../detectors/AudioDesyncDetector";
import { Detectors } from "../detectors/Detectors";
import { FreezedVideoTrackDetector } from "../detectors/FreezedVideoTrackDetector";
import { StuckedInboundTrackDetector } from "../detectors/StuckedInboundTrack";
import { CalculatedScore } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';
	public dtxMode = false;

	public calculatedScore: CalculatedScore = {
		weight: 1,
		value: undefined,
		remarks: [],
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public constructor(
		public readonly trackIdentifier: string,
		public readonly getInboundRtp: () => InboundRtpMonitor,
	) {
		this.detectors = new Detectors(
			new StuckedInboundTrackDetector(this),
		);

		if (this.kind === 'audio') {
			this.detectors.add(new AudioDesyncDetector(this));
		} else if (this.kind === 'video') {
			this.detectors.add(new FreezedVideoTrackDetector(this));
		}
		
		// for mediasoup probator we don't need to run detectors
		if (this.trackIdentifier === 'probator') {
			this.detectors.clear();
		}
	}

	public getPeerConnection() {
		return this.getInboundRtp().getPeerConnection();
	}

	public get kind() {
		return this.getInboundRtp().kind;
	}

	public get bitrate() {
		return this.getInboundRtp().bitrate;
	}

	public get jitter() {
		return this.getInboundRtp().jitter;
	}

	public get fractionLost() {
		return this.getInboundRtp().fractionLost;
	}

	public update() {
		this.detectors.update();
	}
}