import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/** One ongoing episode of audible invention on a single inbound audio track. */
export type InventedSpeechIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Share of the interval's audio that was invented, at the moment the issue was raised. */
	inventedSpeechRatio: number;
	/** Invented milliseconds beyond the allowance that had accumulated when it was raised. */
	excessInventedMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type InventedSpeechDetectorConfig = {
	/**
	 * Share of audio (`0..1`) that may be invented without counting against the
	 * stream. NetEQ always fabricates a little and a little is inaudible; this is
	 * the line above which fabrication starts accumulating, and below which it
	 * drains away again. RFC 7294 puts severe concealment at 5% of a second,
	 * which is where the default comes from.
	 */
	allowedInventedRatio: number;

	/**
	 * Invented milliseconds *beyond* the allowance that must accumulate before the
	 * issue is raised. Because the allowance is also the drain rate, this doubles
	 * as the resolve bar: a full accumulator empties after
	 * `raiseAfterInventedMs / allowedInventedRatio` milliseconds of clean audio.
	 * At the defaults that is 0.4s of excess invention to open and 8s of clean
	 * audio to close.
	 */
	raiseAfterInventedMs: number;
}

/**
 * Reports a listener being fed audio the sender never sent — sustained enough to be the thing
 * behind a "they were breaking up" complaint.
 *
 * When packets are missing or late, NetEQ does not fall silent; it fabricates audio from what came
 * before so playout never stops. That is usually the right trade and usually inaudible, which is why
 * packet loss is a poor proxy for how a call sounded: Opus and NetEQ hide a great deal of loss
 * perfectly, and audio falls apart without dramatic loss when the jitter buffer misbehaves. What the
 * listener actually hears is the fabrication, so that is what this measures.
 *
 * The measurement is `inboundRtp.inventedSpeechRatio`, computed on the monitor: concealed samples
 * with the silent ones subtracted, over the samples that arrived. Concealment during talker silence
 * produces silence or comfort noise that nobody can distinguish from the real thing, so counting it
 * would make every quiet moment of every call read as a fault.
 *
 * **The accumulator.** Each tick contributes `ratio × deltaTime` milliseconds of invention and is
 * credited `allowedInventedRatio × deltaTime` of tolerance; the difference moves one accumulator,
 * clamped between zero and `raiseAfterInventedMs`. Above the allowance it fills, below it drains.
 * The issue opens when the accumulator is full and closes when it is empty.
 *
 * Two properties follow from that shape, and both are the point of it:
 *
 * *It does not care how often you poll.* An earlier design classified each tick as bad or good
 * against a threshold and then added the whole tick duration, which meant a bad second inside a
 * five-second collection got averaged down by five and the detector's sensitivity depended on
 * `collectingPeriodInMs`. Integrating a rate over elapsed time has no such artefact — the same audio
 * produces the same accumulator trajectory at any collection period.
 *
 * *Brief pauses do not end an episode.* A clean tick drains only the allowance, so at the defaults a
 * two-second gap costs a quarter of a full accumulator. Someone who breaks up, pauses for breath and
 * breaks up again keeps accumulating, while genuinely recovered audio still closes the issue after
 * about eight seconds. A long silence does drain it to empty and resolve — which is right, since
 * there is no ongoing problem to report while nobody is speaking, and it reopens within seconds if
 * they resume badly.
 *
 * What it cannot do is distinguish one second at 25% from five seconds at 5%; both are 200ms of
 * excess. That is the price of poll-independence and the right trade for an issue with raise and
 * resolve semantics. Note also that resolving takes `raiseAfterInventedMs / allowedInventedRatio` of
 * stats time — 8s at the defaults — so a collection period longer than that would let a single clean
 * tick drain a full accumulator.
 *
 * This is not RFC 7294's per-second classifier and does not claim to be. It keeps the RFC's 5%
 * meaning the same thing — the share of audio that was invented — but applies it as a sustained rate
 * rather than a per-second verdict, because a cumulative counter sampled every few seconds cannot
 * see inside a tick.
 *
 * Issue raised: `invented-speech`. Monitor event: `invented-speech`.
 * Config: `inventedSpeechDetector`.
 *
 * Category: Perceived Quality
 * Layer: Audio — continuity
 *
 */
export class InventedSpeechDetector implements Detector {
	public static readonly ISSUE_TYPE = 'invented-speech';
	public readonly name = 'invented-speech-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	/** Invented milliseconds accumulated beyond the allowance; the whole of this detector's state. */
	private _bucketInMs = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${InventedSpeechDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.inventedSpeechDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'audio') return;

		// Nothing is being sent, so there is nothing to invent. The accumulator is
		// discarded rather than drained, so a pause cannot leak into the next episode.
		if (this.trackMonitor.paused) {
			this._bucketInMs = 0;

			return this._raised ? this._clear('consumer paused') : undefined;
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this._bucketInMs = 0;

			return this._raised ? this._clear('remote track paused') : undefined;
		}

		const ratio = inboundRtp.inventedSpeechRatio;

		if (ratio === undefined) {
			// The browser reported no concealment counters, or no samples arrived.
			// Either way nothing was observed about how this sounded, which is not
			// the same as it having sounded fine.
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		// How much of this interval was invented, against how much invention is
		// tolerated over the same span. One expression covers both directions: above
		// the allowance it fills, below it drains.
		const elapsedInMs = inboundRtp.deltaTime ?? 0;
		const inventedInMs = ratio * elapsedInMs;
		const allowedInMs = this.config.allowedInventedRatio * elapsedInMs;

		this._bucketInMs = Math.min(
			this.config.raiseAfterInventedMs,
			Math.max(0, this._bucketInMs + inventedInMs - allowedInMs),
		);

		if (this._raised) {
			if (this._bucketInMs <= 0) this._clear('audio recovered');

			return;
		}

		if (this._bucketInMs < this.config.raiseAfterInventedMs) return;

		this._raised = true;
		// wall clock, deliberately: only ever read to report how long the issue stood
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('invented-speech', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			inventedSpeechRatio: ratio,
		});

		clientMonitor.raiseIssue<InventedSpeechIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: InventedSpeechDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				inventedSpeechRatio: ratio,
				excessInventedMs: this._bucketInMs,
			},
		});
	}

	private _clear(comment: string) {
		this._raised = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: InventedSpeechIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as InventedSpeechIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<InventedSpeechIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
