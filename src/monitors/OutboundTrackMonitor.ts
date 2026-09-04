import { Detectors } from "../detectors/Detectors";
import { DryOutboundTrackDetector } from "../detectors/DryOutboundTrackDetector";
import { CaptureSourceLostDetector } from "../detectors/CaptureSourceLostDetector";
import { CaptureTrackMutedDetector } from "../detectors/CaptureTrackMutedDetector";
import { SilentAudioSourceDetector } from "../detectors/SilentAudioSourceDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";
import { SourceCaptureBottleneckDetector } from "../detectors/SourceCaptureBottleneckDetector";
import { EncoderPerformanceDetector } from "../detectors/EncoderPerformanceDetector";
import { SimulcastLayerDetector } from "../detectors/SimulcastLayerDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { OutboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { CalculatedScore } from "../scores/CalculatedScore";
import { MediaSourceMonitor } from "./MediaSourceMonitor";
import { OutboundRtpMonitor } from "./OutboundRtpMonitor";
import type { TrackContentType } from "./TrackMonitor";

/**
 * Narrower than its inbound counterpart on purpose: motion class and
 * presentation describe how a track is *watched*, which the sender cannot know.
 */
export type OutboundTrackContext = {
	contentType?: TrackContentType;
}

export class OutboundTrackMonitor {
	public readonly direction = 'outbound';
	public readonly detectors: Detectors;

	/**
	 * True once the capture source behind this track went away on its own — the
	 * device was unplugged, the link dropped, the user stopped the share or revoked
	 * the permission. Set from the track's `ended` event by `PeerConnectionMonitor`,
	 * and never true for a track the application stopped itself.
	 *
	 * That distinction is the whole value of the flag, and it is only available here.
	 * `readyState` reaches `ended` either way, so it cannot tell a lost device from a
	 * deliberate teardown; the `ended` event fires only for the former, since
	 * `stop()` is by specification the one way a track ends without it.
	 */
	public sourceEnded = false;
	public readonly mappedOutboundRtps = new Map<number, OutboundRtpMonitor>();

	/**
	 * True while the sender behind this track is deliberately paused — a
	 * mediasoup producer that got `pause()`d (kept in sync by
	 * `MediasoupTransportBinding`), or whatever the application sets it to on
	 * plain RTCPeerConnection setups. While paused, the track legitimately
	 * sends nothing, so detectors that read silence as a failure
	 * (dry-outbound-track) stand down instead of raising a false issue.
	 */
	public paused = false;

	/**
	 * What kind of content this track carries. Only meaningful for video
	 * tracks — audio tracks leave it `undefined`, and an undefined video track
	 * is scored as camera content. Screen-share tracks are scored differently
	 * from camera tracks — sharpness over motion, no frame-rate or
	 * bitrate-volatility expectations — so getting this right matters for the
	 * track score.
	 *
	 * Auto-detected at construction only from `track.getSettings().displaySurface`,
	 * which exists exclusively on display capture. The content hint is deliberately
	 * NOT used for inference — applications set `'detail'`/`'text'` on camera
	 * tracks too, so the hint is not a reliable screen-share signal. When no
	 * `displaySurface` is available, the application declares it explicitly:
	 *
	 * ```ts
	 * monitor.getOutboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
	 * ```
	 */
	public contentType?: TrackContentType;

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

		if (typeof track.getSettings === 'function' &&
			(track.getSettings() as { displaySurface?: string }).displaySurface !== undefined) {
			this.contentType = 'screenshare';
		}

		const monitorConfig = this.getPeerConnection().parent.config;

		if (monitorConfig.dryOutboundTrackDetector !== null) {
			this.detectors.add(new DryOutboundTrackDetector(this));
		}
		// The three capture-side findings — the device gone, the OS taking it away,
		// a live microphone producing silence — share nothing, so each is its own
		// class with its own config key.
		if (monitorConfig.captureSourceLostDetector !== null) {
			this.detectors.add(new CaptureSourceLostDetector(this));
		}
		if (monitorConfig.captureTrackMutedDetector !== null) {
			this.detectors.add(new CaptureTrackMutedDetector(this));
		}
		if (monitorConfig.silentAudioSourceDetector !== null) {
			this.detectors.add(new SilentAudioSourceDetector(this));
		}
		if (monitorConfig.codecChangeDetector !== null) {
			this.detectors.add(new CodecChangeDetector(this));
		}

		if (this.kind === 'audio') this.calculatedScore.weight = 1;
		else if (this.kind === 'video') {
			// Registration order is the run order, but nothing here depends on it any
			// more: `EncoderPerformanceDetector` used to read whether
			// `capture-bottleneck` was active this tick and now re-derives that
			// condition itself, comparing `mediaSource.sourceFps` against the
			// `frameRate` in the track's own `getSettings()`. So either of these two
			// can be disabled, or reordered, without changing what the other
			// concludes — which is what makes the config keys below independently
			// meaningful rather than a chain a user can accidentally break.
			if (monitorConfig.sourceCaptureBottleneckDetector !== null) {
				this.detectors.add(new SourceCaptureBottleneckDetector(this));
			}
			if (monitorConfig.encoderPerformanceDetector !== null) {
				this.detectors.add(new EncoderPerformanceDetector(this));
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

	/** True when this track carries screen-share content. See `contentType`. */
	public get isScreenShare() {
		return this.contentType === 'screenshare';
	}

	/** **Merges** — an explicit `undefined` means "not declared here", not a reset. */
	public setContext(context: OutboundTrackContext): void {
		if (context.contentType !== undefined) this.contentType = context.contentType;
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
		return {
			id: this.track.id,
			kind: this.kind,
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