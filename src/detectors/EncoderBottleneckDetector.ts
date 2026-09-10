import { Detector } from "./Detector";
import type { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";

/**
 * What the detector measured about the encoder in the window that raised the issue.
 *
 * Every field not marked optional is always present: the detector cannot reach the raise without
 * it. The track's own `readyState` and `muted` are not carried, because the detector only raises
 * on a track that is live, unmuted and enabled, so they could only ever read `'live'` and `false`.
 */
export type EncoderBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;

	/** The average frames per second the media source handed the encoder over the detection window. */
	producedFpsForDetection: number;

	/** The number of frames the media source handed the encoder over the detection window. */
	producedFramesForDetection: number;

	/** The average frames per second the highest layer encoded over the detection window. */
	encodedFpsForDetection: number;

	/** The number of frames the highest layer encoded over the detection window. */
	encodedFramesForDetection: number;

	/** The milliseconds of stats time the detection window spanned. */
	detectionWindowInMs: number;

	/**
	 * The share of the frames handed over that the encoder did not encode,
	 * `1 - encodedFpsForDetection / producedFpsForDetection`. Zero is an encoder keeping up with its
	 * source and one is an encoder emitting nothing; an encoder ahead of the source, which counters
	 * read a frame apart can produce, reports a negative.
	 */
	encodeDegradation: number;

	/** What the browser said was limiting the encoder when the issue opened. */
	qualityLimitationReason?: string;

	/** Which encoder was running, and whether the browser called it power efficient. */
	encoderImplementation?: string;
	powerEfficientEncoder?: boolean;

	// Written at resolution, from the recovery window that ended the issue. Absent when it was
	// resolved by a stand-down instead, where nothing was measured.

	/** The milliseconds of stats time the recovery window spanned. */
	recoveryWindowInMs?: number;

	/** The average frames per second the media source handed over during the recovery window. */
	producedFpsForRecovery?: number;

	/** The number of frames the media source handed over during the recovery window. */
	producedFramesForRecovery?: number;

	/** The average frames per second the highest layer encoded during the recovery window. */
	encodedFpsForRecovery?: number;

	/** The number of frames the highest layer encoded during the recovery window. */
	encodedFramesForRecovery?: number;
}

export type EncoderBottleneckIssueType = 'encoder-bottleneck';

export type EncoderBottleneckDetectorConfig = {
	/**
	 * The share of the frames handed to the encoder that it may fail to encode before the issue is
	 * raised, and must return to before it resolves.
	 */
	encodeDegradationThreshold: number;
}


/**
 * Given a capture source that is delivering, is the encoder keeping up with it? Use it to tell a
 * struggling encoder apart from a starving camera, which is `VideoCaptureBottleneckDetector`'s
 * subject. The send-side mirror of `DecoderPerformanceDetector`.
 *
 * Both counters come from `OutboundTrackMonitor.slicedWindow`: the frames the media
 * source produced and the frames the highest layer encoded, each measured across the same stretch.
 * The detection window raises — leaving more than `encodeDegradationThreshold` of the frames handed
 * over unencoded opens the issue, and every later collection still short of it updates that issue
 * rather than opening another. The recovery window resolves: the issue ends only once the stretch
 * *before* the detection window is back within the threshold, so an encoder hovering at the line
 * cannot flap one long fault into a stream of short ones. Neither window is read before it says it
 * is ready.
 *
 * The comparison is always against what the source actually delivered, never the configured frame
 * rate, so a starving camera cannot make the encoder look guilty — handed nothing, it has nothing
 * to answer for and the detector stands down. That is also why screen shares are judged like any
 * other track: their frame rate follows the content, and the encoder is still expected to keep up
 * with whatever it is given.
 *
 * A finding means the frames existed and the encoder did not get through them: too much resolution
 * for the machine, a software codec where hardware was expected, or the CPU taken by something
 * else. `qualityLimitationReason` and `encoderImplementation` are carried for that diagnosis.
 *
 * It stands down — reporting `undefined` rather than a verdict — for a backgrounded tab, a paused
 * sender, a track that is not live, unmuted and enabled, a capture format that just changed, a
 * track with no active layer, and a window in which the source handed over nothing.
 *
 * Issue raised: `encoder-bottleneck`, updated while it stays open, resolved on recovery or on a
 * stand-down. No monitor event.
 * Config: `encoderBottleneckDetector`.
 * Track attribute: `OutboundTrackMonitor.degradedEncodingPerformance`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — frames to encoder
 *
 */

export class EncoderBottleneckDetector implements Detector {
	public static readonly ISSUE_TYPE: EncoderBottleneckIssueType = 'encoder-bottleneck';

	public readonly name = 'encoder-bottleneck-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private _raised = false;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._issueKey = `${EncoderBottleneckDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;

		// Read without the getter's non-null assertion: a monitor builds this detector whenever the
		// key is not explicitly `null`, which includes a config that never mentioned it at all.
		const config = this.peerConnection.parent.config.encoderBottleneckDetector;

