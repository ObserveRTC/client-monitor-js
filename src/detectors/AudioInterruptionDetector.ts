import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/** One ongoing episode of audio dropouts on a single inbound audio track. */
export type AudioInterruptionIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Interruptions (concealment events of 150 ms or longer) that ended since the episode's first one. */
	interruptionCount: number;
	/** Their total duration, in milliseconds. */
	interruptedMs: number;
	/** `interruptedMs / interruptionCount`: a single long dropout versus several shorter ones. */
	avgInterruptionInMs: number;
	/** Interrupted milliseconds beyond the allowance that had accumulated. */
	excessInterruptedMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type AudioInterruptionDetectorConfig = {
	/** Share of stream time (`0..1`) that may be spent interrupted for free. Also the drain rate. */
	allowedInterruptedRatio: number;

	/**
	 * Interrupted milliseconds beyond the allowance needed to raise. Doubles as the resolve bar: a
	 * full accumulator empties after `raiseAfterInterruptedMs / allowedInterruptedRatio` ms without
	 * interruptions.
	 */
	raiseAfterInterruptedMs: number;
}

/**
 * Reports **audio dropouts** on one inbound audio stream: stretches of 150 ms or longer where NetEQ
 * had nothing to decode and played concealment instead. The listener hears the voice cut out.
 *
 * This is the finding `ConcealedSamplesDetector` cannot make. NetEQ fades its concealment to
 * silence within roughly 60–120 ms and counts everything after that as `silentConcealedSamples`,
 * which that detector subtracts so DTX silence does not read as a fault — and with it the tail of
 * every long gap. libwebrtc measures those gaps separately: every concealment event of at least
 * 150 ms, silent part included, is an *interruption*, exposed on audio `inbound-rtp` as
 * `interruptionCount` and `totalInterruptionDuration`. Comfort noise during DTX is not expansion,
 * so it does not produce interruptions.
 *
 * The counters advance only when an interruption *ends*, so this is retrospective: the dropout is
 * credited whole to the collection in which audio came back. Each collection adds its interrupted
 * milliseconds to one accumulator and drains `allowedInterruptedRatio × deltaTime`, clamped to
 * `raiseAfterInterruptedMs`. The issue opens when it is full and closes when it is empty, so one
 * long dropout or a cluster of shorter ones raises, and a single 150 ms blip does not.
 *
 * A pause is a dropout NetEQ cannot tell from a fault: while the consumer or the remote producer is
 * paused, and on the collection in which received audio resumes after such a stand-down, the
 * interrupted time is discarded. A remote pause the application does not declare through
 * `remoteOutboundTrackPaused` reads as a dropout.
 *
 * **Chromium only.** Firefox and WebKit report neither counter, so the detector reports its inputs
 * unavailable there — absence of the issue on those browsers is absence of measurement, not health.
 *
 * Issue raised: `audio-interruption`. Monitor event: `audio-interruption`.
 * Config: `audioInterruptionDetector`.
 *
 * Category: Perceived Quality
 * Layer: Audio — continuity
 *
 */
export class AudioInterruptionDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-interruption';
	public readonly name = 'audio-interruption-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _bucketInMs = 0;
	private _raised = false;
	private _startedAt?: number;
	/** Set by a stand-down: the interruption that ends when audio resumes is the pause, not a fault. */
	private _awaitingResume = false;
	/** Interruptions counted since the accumulator was last empty, for the payload. */
	private _episodeCount = 0;
	private _episodeInMs = 0;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${AudioInterruptionDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.audioInterruptionDetector!;
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

		if (inboundRtp.interruptionCount === undefined || inboundRtp.totalInterruptionDuration === undefined) {
			// Not Chromium, or a Chromium that stopped exposing them. Blind, not fine.
			this.inputsUnavailable = true;
			this.trackMonitor.audioInterruptionSeverity = undefined;

			return;
		}

		this.inputsUnavailable = false;

		const elapsedInMs = inboundRtp.deltaTime ?? 0;
		let interruptedInMs = inboundRtp.deltaTotalInterruptionDurationInMs ?? 0;
		let interruptions = inboundRtp.deltaInterruptionCount ?? 0;

		if (this._awaitingResume) {
			if (0 < (inboundRtp.deltaTotalSamplesReceived ?? 0)) {
				// Audio is flowing again. Whatever interruption ended on this collection is the
				// pause ending, so it is dropped, and judging resumes from the next one.
				this._awaitingResume = false;
			}
			interruptedInMs = 0;
			interruptions = 0;
		}

		if (this._bucketInMs <= 0) {
			this._episodeCount = 0;
			this._episodeInMs = 0;
		}
		this._episodeCount += interruptions;
		this._episodeInMs += interruptedInMs;

		const allowedInMs = this.config.allowedInterruptedRatio * elapsedInMs;

		this._bucketInMs = Math.min(
			this.config.raiseAfterInterruptedMs,
			Math.max(0, this._bucketInMs + interruptedInMs - allowedInMs),
		);

		this.trackMonitor.audioInterruptionSeverity = 0 < this.config.raiseAfterInterruptedMs
			? this._bucketInMs / this.config.raiseAfterInterruptedMs
			: undefined;

		if (this._raised) {
			if (this._bucketInMs <= 0) return this._clear('audio recovered');

			return this.trackMonitor.issues.update({
				key: this.issueKey,
				payload: this._episodePayload(),
			});
		}

		if (this._bucketInMs < this.config.raiseAfterInterruptedMs) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('audio-interruption', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			interruptionCount: this._episodeCount,
			interruptedMs: this._episodeInMs,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: AudioInterruptionDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				...this._episodePayload(),
			},
		});
	}

	private _episodePayload() {
		return {
			interruptionCount: this._episodeCount,
			interruptedMs: this._episodeInMs,
			avgInterruptionInMs: 0 < this._episodeCount ? this._episodeInMs / this._episodeCount : 0,
			excessInterruptedMs: this._bucketInMs,
		};
	}

	/** Nothing is being judged: the accumulator is thrown away, and the resume is not a dropout. */
	private _standDown(comment: string) {
		this._bucketInMs = 0;
		this._awaitingResume = true;
		this.trackMonitor.audioInterruptionSeverity = undefined;

		if (this._raised) this._clear(comment);
	}

	private _clear(comment: string) {
		this._raised = false;

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: AudioInterruptionIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as AudioInterruptionIssuePayload),
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
