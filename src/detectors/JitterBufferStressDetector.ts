import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type JitterBufferStressIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** What NetEQ is aiming for. */
	targetDelayInMs: number;
	/** What it really added per emitted sample. */
	actualDelayInMs?: number;
	/** Share of samples (`0..1`) stretched or compressed to keep up. */
	timeStretchRate: number;
	/** Collections in a row that agreed before raising. */
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

	/**
	 * The target delay at which the buffer counts as unbearable — the top of the severity scale,
	 * not a trigger. Only affects the published severity, never whether the issue is raised.
	 */
	unbearableTargetDelayInMs: number;

	/**
	 * The share of samples stretched or compressed that counts as unbearable — the top of the
	 * severity scale, not a trigger. Only affects the published severity, never the raise.
	 */
	unbearableTimeStretchRate: number;
}

/**
 * Reports an inbound track's audio jitter buffer fighting the network and losing — conversation gone
 * latent and slightly warped, voices sped up or dragged out. Use it to tell straining apart from a
 * buffer that has already run dry and is fabricating audio, which `InventedSpeechDetector` covers.
 *
 * A finding means the path is delivering unevenly enough that the buffer has to grow and warp
 * audio to cover it — congestion, a wireless link, or a route with variable queuing. The listener
 * hears added delay and slightly distorted voices before they hear anything break.
 *
 * Both a deep `jitterBufferTargetDelayInMs` and a raised `timeStretchRate` are required, for
 * `minConsecutiveTicks` collections: deep alone means NetEQ is succeeding, and stretching alone is
 * ordinary clock-drift correction. A tick missing either field is skipped rather than guessed at,
 * and a paused consumer or remote sender stands the detector down and resets the tick count.
 *
 * Beside the finding it publishes `InboundTrackMonitor.jitterBufferStressSeverity`, the geometric
 * mean of the same two witnesses measured against the levels that count as unbearable. It is an
 * absolute scale rather than a threshold-relative one: `0` is a buffer doing nothing and `1` is one
 * nobody could converse through, so the raise point sits well down the range — around `0.16` with
 * the shipped defaults — and most of the scale is left to say how much worse things got. Written on
 * every collection the detector could judge, below the threshold as well as above it, so a score
 * can fall off gradually instead of only when a finding opens. It never decides the raise.
 *
 * Issue raised: `audio-jitter-buffer-stress`. Monitor event: `audio-jitter-buffer-stress`.
 * Config: `jitterBufferStressDetector`.
 * Track attribute: `InboundTrackMonitor.jitterBufferStressSeverity`.
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
			this.trackMonitor.jitterBufferStressSeverity = undefined;

			return this._alertOn ? this._clear('consumer paused') : undefined;
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this._consecutiveTicks = 0;
			this.trackMonitor.jitterBufferStressSeverity = undefined;

			return this._alertOn ? this._clear('remote track paused') : undefined;
		}

		const targetDelayInMs = inboundRtp.jitterBufferTargetDelayInMs;
		const timeStretchRate = inboundRtp.timeStretchRate;

		// A collection missing either witness is not judged at all, so the severity says nothing
		// rather than reporting the half it happens to have.
		if (targetDelayInMs === undefined || timeStretchRate === undefined) {
			this.trackMonitor.jitterBufferStressSeverity = undefined;

			return;
		}

		this.trackMonitor.jitterBufferStressSeverity = this._severity(targetDelayInMs, timeStretchRate);

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

		this.trackMonitor.issues.raise({
				key: this.issueKey,
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

	/**
	 * How bad the buffer's behaviour is on an absolute scale, `0..1`, from the two witnesses the
	 * raise tests.
	 *
	 * Each witness is its value against the level that counts as unbearable, so `0` is a buffer
	 * doing nothing at all and `1` is one nobody could hold a conversation through. The scale is
	 * anchored on that, not on the thresholds, which is what puts the raise point well down the
	 * range rather than at zero: with the shipped defaults the issue opens around `0.16`, leaving
	 * most of the scale to describe how much worse it got afterwards.
	 *
	 * The two are combined with a geometric mean, so a witness at zero takes the whole thing to
	 * zero — the same "deep alone means NetEQ is succeeding, stretching alone is clock drift" that
	 * decides the finding. Undefined when an unbearable level is not positive, which leaves nothing
	 * to scale against.
	 */
	private _severity(targetDelayInMs: number, timeStretchRate: number): number | undefined {
		const witness = (value: number, unbearable: number) =>
			0 < unbearable ? Math.min(1, Math.max(0, value / unbearable)) : undefined;

		const delay = witness(targetDelayInMs, this.config.unbearableTargetDelayInMs);
		const stretch = witness(timeStretchRate, this.config.unbearableTimeStretchRate);

		if (delay === undefined || stretch === undefined) return undefined;

		return Math.sqrt(delay * stretch);
	}

	private _clear(comment: string) {
		this._alertOn = false;

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: JitterBufferStressIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as JitterBufferStressIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
