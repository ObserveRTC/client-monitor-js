import { Detector } from "./Detector";
import type { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";

/**
 * What the detector measured about the capture device in the window that raised the issue.
 *
 * Every field not marked optional is always present: the detector cannot reach the raise without
 * it. The track's own `readyState` and `muted` are not carried, because the detector only raises
 * on a track that is live, unmuted and enabled, so they could only ever read `'live'` and `false`.
 */
export type VideoCaptureBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;

	/** The frames per second the track was configured to capture, from `getSettings().frameRate`. */
	expectedFps: number;

	/** The average frames per second the media source produced over the detection window. */
	producedFpsForDetection: number;

	/** The number of frames the media source produced over the detection window. */
	producedFramesForDetection: number;

	/** The milliseconds of stats time the detection window spanned. */
	detectionWindowInMs: number;

	/**
	 * The share of the configured frame rate the camera failed to deliver,
	 * `1 - producedFpsForDetection / expectedFps`. Zero is a camera meeting its rate and one is a
	 * camera delivering nothing; a camera exceeding its rate reports a negative.
	 */
	produceDegradation: number;

	/** The frame width and height the track was configured for, from `getSettings()`. */
	trackSettingsHeight?: number;
	trackSettingsWidth?: number;

	// Written at resolution, from the recovery window that ended the issue. Absent when it was
	// resolved by a stand-down instead, where nothing was measured.

	/** The milliseconds of stats time the recovery window spanned. */
	recoveryWindowInMs?: number;

	/** The average frames per second the media source produced over the recovery window. */
	producedFpsForRecovery?: number;

	/** The number of frames the media source produced over the recovery window. */
	producedFramesForRecovery?: number;
}

export type VideoCaptureBottleneckIssueType = 'video-capture-bottleneck';

export type VideoCaptureBottleneckDetectorConfig = {
	/**
	 * The share of the configured frame rate the camera may fall short by before the issue is
	 * raised, and must return to before it resolves.
	 */
	produceDegradationThreshold: number;
}


/**
 * Reports a camera failing to deliver the frames the track was configured to capture, while the
 * track reports itself `live` and unmuted throughout — a struggling driver, another application
 * contending for the device, thermal throttling. Use it to place a stuttery outgoing picture at the
 * capture stage rather than at the encoder (`EncoderBottleneckDetector`) or on the network.
 *
 * The frames the media source produced are summed by `OutboundTrackMonitor.slicedWindow`
 * over two windows, and this compares each average against `getSettings().frameRate`. The detection
 * window raises: falling short by more than `produceDegradationThreshold` of the configured rate
 * opens the issue, and every later collection still short of it updates the issue rather than
 * opening another. The recovery window resolves: the issue ends only once the stretch *before* the
 * detection window is back within the threshold, so a camera hovering at the line cannot flap one
 * long fault into a stream of short ones. Neither window is read before it says it is ready.
 *
 * Averaging over a window rather than judging each collection is what catches a camera whose
 * starving stretches are interleaved with healthy ones, and it weighs how far the source fell short
 * rather than only how often.
 *
 * A finding means the fault is upstream of the encoder and the network: nothing downstream can
 * recover frames the camera never produced.
 *
 * It stands down — reporting `undefined` rather than a verdict — for a backgrounded tab, a paused
 * sender, a track that is not live, unmuted and enabled, a screen share, a capture format that just
 * changed, a track with no configured frame rate, and a window holding no measured frames.
 *
 * Issue raised: `video-capture-bottleneck`, updated while it stays open, resolved on recovery or on
 * a stand-down. No monitor event.
 * Config: `videoCaptureBottleneckDetector`.
 * Track attribute: `OutboundTrackMonitor.degradedVideoCapture`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — capture to frame supply
 *
 */

export class VideoCaptureBottleneckDetector implements Detector {
	public static readonly ISSUE_TYPE: VideoCaptureBottleneckIssueType = 'video-capture-bottleneck';

	public readonly name = 'video-capture-bottleneck-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private _raised = false;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._issueKey = `${VideoCaptureBottleneckDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;

