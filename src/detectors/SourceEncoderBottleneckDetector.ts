import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";

export type CaptureBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Frames per second the capture source actually produced. */
	sourceFps?: number;
	/** What the track was configured to capture at, when the browser reports it. */
	expectedFps?: number;
	sourceWidth?: number;
	sourceHeight?: number;
	consecutiveTicks: number;
	durationInMs?: number;
}

export type EncoderBottleneckIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	sourceFps?: number;
	/** Frames per second the encoder managed on the highest active layer. */
	encodedFps?: number;
	encodeTimePerFrameInMs?: number;
	qualityLimitationReason?: string;
	/** Share of the interval the encoder spent CPU-limited, in `0..1`. */
	cpuLimitationShare?: number;
	encoderImplementation?: string;
	powerEfficientEncoder?: boolean;
	consecutiveTicks: number;
	durationInMs?: number;
}

/**
 * Source / Encoder Bottleneck Detector
 *
 * Splits one symptom — "we are sending fewer frames than we should" — into its
 * two distinct causes, which from RTP alone are indistinguishable:
 *
 * - **`capture-bottleneck`**: the *source* never produced the frames. A camera
 *   throttling in low light, an OS-level capture stall, a screen share of static
 *   content, a device the browser is quietly downgrading. Nothing the encoder or
 *   the network can do about it.
 * - **`encoder-bottleneck`**: the source produced frames and the encoder could
 *   not keep up with them. A CPU-bound software encoder is the usual answer.
 *
 * The discriminator is `MediaSourceMonitor.sourceFps` versus the frame rate the
 * highest active layer actually encoded. This is cheap because
 * `MediaSourceMonitor` already exists — the work here is pairing, not plumbing.
 *
 * **Issues created:**
 * - Type: `capture-bottleneck`
 * - Type: `encoder-bottleneck`
 */
export class SourceEncoderBottleneckDetector implements Detector {
	public static readonly CAPTURE_ISSUE_TYPE = 'capture-bottleneck';
	public static readonly ENCODER_ISSUE_TYPE = 'encoder-bottleneck';

	public readonly name = 'source-encoder-bottleneck-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;

	private readonly _captureIssueKey: string;
	private readonly _encoderIssueKey: string;

	private _captureTicks = 0;
	private _captureOn = false;
	private _captureStartedAt?: number;