		if (config && config.encodeDegradationThreshold < 0) {
			this.peerConnection.parent.logger.warn(
				'encoderBottleneckDetector.encodeDegradationThreshold must not be below 0, got '
				+ config.encodeDegradationThreshold
			);
			config.encodeDegradationThreshold = 0;
		}
	}

	private get config(): EncoderBottleneckDetectorConfig {
		return this.peerConnection.parent.config.encoderBottleneckDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.degradedEncodingPerformance = undefined;

			return;
		}
		const track = this.trackMonitor.track;

		if (!this.peerConnection.parent.activeTab) return this._clear({
			comment: 'tab in background',
		});
		if (this.trackMonitor.paused) return this._clear({
			comment: 'track paused',
		});
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._clear({
			comment: 'track not sending',
		});

		// The track monitor read the settings once for every detector on this track and already said
		// whether the capture format moved. A new frame size changes what encoding costs, so the
		// collections either side of it are not comparable.
		if (this.trackMonitor.videoCaptureSettingsChanged) return this._clear({
			comment: 'capture settings changed',
		});

		const highestLayer = this.trackMonitor.highestLayer;

		// No layer is nothing to hold responsible: a track sending nothing at all is
		// `DryOutboundTrackDetector`'s subject, not this one's.
		if (!highestLayer || highestLayer.active === false) return this._clear({
			comment: 'no active layer',
		});

		const {
			detection: detectionWindow,
			recovery: recoveryWindow,
		} = this.trackMonitor.slicedWindow.slices;
		const producedFramesForDetection = detectionWindow.deltaMediaSourceTotalProducedFrames;
		const encodedFramesForDetection = detectionWindow.deltaHighestLayerTotalEncodedFrames;
		const detectionWindowInMs = detectionWindow.durationInMs;

		if (producedFramesForDetection === null) return this._clear({
			comment: 'no source frames in window',
		});
		if (encodedFramesForDetection === null) return this._clear({
			comment: 'no encoded frames in window',
		});
		if (!detectionWindow.isReady || detectionWindowInMs < 1) return;

		const producedFpsForDetection = producedFramesForDetection / (detectionWindowInMs / 1000);
		const encodedFpsForDetection = encodedFramesForDetection / (detectionWindowInMs / 1000);

		// Nothing handed over is nothing to encode, and no denominator to take a share of.
		if (producedFpsForDetection <= 0) return this._clear({
			comment: 'source handed over no frames',
		});

		const encodeDegradation = 1 - (encodedFpsForDetection / producedFpsForDetection);

		// Beside the flag and the issue: the measurement itself, on every judged collection, so the
		// score calculator has a continuous number below the threshold as well as above it.
		this.trackMonitor.videoEncodingDegradation = encodeDegradation;

		if (this.config.encodeDegradationThreshold < encodeDegradation) {
			if (!this._raised) return this._raiseIssue({
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				encodeDegradation,
				producedFpsForDetection,
				producedFramesForDetection,
				encodedFpsForDetection,
				encodedFramesForDetection,
				detectionWindowInMs,
				qualityLimitationReason: highestLayer.qualityLimitationReason,
				encoderImplementation: highestLayer.encoderImplementation,
				powerEfficientEncoder: highestLayer.powerEfficientEncoder,
			});

			return this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					encodeDegradation,
				},
			});
		}

		// Below the threshold with nothing open: the encoder was judged and found to be keeping up,
		// which is not the same as not having been judged at all.
		if (!this._raised) return this._clear({
			comment: 'encoder keeping up',
			degradedEncodingPerformance: false,
		});

		// Below the threshold with a finding open: the recovery window decides whether it ends.

		const producedFramesForRecovery = recoveryWindow.deltaMediaSourceTotalProducedFrames;
		const encodedFramesForRecovery = recoveryWindow.deltaHighestLayerTotalEncodedFrames;
		const recoveryWindowInMs = recoveryWindow.durationInMs;

		if (
			!recoveryWindow.isReady ||
			producedFramesForRecovery === null ||
			encodedFramesForRecovery === null ||
			recoveryWindowInMs < 1
		) {
			return this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					encodeDegradation,
				},
			});
		}

		const producedFpsForRecovery = producedFramesForRecovery / (recoveryWindowInMs / 1000);
		const encodedFpsForRecovery = encodedFramesForRecovery / (recoveryWindowInMs / 1000);

		// The same denominator the detection half needs, and the same reason for wanting one.
		if (producedFpsForRecovery <= 0) {
			return this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					encodeDegradation,
				},
			});
		}

		const recoveryDegradation = 1 - (encodedFpsForRecovery / producedFpsForRecovery);

		if (this.config.encodeDegradationThreshold < recoveryDegradation) {
			return this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					encodeDegradation,
				},
			});
		}

		this._clear({
			comment: 'encoding recovered',
			payload: {
				producedFpsForRecovery,
				producedFramesForRecovery,
				encodedFpsForRecovery,
				encodedFramesForRecovery,
				recoveryWindowInMs,
			},
			degradedEncodingPerformance: false,
		});
	}

	private _raiseIssue(payload: EncoderBottleneckIssuePayload) {
		if (this._raised) return;

		this._raised = true;
		this.trackMonitor.degradedEncodingPerformance = true;

		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: EncoderBottleneckDetector.ISSUE_TYPE,
			payload,
			timestamp: Date.now(),
		});
	}

	private _clear(options: {
		comment: string,
		payload?: Pick<EncoderBottleneckIssuePayload,
			'producedFpsForRecovery' | 'producedFramesForRecovery' |
			'encodedFpsForRecovery' | 'encodedFramesForRecovery' | 'recoveryWindowInMs'>,
		degradedEncodingPerformance?: false
	}) {
		this.trackMonitor.degradedEncodingPerformance = options.degradedEncodingPerformance;

		// Blanked only on a stand-down, where nothing was measured. A verdict of `false` was
		// measured, and flattening it would leave nothing to read below the threshold.
		if (options.degradedEncodingPerformance !== false) this.trackMonitor.videoEncodingDegradation = undefined;

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
