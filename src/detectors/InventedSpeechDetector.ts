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
	/** Share of audio (`0..1`) that may be invented for free. Also the drain rate. */
	allowedInventedRatio: number;

	/**
	 * Invented milliseconds beyond the allowance needed to raise. Doubles as the resolve bar: a full
	 * accumulator empties after `raiseAfterInventedMs / allowedInventedRatio` ms of clean audio.
	 */
	raiseAfterInventedMs: number;
}

/**
 * Reports a listener being fed audio the sender never sent. Use it to answer how a call actually
 * sounded, which packet loss cannot: NetEQ hides a great deal of loss inaudibly, and audio falls
 * apart without dramatic loss when the jitter buffer misbehaves. What a listener hears is the
 * fabrication, so that is what is measured — `inboundRtp.inventedSpeechRatio`, which excludes
 * concealment during talker silence because nobody can hear the difference there.
 *
 * Each tick contributes `ratio × deltaTime` of invention against `allowedInventedRatio × deltaTime`
 * of tolerance, moving one accumulator clamped to `raiseAfterInventedMs`. The issue opens when it
 * is full and closes when it is empty. Integrating a rate makes the verdict independent of the
 * collection period, and a clean tick drains only the allowance, so a breath between two bad
 * stretches does not end the episode.
 *
 * A finding means this listener heard fabricated audio for a sustained stretch: loss or jitter on
 * the path from that talker, or a jitter buffer that could not keep up with it. It is per stream, so
 * one talker firing points at their uplink and every talker firing points at this listener's
 * downlink.
 *
 * It cannot tell one second at 25% from five at 5%, and it is not RFC 7294's per-second classifier:
 * the same 5% applied as a sustained rate rather than a verdict on each second.
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

		// Discarded rather than drained, so a pause cannot leak into the next episode.
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
			// No concealment counters, or no samples arrived. Blind, not fine.
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		// One expression covers both directions: above the allowance it fills, below it drains.
		const elapsedInMs = inboundRtp.deltaTime ?? 0;
		const inventedInMs = ratio * elapsedInMs;
		const allowedInMs = this.config.allowedInventedRatio * elapsedInMs;

		this._bucketInMs = Math.min(
			this.config.raiseAfterInventedMs,
			Math.max(0, this._bucketInMs + inventedInMs - allowedInMs),
		);

		if (this._raised) {
			if (this._bucketInMs <= 0) return this._clear('audio recovered');

			return this.trackMonitor.issues.update({
				key: this.issueKey,
				payload: {
					excessInventedMs: this._bucketInMs,
					inventedSpeechRatio: ratio,
				},
			});
		}

		if (this._bucketInMs < this.config.raiseAfterInventedMs) return;

		this._raised = true;
		// Wall clock, and only for the resolved issue's `durationInMs`.
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('invented-speech', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			inventedSpeechRatio: ratio,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
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

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: InventedSpeechIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as InventedSpeechIssuePayload),
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