	private _encoderTicks = 0;
	private _encoderOn = false;
	private _encoderStartedAt?: number;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._captureIssueKey = `${SourceEncoderBottleneckDetector.CAPTURE_ISSUE_TYPE}-track-${trackMonitor.track.id}`;
		this._encoderIssueKey = `${SourceEncoderBottleneckDetector.ENCODER_ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.sourceEncoderBottleneckDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const mediaSource = this.trackMonitor.getMediaSource();
		const highestLayer = this.trackMonitor.getHighestLayer();

		if (!mediaSource || !highestLayer) return;
		// a deliberately stopped or muted sender is not a bottleneck
		if (this.trackMonitor.track.readyState !== 'live') return;
		if (this.trackMonitor.track.muted || !this.trackMonitor.track.enabled) return;
		if (highestLayer.active === false) return;

		const sourceFps = mediaSource.sourceFps ?? mediaSource.framesPerSecond;
		const expectedFps = this._expectedFps();

		this._checkCapture(sourceFps, expectedFps, mediaSource.width, mediaSource.height);
		this._checkEncoder(sourceFps, highestLayer);
	}

	/** What the track was asked to capture at, per `getSettings()`. */
	private _expectedFps(): number | undefined {
		try {
			return this.trackMonitor.track.getSettings?.().frameRate ?? undefined;
		} catch {
			return undefined;
		}
	}

	private _checkCapture(sourceFps?: number, expectedFps?: number, width?: number, height?: number) {
		if (sourceFps === undefined) return;

		const floor = expectedFps !== undefined
			? expectedFps * this.config.captureFpsRatioThreshold
			: this.config.minSourceFps;

		const starving = sourceFps < floor;

		if (!starving) {
			this._captureTicks = 0;

			if (this._captureOn) {
				this._captureOn = false;
				this._resolve(this._captureIssueKey, 'capture recovered', this._captureStartedAt);
				this._captureStartedAt = undefined;
			}

			return;
		}

		this._captureTicks += 1;

		if (this._captureOn) return;
		if (this._captureTicks < this.config.minConsecutiveTicks) return;

		this._captureOn = true;
		this._captureStartedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('capture-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			sourceFps,
			expectedFps,
		});

		clientMonitor.raiseIssue<CaptureBottleneckIssuePayload>(this._captureIssueKey, {
			type: SourceEncoderBottleneckDetector.CAPTURE_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				sourceFps,
				expectedFps,
				sourceWidth: width,
				sourceHeight: height,
				consecutiveTicks: this._captureTicks,
			},
		});
	}

	private _checkEncoder(sourceFps: number | undefined, highestLayer: ReturnType<OutboundTrackMonitor['getHighestLayer']>) {
		if (!highestLayer) return;

		const encodedFps = highestLayer.framesPerSecond;
		const shares = highestLayer.qualityLimitationDurationShares;
		const cpuLimitationShare = shares?.cpu;

		// a starving source is a capture problem, not the encoder's fault
		const sourceHealthy = sourceFps !== undefined && this.config.minSourceFps <= sourceFps;

		if (!sourceHealthy) {
			this._encoderTicks = 0;

			if (this._encoderOn) {
				this._encoderOn = false;
				this._resolve(this._encoderIssueKey, 'source no longer healthy; not an encoder problem', this._encoderStartedAt);
				this._encoderStartedAt = undefined;
			}

			return;
		}

		const encoderBehind = encodedFps !== undefined &&
			encodedFps < (sourceFps as number) * this.config.encodeFpsRatioThreshold;

		const encodeTooSlow = highestLayer.encodeTimePerFrameInMs !== undefined &&
			sourceFps !== undefined && 0 < sourceFps &&
			(1000 / sourceFps) * this.config.encodeTimeBudgetRatio < highestLayer.encodeTimePerFrameInMs;

		const cpuLimited = cpuLimitationShare !== undefined &&
			this.config.cpuLimitationShareThreshold < cpuLimitationShare;

		if (!encoderBehind && !encodeTooSlow && !cpuLimited) {
			this._encoderTicks = 0;

			if (this._encoderOn) {
				this._encoderOn = false;
				this._resolve(this._encoderIssueKey, 'encoder keeping up again', this._encoderStartedAt);
				this._encoderStartedAt = undefined;
			}

			return;
		}

		this._encoderTicks += 1;

		if (this._encoderOn) return;
		if (this._encoderTicks < this.config.minConsecutiveTicks) return;

		this._encoderOn = true;
		this._encoderStartedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('encoder-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			sourceFps,
			encodedFps,
		});

		clientMonitor.raiseIssue<EncoderBottleneckIssuePayload>(this._encoderIssueKey, {
			type: SourceEncoderBottleneckDetector.ENCODER_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				sourceFps,
				encodedFps,
				encodeTimePerFrameInMs: highestLayer.encodeTimePerFrameInMs,
				qualityLimitationReason: highestLayer.qualityLimitationReason,
				cpuLimitationShare,
				encoderImplementation: highestLayer.encoderImplementation,
				powerEfficientEncoder: highestLayer.powerEfficientEncoder,
				consecutiveTicks: this._encoderTicks,
			},
		});
	}

	private _resolve(issueKey: string, comment: string, startedAt?: number) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(issueKey);
		let payload: Record<string, unknown> | undefined;

		if (issue) {
			payload = {
				...(issue.payload as Record<string, unknown>),
				durationInMs: startedAt ? Date.now() - startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue(issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});
	}
}
