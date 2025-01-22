import { Detectors } from "../detectors/Detectors";
import { TrackStats } from "../schema/ClientSample";
import { CalculatedScore } from "../scores/CalculatedScore";
import { MediaSourceMonitor } from "./MediaSourceMonitor";
import { OutboundRtpMonitor } from "./OutboundRtpMonitor";

export class OutboundTrackMonitor {
	public appData?: Record<string, unknown>;

	public readonly direction = 'outbound';
	public readonly detectors: Detectors;
	public readonly mappedOutboundRtps = new Map<number, OutboundRtpMonitor>();
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';

	public calculatedScore: CalculatedScore = {
		weight: 1,
		value: undefined,
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public constructor(
		public readonly track: MediaStreamTrack,
		private _mediaSource: MediaSourceMonitor,
	) {
		this.detectors = new Detectors();
		
	}


	public getPeerConnection() {
		return this._mediaSource.getPeerConnection();
	}

	public get kind() {
		return this._mediaSource.kind;
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
			this.fractionLost += outboundRtp.getRemoteInboundRtp()?.fractionLost ?? 0;
			this.sendingPacketRate += outboundRtp.packetRate ?? 0;
			this.remoteReceivedPacketRate += outboundRtp.getRemoteInboundRtp()?.packetRate ?? 0;
		}

		this.detectors.update();
	} 
	
	public getOutboundRtps() {
		return Array.from(this.mappedOutboundRtps.values());
	}

	public getHighestLayer() {
		const outboundRtps = Array.from(this.mappedOutboundRtps.values());

		if (outboundRtps.length === 0) return undefined;
		if (outboundRtps.length === 1) return outboundRtps[0];

		let highestLayer: OutboundRtpMonitor | undefined;
		let highestBitrate = 0;

		for (const outboundRtp of this.mappedOutboundRtps.values()) {
			if (outboundRtp.bitrate && outboundRtp.bitrate > highestBitrate) {
				highestLayer = outboundRtp;
				highestBitrate = outboundRtp.bitrate;
			}
		}

		return highestLayer;
	}

	public createSample(): TrackStats {
		return {
			id: this.track.id,
			timestamp: Date.now(),
			appData: this.appData,
		};
	}
}