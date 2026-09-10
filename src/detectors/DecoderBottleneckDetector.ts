import { Detector } from "./Detector";
import type { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/**
 * What the detector measured about the decoder in the window that raised the issue.
 *
 * Every field not marked optional is always present: the detector cannot reach the raise without
 * it. The track's own `readyState` and `muted` are not carried, because the detector only raises
 * on a track that is live, unmuted and enabled, so they could only ever read `'live'` and `false`.
 */
export type DecoderBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;

	/** The average frames per second that arrived over the detection window. */
	receivedFpsForDetection: number;

	/** The number of frames that arrived over the detection window. */
	receivedFramesForDetection: number;

	/** The average frames per second the decoder produced over the detection window. */
	decodedFpsForDetection: number;

	/** The number of frames the decoder produced over the detection window. */
	decodedFramesForDetection: number;

	/** The milliseconds of stats time the detection window spanned. */
	detectionWindowInMs: number;

	/**
	 * The share of the frames that arrived which the decoder did not get through,
	 * `1 - decodedFpsForDetection / receivedFpsForDetection`. Zero is a decoder keeping up with the
	 * wire and one is a decoder emitting nothing; a decoder ahead of the wire, which counters read a
	 * frame apart can produce, reports a negative.
	 */
	decodeDegradation: number;

	/** The decoded frame size when the issue opened. */
	frameWidth?: number;
	frameHeight?: number;

	// Written at resolution, from the recovery window that ended the issue. Absent when it was
	// resolved by a stand-down instead, where nothing was measured.

	/** The milliseconds of stats time the recovery window spanned. */
	recoveryWindowInMs?: number;

	/** The average frames per second that arrived during the recovery window. */
	receivedFpsForRecovery?: number;

	/** The number of frames that arrived during the recovery window. */
	receivedFramesForRecovery?: number;

	/** The average frames per second the decoder produced during the recovery window. */
	decodedFpsForRecovery?: number;

	/** The number of frames the decoder produced during the recovery window. */
	decodedFramesForRecovery?: number;
}

export type DecoderBottleneckDetectorConfig = {
	/**
	 * The share of the arriving frames the decoder may fail to get through before the issue is
	 * raised, and must return to before it resolves.
	 */
	decodeDegradationThreshold: number;

	/** Not a substituted baseline — it only refuses a ratio taken over a handful of frames. */
	minReceivedFps: number;
}

/**
 * Given a wire that is delivering, is the decoder keeping up with it? The receive-side mirror of
 * `EncoderBottleneckDetector`, and it reads the same way: two counters on the same stretch, frames
 * that arrived against frames the decoder produced. The difference is frames the decoder was handed
 * and never got through, and the viewer sees a stuttering tile.
 *
 * Both counters come from `InboundTrackMonitor.slicedWindow`. The detection window
 * raises — leaving more than `decodeDegradationThreshold` of the arriving frames undecoded opens
 * the issue, and every later collection still short of it updates that issue rather than opening
 * another. The recovery window resolves: the issue ends only once the stretch *before* the
 * detection window is back within the threshold, so a decoder hovering at the line cannot flap one
 * long fault into a stream of short ones. Neither window is read before it says it is ready.
 *
 * The bar is the measured arrival rate, never the sender's intent, so a stream throttled to 5fps
 * that decodes cleanly is silent. A stream thinner than `minReceivedFps` is refused rather than
 * judged, because a ratio taken over a handful of frames says nothing.
 *
 * A finding means the network did its job and this machine did not keep up: too many streams open
 * for it, a software codec on hardware too slow for the resolution, or the CPU taken by something
 * else. The fix is local — fewer or smaller streams — never a network one.
 *
 * This is the only detector that reports frames lost after arrival. `DecoderPerformanceDetector`
 * measures what decoding *cost* — time per frame against the frame budget — and says nothing about
 * how many frames came out, so the two describe one decoder from two sides without double-reporting
 * it. Cost is the earlier warning; loss is what the viewer sees.
 *
 * It stands down — reporting `undefined` rather than a verdict — for a backgrounded tab, a paused
 * consumer or sender, a track that is not playing, and a stream too thin to judge.
 *
 * Issue raised: `decoder-bottleneck`, updated while it stays open, resolved on recovery or on a
 * stand-down. Monitor event: `decoder-bottleneck`, emitted once at the raise.
 * Config: `decoderBottleneckDetector`.
 * Track attribute: `InboundTrackMonitor.degradedFrameSupply`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — frames to decoder
 *
 */
export class DecoderBottleneckDetector implements Detector {
	public static readonly ISSUE_TYPE = 'decoder-bottleneck';

	public readonly name = 'decoder-bottleneck-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private _raised = false;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this._issueKey = `${DecoderBottleneckDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;

		// Read without the getter's non-null assertion: a monitor builds this detector whenever the
		// key is not explicitly `null`, which includes a config that never mentioned it at all.
		const config = this.peerConnection.parent.config.decoderBottleneckDetector;

