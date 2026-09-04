import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/**
 * `targetDelayInMs` is what NetEQ is currently aiming for; `actualDelayInMs` is what it really added
 * per emitted sample; `timeStretchRate` is the share of samples (`0..1`) stretched or compressed to
 * keep up. `consecutiveTicks` is how many collections in a row agreed before the issue was raised.
 */
export type JitterBufferStressIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	targetDelayInMs: number;
	actualDelayInMs?: number;
	timeStretchRate: number;
	consecutiveTicks: number;
	durationInMs?: number;
}

export type JitterBufferStressDetectorConfig = {
	/** Target delay above which the jitter buffer counts as stretched thin. */
	targetDelayThresholdInMs: number;

	/** Share of samples inserted or removed above which NetEQ counts as working hard. */
	timeStretchThreshold: number;

	/** Consecutive collections both conditions must hold before raising. */
	minConsecutiveTicks: number;
}

/**
 * Watches the audio jitter buffer of an inbound track and reports when it is fighting the network
 * and losing — the user-visible failure being conversation that has gone latent and slightly warped,
 * voices sped up or dragged out, rather than the fabricated audio `InventedSpeechDetector` covers. The
 * two are complements: invention is what the buffer resorts to once it has already run dry, this is
 * the buffer straining before it gets there.
 *
 * Both conditions are required, because either alone is benign. A high `jitterBufferTargetDelayInMs`
 * on its own means NetEQ is *succeeding*: it has bought latency to hide jitter and the user hears
 * nothing wrong. A raised `timeStretchRate` on its own is ordinary clock-drift correction between
 * two devices whose sample clocks disagree. It is the two together — the buffer already deep and
 * still having to warp audio to keep up — that the user actually hears, so a detector reading either
 * signal alone would spend its time reporting a healthy buffer doing its job. Half the evidence is
 * worse than none, so a tick missing either field is skipped rather than guessed at.
 *
 * The condition must hold for `minConsecutiveTicks` collections before raising, so one noisy stats
 * read cannot open an issue. Nothing is judged while the consumer or the remote sender is paused:
 * both stand the detector down and reset the tick count, since a buffer with no inbound audio to
 * hold has no meaningful target delay.
 *
 * Issue raised: `audio-jitter-buffer-stress`. Monitor event: `audio-jitter-buffer-stress`.
 * Config: `jitterBufferStressDetector`.
 *
 * Category: Perceived Quality
 * Layer: Responsiveness
 *
 */
export class JitterBufferStressDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-jitter-buffer-stress';
	public readonly name = 'jitter-buffer-stress-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;
	private _consecutiveTicks = 0;
	private _alertOn = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${JitterBufferStressDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.jitterBufferStressDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'audio') return;
		if (this.trackMonitor.paused) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('consumer paused') : undefined;
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('remote track paused') : undefined;
		}

		const targetDelayInMs = inboundRtp.jitterBufferTargetDelayInMs;
		const timeStretchRate = inboundRtp.timeStretchRate;

		if (targetDelayInMs === undefined || timeStretchRate === undefined) return;

		const stressed = this.config.targetDelayThresholdInMs < targetDelayInMs &&
			this.config.timeStretchThreshold < timeStretchRate;

		if (!stressed) {
			this._consecutiveTicks = 0;

			if (this._alertOn) {
				this._clear('jitter buffer recovered');
			}

			return;
		}

		this._consecutiveTicks += 1;

		if (this._alertOn) return;
		if (this._consecutiveTicks < this.config.minConsecutiveTicks) return;

		this._alertOn = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('audio-jitter-buffer-stress', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			targetDelayInMs,
			timeStretchRate,
		});

		clientMonitor.raiseIssue<JitterBufferStressIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: JitterBufferStressDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				targetDelayInMs,
				actualDelayInMs: inboundRtp.avgJitterBufferDelayInMs,
				timeStretchRate,
				consecutiveTicks: this._consecutiveTicks,
			},
		});
	}

	private _clear(comment: string) {
		this._alertOn = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: JitterBufferStressIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as JitterBufferStressIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<JitterBufferStressIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
