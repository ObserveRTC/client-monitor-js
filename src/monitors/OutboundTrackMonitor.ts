import { Detectors } from "../detectors/Detectors";
import { CaptureTrackMutedDetector } from "../detectors/CaptureTrackMutedDetector";
import { SilentAudioSourceDetector, SilentAudioSourceIssuePayload } from "../detectors/SilentAudioSourceDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";
import { VideoCaptureBottleneckDetector, VideoCaptureBottleneckIssuePayload } from "../detectors/VideoCaptureBottleneckDetector";
import { EncoderBottleneckDetector, EncoderBottleneckIssuePayload } from "../detectors/EncoderBottleneckDetector";
import { SimulcastLayerDetector } from "../detectors/SimulcastLayerDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { OutboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { CalculatedScore } from "../scores/CalculatedScore";
import { MediaSourceMonitor } from "./MediaSourceMonitor";
import { OutboundRtpMonitor } from "./OutboundRtpMonitor";
import type { TrackContentType } from "./TrackMonitor";
import { IssueRegistry } from "../utils/IssueRegistry";
import {
	DryOutboundTrackDetector,
	DryOutboundTrackIssuePayload
} from "../detectors/DryOutboundTrackDetector";
import {
	CaptureSourceLostDetector,
	CaptureSourceLostIssuePayload
} from "../detectors/CaptureSourceLostDetector";
import { DetectionRecoveryWindow } from "../utils/DetectionRecoveryWindow";



/** Narrower than its inbound counterpart: the sender cannot know how a track is watched. */
export type OutboundTrackContext = {
	contentType?: TrackContentType;
}

/**
 * Every issue an outbound track can carry, keyed by the detector that raises it. This is what
 * `issues` is typed to, so a detector cannot raise a type this track has no business reporting,
 * and adding a detector without adding it here fails to compile at the detector's `raise`.
 *
 * Only detectors that raise a *stateful* issue appear. The telemetry ones on this track —
 * `CaptureTrackMutedDetector`, `CodecChangeDetector`, `SimulcastLayerDetector`,
 * `VideoResolutionChangeDetector` — emit events and raise nothing, so they have no entry.
 */
export type OutboundTrackIssues = {
	[DryOutboundTrackDetector.ISSUE_TYPE]: DryOutboundTrackIssuePayload,
	[CaptureSourceLostDetector.ISSUE_TYPE]: CaptureSourceLostIssuePayload,
	[EncoderBottleneckDetector.ISSUE_TYPE]: EncoderBottleneckIssuePayload,
	[VideoCaptureBottleneckDetector.ISSUE_TYPE]: VideoCaptureBottleneckIssuePayload,
	[SilentAudioSourceDetector.ISSUE_TYPE]: SilentAudioSourceIssuePayload,
}

export class OutboundTrackMonitor {
	public readonly direction = 'outbound';
	public readonly detectors: Detectors;
	public readonly issues: IssueRegistry<OutboundTrackIssues>;
	/**
	 * Retains frame deltas used by pipeline detectors to evaluate current activity
	 * and determine when detected issues can be raised or cleared.
	 */
	public readonly detectionRecoveryWindow: DetectionRecoveryWindow<{
		mediaSourceTotalProducedFrames: number | null;
		highestLayerTotalEncodedFrames: number | null;
	}>;

	/**
	 * Frames encoded by whichever layer was the highest at the time, accumulated across collections.
	 *
	 * `OutboundRtpMonitor.framesEncoded` cannot be used directly: it counts one layer, and
	 * {@link highestLayer} changes as simulcast adapts, so differencing it across a switch subtracts
	 * one layer's total from another's. Accumulating each collection's own delta gives a counter
	 * that belongs to the track and only ever moves forward.
	 */
	private _highestLayerTotalEncodedFrames = 0;

	public bitrate?: number;
	public jitter?: number;
	public fractionLost?: number;
	public sendingPacketRate?: number;
	public remoteReceivedPacketRate?: number;

