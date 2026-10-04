import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/** One ongoing episode of dense non-silent concealment on a single inbound audio track. */
export type ConcealedSamplesIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/**
	 * Share of the interval's received audio that was non-silent concealment
	 * (`concealedSamples − silentConcealedSamples`), at the moment the issue was raised or last updated.
	 */
	nonSilentConcealedRatio: number;
	/** Non-silent concealed milliseconds beyond the allowance that had accumulated. */
	excessConcealedMs: number;
	/**
	 * Concealment events per second in the same interval. With {@link nonSilentConcealedRatio} it
	 * separates a few longer gaps from constant micro-concealment, which sound different and
	 * usually have different causes. Absent when the browser does not report `concealmentEvents`.
	 */
	concealmentEventRate?: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type ConcealedSamplesDetectorConfig = {
	/** Share of audio (`0..1`) that may be non-silent concealment for free. Also the drain rate. */
	allowedConcealedRatio: number;

	/**
	 * Non-silent concealed milliseconds beyond the allowance needed to raise. Doubles as the resolve
	 * bar: a full accumulator empties after `raiseAfterConcealedMs / allowedConcealedRatio` ms of
	 * clean audio.
	 */
	raiseAfterConcealedMs: number;
}

/**
 * Reports a listener hearing a dense run of **short concealment gaps** on one inbound audio stream —
 * choppy, warbling or robotic speech from bursts of loss or late packets that NetEQ had to paper
 * over. It measures `inboundRtp.nonSilentConcealedRatio`: the `concealedSamples` that were not
 * `silentConcealedSamples`, over `totalSamplesReceived`.
 *
 * **What it cannot see: long dropouts.** NetEQ fades its concealment out over roughly 60–120 ms of
 * consecutive expansion (the mute slope steepens on the 3rd and 7th consecutive expand). Once the
 * fade reaches zero, every further concealed sample is counted as `silentConcealedSamples`, exactly
 * like comfort noise during DTX. So each concealment event adds at most about that much to this
 * ratio, however long the gap lasts: a two-second dropout contributes ~100 ms here and nothing
 * more. Dropouts of 150 ms and longer are `AudioInterruptionDetector`'s finding; the two are
 * complements, not alternatives.
 *
 * Subtracting the silent samples is still necessary: without it every DTX silence would read as
 * concealment.
 *
 * Each tick contributes `ratio × deltaTime` against `allowedConcealedRatio × deltaTime` of
 * tolerance, moving one accumulator clamped to `raiseAfterConcealedMs`. The issue opens when it is
 * full and closes when it is empty. Integrating a rate makes the verdict independent of the
 * collection period, and a clean tick drains only the allowance, so a breath between two bad
 * stretches does not end the episode. Because each event is capped by the fade, reaching the raise
 * point at the defaults takes several concealment events per second sustained over seconds — which
 * is what bursty Wi-Fi loss beyond Opus in-band FEC looks like.
 *
 * It is per stream, so one talker firing points at their uplink and every talker firing points at
 * this listener's downlink. It cannot tell one second at 25% from five at 5%, and it is not
 * RFC 7294's per-second classifier.
 *
 * Issue raised: `concealed-samples`. Monitor event: `concealed-samples`.
 * Config: `concealedSamplesDetector`.
 *
 * Category: Perceived Quality
 * Layer: Audio — continuity
 *
 */
export class ConcealedSamplesDetector implements Detector {
	public static readonly ISSUE_TYPE = 'concealed-samples';
	public readonly name = 'concealed-samples-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	/** Non-silent concealed milliseconds accumulated beyond the allowance; the whole of this detector's state. */
	private _bucketInMs = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${ConcealedSamplesDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.concealedSamplesDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'audio') return;

		if (this.trackMonitor.readyState !== 'live') return this._standDown('track ended');
		if (this.trackMonitor.paused) return this._standDown('consumer paused');
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._standDown('remote track paused');

		const ratio = inboundRtp.nonSilentConcealedRatio;

		if (ratio === undefined) {
			// No concealment counters, or no samples arrived. Blind, not fine.
			this.inputsUnavailable = true;
			this.trackMonitor.concealedSamplesSeverity = undefined;

			return;
		}

		this.inputsUnavailable = false;

		// One expression covers both directions: above the allowance it fills, below it drains.
		const elapsedInMs = inboundRtp.deltaTime ?? 0;
		const concealedInMs = ratio * elapsedInMs;
		const allowedInMs = this.config.allowedConcealedRatio * elapsedInMs;

		this._bucketInMs = Math.min(
			this.config.raiseAfterConcealedMs,
			Math.max(0, this._bucketInMs + concealedInMs - allowedInMs),
		);

		// Beside the verdict, the measurement it was a verdict on: how full the bucket is, where
		// `1` is the raise point. Published on every collection that was judged, so the score can
		// see audio heading towards a fault and not only the moment it becomes one.
		this.trackMonitor.concealedSamplesSeverity = 0 < this.config.raiseAfterConcealedMs
			? this._bucketInMs / this.config.raiseAfterConcealedMs
			: undefined;

		const concealmentEventRate = inboundRtp.concealmentEventRate;

		if (this._raised) {
			if (this._bucketInMs <= 0) return this._clear('audio recovered');

			return this.trackMonitor.issues.update({
				key: this.issueKey,
				payload: {
					excessConcealedMs: this._bucketInMs,
					nonSilentConcealedRatio: ratio,
					concealmentEventRate,
				},
			});
		}

		if (this._bucketInMs < this.config.raiseAfterConcealedMs) return;

		this._raised = true;
		// Wall clock, and only for the resolved issue's `durationInMs`.
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('concealed-samples', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			nonSilentConcealedRatio: ratio,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: ConcealedSamplesDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				nonSilentConcealedRatio: ratio,
				excessConcealedMs: this._bucketInMs,
				concealmentEventRate,
			},
		});
	}

	/** Nothing is being judged: the accumulator is thrown away rather than drained. */
	private _standDown(comment: string) {
		this._bucketInMs = 0;
		this.trackMonitor.concealedSamplesSeverity = undefined;

		if (this._raised) this._clear(comment);
	}

	private _clear(comment: string) {
		this._raised = false;

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: ConcealedSamplesIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as ConcealedSamplesIssuePayload),
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