		if (config && config.decodeDegradationThreshold < 0) {
			this.peerConnection.parent.logger.warn(
				'decoderBottleneckDetector.decodeDegradationThreshold must not be below 0, got '
				+ config.decodeDegradationThreshold
			);
			config.decodeDegradationThreshold = 0;
		}
	}

	private get config(): DecoderBottleneckDetectorConfig {
		return this.peerConnection.parent.config.decoderBottleneckDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.degradedFrameSupply = undefined;

			return;
		}
		if (this.trackMonitor.kind !== 'video') return;

		const track = this.trackMonitor.track;

		if (!this.peerConnection.parent.activeTab) return this._clear({
			comment: 'tab in background',
		});
		if (this.trackMonitor.paused) return this._clear({
			comment: 'consumer paused',
		});
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._clear({
			comment: 'remote sender paused',
		});
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._clear({
			comment: 'track not playing',
		});

		const {
			detection: detectionWindow,
			recovery: recoveryWindow,
		} = this.trackMonitor.slicedWindow.slices;
		const receivedFramesForDetection = detectionWindow.deltaTotalFramesReceived;
		const decodedFramesForDetection = detectionWindow.deltaTotalFramesDecoded;
		const detectionWindowInMs = detectionWindow.durationInMs;

		if (receivedFramesForDetection === null) return this._clear({
			comment: 'no arriving frame count',
		});
		if (decodedFramesForDetection === null) return this._clear({
			comment: 'no decoded frame count',
		});
		if (!detectionWindow.isReady || detectionWindowInMs < 1) return;

		const receivedFpsForDetection = receivedFramesForDetection / (detectionWindowInMs / 1000);
		const decodedFpsForDetection = decodedFramesForDetection / (detectionWindowInMs / 1000);

		// A ratio over a handful of frames is noise, and a stream this thin is not the decoder's
		// doing. Too thin to judge is not the same as healthy, so the verdict goes blind.
		if (receivedFpsForDetection < this.config.minReceivedFps) return this._clear({
			comment: 'stream too thin to judge',
		});

		const decodeDegradation = 1 - (decodedFpsForDetection / receivedFpsForDetection);

		// Beside the flag and the issue: the measurement itself, on every judged collection, so the
		// score calculator has a continuous number below the threshold as well as above it.
		this.trackMonitor.decodingDegradation = decodeDegradation;
		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (this.config.decodeDegradationThreshold < decodeDegradation) {
			if (!this._raised) return this._raiseIssue({
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				decodeDegradation,
				receivedFpsForDetection,
				receivedFramesForDetection,
				decodedFpsForDetection,
				decodedFramesForDetection,
				detectionWindowInMs,
				frameWidth: inboundRtp?.frameWidth,
				frameHeight: inboundRtp?.frameHeight,
			}, receivedFpsForDetection, decodedFpsForDetection);

			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					decodeDegradation,
				},
			});
		}

		// Below the threshold with nothing open: the decoder was judged and found to be keeping up,
		// which is not the same as not having been judged at all.
		if (!this._raised) return this._clear({
			comment: 'decoder keeping up',
			degradedFrameSupply: false,
		});

		// Below the threshold with a finding open: the recovery window decides whether it ends.

		const receivedFramesForRecovery = recoveryWindow.deltaTotalFramesReceived;
		const decodedFramesForRecovery = recoveryWindow.deltaTotalFramesDecoded;
		const recoveryWindowInMs = recoveryWindow.durationInMs;

		if (
			!recoveryWindow.isReady ||
			receivedFramesForRecovery === null ||
			decodedFramesForRecovery === null ||
			recoveryWindowInMs < 1
		) {
			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					decodeDegradation,
				},
			});
		}

		const receivedFpsForRecovery = receivedFramesForRecovery / (recoveryWindowInMs / 1000);
		const decodedFpsForRecovery = decodedFramesForRecovery / (recoveryWindowInMs / 1000);

		// The same floor the detection half needs, and the same reason for wanting one: a thin
		// stretch cannot demonstrate a recovery any more than it can demonstrate a fault.
		if (receivedFpsForRecovery < this.config.minReceivedFps) {
			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					decodeDegradation,
				},
			});
		}

		const recoveryDegradation = 1 - (decodedFpsForRecovery / receivedFpsForRecovery);

		if (this.config.decodeDegradationThreshold < recoveryDegradation) {
			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					decodeDegradation,
				},
			});
		}

		this._clear({
			comment: 'decoding recovered',
			payload: {
				receivedFpsForRecovery,
				receivedFramesForRecovery,
				decodedFpsForRecovery,
				decodedFramesForRecovery,
				recoveryWindowInMs,
			},
			degradedFrameSupply: false,
		});
	}

	private _raiseIssue(payload: DecoderBottleneckIssuePayload, receivedFps: number, decodedFps: number) {
		if (this._raised) return;

		this._raised = true;
		this.trackMonitor.degradedFrameSupply = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('decoder-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			decodedFps,
			receivedFps,
		});

		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: DecoderBottleneckDetector.ISSUE_TYPE,
			payload,
			timestamp: Date.now(),
		});
	}

	private _clear(options: {
		comment: string,
		payload?: Pick<DecoderBottleneckIssuePayload,
			'receivedFpsForRecovery' | 'receivedFramesForRecovery' |
			'decodedFpsForRecovery' | 'decodedFramesForRecovery' | 'recoveryWindowInMs'>,
		degradedFrameSupply?: false
	}) {
		this.trackMonitor.degradedFrameSupply = options.degradedFrameSupply;

		// Blanked only on a stand-down, where nothing was measured. A verdict of `false` was
		// measured, and flattening it would leave nothing to read below the threshold.
		if (options.degradedFrameSupply !== false) this.trackMonitor.decodingDegradation = undefined;

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