	/**
	 * True once the capture source behind this track went away on its own, never for a track
	 * the application stopped itself. `readyState` cannot make that distinction; the `ended`
	 * event, which this is set from, fires only for the former.
	 */
	public sourceEnded = false;
	public readonly mappedOutboundRtps = new Map<number, OutboundRtpMonitor>();

	/**
	 * True while the sender behind this track is deliberately paused. A paused track
	 * legitimately sends nothing, so detectors that read silence as a failure stand down.
	 */
	public paused = false;

	// ---- Pipeline disruption ------------------------------------------------
	// One flag per detector that judges this track, each owned solely by its detector and
	// named after the fault it reports. Tri-state on purpose:
	//
	//   true      that detector's finding is open right now
	//   false     it looked this collection and found nothing wrong
	//   undefined it could not judge — disabled, no config, paused, muted, backgrounded, or missing the counters it reads
	//
	// `undefined` is never "healthy": counting healthy tracks means testing for `false`
	// explicitly, so a stretch nobody examined is not silently counted as fine.

	/** A copy of `track.getSettings()` taken at this collection; undefined if the track has none or it threw. */
	public settings?: MediaTrackSettings;

	/** Whether frameRate, width or height differ from the previous collection; undefined until the first one. */
	public videoCaptureSettingsChanged?: boolean;

	/**
	 * The capture source delivering fewer frames than the track was configured for — the send-side
	 * twin of the inbound flag of the same name. `VideoCaptureBottleneckDetector`.
	 */
	public degradedVideoCapture?: boolean;

	// Beside each flag, the measurement it was a verdict on. The flag says whether a threshold was
	// crossed; the number says by how much, on every collection that was judged rather than only
	// the ones that crossed. Same tri-state: undefined is "not judged", and a measured value stands
	// whether or not it was found to be a fault.

	/** The share of the configured frame rate the camera failed to deliver, `0..1`. */
	public videoCaptureDegradation?: number;

	/** The encoder failing to keep up with the frames the source delivered. `EncoderBottleneckDetector`. */
	public degradedEncodingPerformance?: boolean;

	/** The share of the frames handed to the encoder that it did not encode, `0..1`. */
	public videoEncodingDegradation?: number;

	/** Nothing at all leaving this track for long enough to be a fault. `DryOutboundTrackDetector`. */
	public dry?: boolean;

	/** A live, unmuted microphone capturing nothing but digital silence. `SilentAudioSourceDetector`. */
	public silentAudioSource?: boolean;

	/**
	 * The capture device behind this track taken away. `CaptureSourceLostDetector`, whose finding is
	 * terminal — once `true` this never returns to `false`.
	 */
	public lostCaptureSource?: boolean;

	/**
	 * What kind of content this video track carries; screen-share is scored differently from
	 * camera, and an undefined video track is scored as camera. Auto-detected from
	 * `getSettings().displaySurface`, otherwise declared by the application via `setContext`.
	 */
	public contentType?: TrackContentType;