		if (this.config.produceDegradationThreshold < 0) {
			this.trackMonitor.getPeerConnection().parent.logger.warn(
				'videoCaptureBottleneckDetector.produceDegradationThreshold must not be below 0, got '+ this.config.produceDegradationThreshold
			);
			this.config.produceDegradationThreshold = 0;
		}
	}

	private get config(): VideoCaptureBottleneckDetectorConfig {
		return this.peerConnection.parent.config.videoCaptureBottleneckDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.degradedVideoCapture = undefined;

			return;
		}
		const track = this.trackMonitor.track;

		if (!this.peerConnection.parent.activeTab) return this._clear({
			comment: 'tab in background',
		});
		if (this.trackMonitor.paused) return this._clear({
			comment: 'track paused'
		});
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._clear({
			comment: 'track not sending',
		});
		if (this.trackMonitor.isScreenShare) return this._clear({
			comment: 'screen share',
		});

		// The track monitor read the settings once for every detector on this track and already
		// said whether the capture format moved, so this only has to act on the answer.
		if (this.trackMonitor.videoCaptureSettingsChanged) return this._clear({
			comment: 'capture settings changed',
		});

		const {
			detection: detectionWindow,
			recovery: recoveryWindow,
		} = this.trackMonitor.slicedWindow.slices;
		const trackSettings = this.trackMonitor.settings;
		const expectedFps = trackSettings?.frameRate;
		const producedFramesForDetection = detectionWindow.deltaMediaSourceTotalProducedFrames;
		const detectionWindowInMs = detectionWindow.durationInMs;

		if (expectedFps === undefined) return this._clear({
			comment: 'no configured frame rate',
		});
		if (producedFramesForDetection === null) return this._clear({
			comment: 'no source frames in window',
		});
		if (!detectionWindow.isReady || detectionWindowInMs < 1) return;

		const producedFpsForDetection = producedFramesForDetection / (detectionWindowInMs / 1000);
		const produceDegradation = 1 - (producedFpsForDetection / expectedFps);

		this.trackMonitor.videoCaptureDegradation = produceDegradation;

		if (this.config.produceDegradationThreshold < produceDegradation) {
			if (!this._raised) return this._raiseIssue({
					peerConnectionId: this.peerConnection.peerConnectionId,
					trackId: track.id,
					expectedFps,
					produceDegradation,
					producedFpsForDetection,
					producedFramesForDetection,
					detectionWindowInMs,
					trackSettingsHeight: trackSettings?.height,
					trackSettingsWidth: trackSettings?.width,
				});

			return;
		}

		// Below the threshold with nothing open: the camera was judged and found fine, which is not
		// the same as not having been judged at all.
		if (!this._raised) return this._clear({
			comment: 'capture within tolerance',
			degradedVideoCapture: false,
		});

		// Below the threshold with a finding open: the recovery window decides whether it ends.

		if (
			!recoveryWindow.isReady ||
			recoveryWindow.deltaMediaSourceTotalProducedFrames === null ||
			recoveryWindow.durationInMs < 1
		)
		{
				return;
		}

		const recoveryWindowInMs = recoveryWindow.durationInMs;
		const producedFramesForRecovery = recoveryWindow.deltaMediaSourceTotalProducedFrames;
		const producedFpsForRecovery = producedFramesForRecovery / (recoveryWindowInMs / 1000);
		const recoveryDegradation = 1 - (producedFpsForRecovery / expectedFps);

		if (this.config.produceDegradationThreshold < recoveryDegradation) {
			return;
		}

		this._clear({
			comment: 'capture recovered',
			payload: {
				producedFpsForRecovery,
				producedFramesForRecovery,
				recoveryWindowInMs,
			},
			degradedVideoCapture: false,
		});
	}


	private _raiseIssue(payload: VideoCaptureBottleneckIssuePayload) {
		if (this._raised) return;

		this._raised = true;
		this.trackMonitor.degradedVideoCapture = true;

		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: VideoCaptureBottleneckDetector.ISSUE_TYPE,
			payload,
			timestamp: Date.now(),
		});
	}

	private _clear(options: {
		comment: string,
		payload?: Pick<VideoCaptureBottleneckIssuePayload, 'producedFpsForRecovery' | 'producedFramesForRecovery' | 'recoveryWindowInMs'>,
		degradedVideoCapture?: false
	}) {
		this.trackMonitor.degradedVideoCapture = options.degradedVideoCapture;
		// Blanked only on a stand-down, where nothing was measured. A verdict of `false` was measured
		// — a camera 0.15 short is judged fine and still 0.15 short — and flattening it to 0 would
		// leave the score calculator nothing to read below the threshold, which is the whole point
		// of carrying a continuous value beside the flag.
		if (options.degradedVideoCapture !== false) this.trackMonitor.videoCaptureDegradation = undefined;

		if (!this._raised) return;

		this._raised = false;

		this.trackMonitor.issues.resolve({
			key: this._issueKey,
			comment: options.comment,
			payload: options.payload,
			resolvedAt: Date.now(),
		});
	}
}