	public calculatedScore: CalculatedScore = {
		weight: 1,
		value: undefined,
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public get scoreReasons() {
		return this.calculatedScore.reasons;
	}

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly track: MediaStreamTrack,
		private _mediaSource: MediaSourceMonitor,
		attachments?: Record<string, unknown>,
	) {
		this.attachments = attachments;
		this.detectors = new Detectors();
		this.issues = new IssueRegistry<OutboundTrackIssues>(
			this.getPeerConnection().parent.activeIssues.asSink
		);

		this._refreshCaptureSettings();

		if ((this.settings as { displaySurface?: string } | undefined)?.displaySurface !== undefined) {
			this.contentType = 'screenshare';
		}

		const monitorConfig = this.getPeerConnection().parent.config;

		if (monitorConfig.dryOutboundTrackDetector !== null) {
			this.detectors.add(new DryOutboundTrackDetector(this));
		}
		if (monitorConfig.captureSourceLostDetector !== null) {
			this.detectors.add(new CaptureSourceLostDetector(this));
		}
		if (monitorConfig.captureTrackMutedDetector !== null) {
			this.detectors.add(new CaptureTrackMutedDetector(this));
		}
		if (monitorConfig.codecChangeDetector !== null) {
			this.detectors.add(new CodecChangeDetector(this));
		}

		if (this.kind === 'audio') {
			if (monitorConfig.silentAudioSourceDetector !== null) {
				this.detectors.add(new SilentAudioSourceDetector(this));
			}
		} else if (this.kind === 'video') {
			// Registration order is the run order, but no detector below depends on another's
			// verdict, so any of them can be disabled or reordered independently.
			if (monitorConfig.videoCaptureBottleneckDetector !== null) {
				this.detectors.add(new VideoCaptureBottleneckDetector(this));
			}
			if (monitorConfig.encoderBottleneckDetector !== null) {
				this.detectors.add(new EncoderBottleneckDetector(this));
			}
			if (monitorConfig.simulcastLayerDetector !== null) {
				this.detectors.add(new SimulcastLayerDetector(this));
			}
			if (monitorConfig.videoResolutionChangeDetector !== null) {
				this.detectors.add(new VideoResolutionChangeDetector(this));
			}
		}

		this.detectionRecoveryWindow = new DetectionRecoveryWindow(
			_mediaSource.getPeerConnection().parent.config.outboundTrackDetectionRecoveryWindow
		);

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

	public highestLayer?: OutboundRtpMonitor;

	public update() {
		this._refreshCaptureSettings();

		this.bitrate = 0;
		this.jitter = 0;
		this.fractionLost = 0;
		this.sendingPacketRate = 0;
		this.remoteReceivedPacketRate = 0;
		this.highestLayer = undefined;

		for (const outboundRtp of this.mappedOutboundRtps.values()) {
			this.bitrate += outboundRtp.bitrate ?? 0;
			this.jitter += outboundRtp.getRemoteInboundRtp()?.jitter ?? 0;
			this.fractionLost += outboundRtp.getRemoteInboundRtp()?.deltaFractionLost ?? 0;
			this.sendingPacketRate += outboundRtp.packetRate ?? 0;
			this.remoteReceivedPacketRate += outboundRtp.getRemoteInboundRtp()?.packetRate ?? 0;

			if (this.highestLayer) {
				if ((outboundRtp.bitrate ?? 0) > (this.highestLayer.bitrate ?? 0)) {
					this.highestLayer = outboundRtp;
				}
			} else {
				this.highestLayer = outboundRtp;
			}
		}

		this._highestLayerTotalEncodedFrames += this.highestLayer?.deltaFramesEncoded ?? 0;

		this.detectionRecoveryWindow.add({
			timestamp: this._mediaSource.statsClockTime,
			value: {
				mediaSourceTotalProducedFrames: this._mediaSource.frames ?? null,
				highestLayerTotalEncodedFrames: this._highestLayerTotalEncodedFrames,
			},
		});

		this.detectors.update();
	}

	/**
	 * Reads the track's settings once, before the detectors run, and says whether the capture
	 * format moved since last tick.
	 *
	 * The comparison is on frame rate and frame size only. Everything else `getSettings()` reports
	 * — device id, facing mode, background blur — can change without making the frame counts
	 * either side of it incomparable, which is the only question this answers.
	 */
	private _refreshCaptureSettings(): void {
		const previous = this.settings;

		try {
			const settings = this.track.getSettings?.();

			// Copied, not held: the comparison below is against what the track reported *last*
			// tick, and a browser returning the same live object each call would otherwise have
			// this comparing an object with itself and never seeing a change. It also keeps a
			// reader of `captureSettings` from holding a handle into the track's own state.
			this.settings = settings ? { ...settings } : undefined;
		} catch {
			// Some platforms throw for a track being torn down.
			this.settings = undefined;
		}

		this.videoCaptureSettingsChanged = previous === undefined
			? undefined
			: previous.frameRate !== this.settings?.frameRate
				|| previous.width !== this.settings?.width
				|| previous.height !== this.settings?.height;
	}

	public getOutboundRtps() {
		return Array.from(this.mappedOutboundRtps.values());
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