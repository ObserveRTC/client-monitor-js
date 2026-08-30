import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/** One ongoing audible-concealment episode on a single inbound audio track. */
export type AudioConcealmentIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Audible concealed samples over total samples received across the window, in `0..1`. */
	concealmentRate: number;
	/** Length of the sliding window the rate was measured over. */
	windowInMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

type WindowEntry = {
	timestamp: number;
	audibleConcealedSamples: number;
	totalSamplesReceived: number;
};

/**
 * Watches how inbound audio actually *sounded*, which packet loss does not tell you. Opus and
 * NetEQ conceal a great deal of loss inaudibly, and conversely audio falls apart without
 * dramatic loss when the jitter buffer misbehaves, so concealment is both the more sensitive
 * and the more specific signal behind a "they were breaking up" complaint.
 *
 * Raw concealment would be the worse signal, though: `concealedSamples` also climbs through
 * ordinary silence, when NetEQ has nothing to play out and nobody could hear the difference.
 * Only the audible part counts here, with `silentConcealedSamples` subtracted out before the
 * rate is formed, and that subtraction is what keeps every quiet moment of every call from
 * reading as a fault.
 *
 * Concealment arrives in bursts, so a per-tick threshold would flap. Audible and total samples
 * are accumulated over a sliding `windowInMs` and the ratio is judged across the whole window,
 * with separate on and off thresholds so a recovering stream does not oscillate.
 *
 * It declines to judge in three situations. While this leg's consumer is paused, or the remote
 * producer is paused, nothing is being sent and concealment means nothing — the window is
 * discarded outright so the pause cannot leak into the next measurement. While the browser
 * omits the concealed or silent-concealed counters, there is no audible share to compute. And
 * until `minSamplesInWindow` samples have accumulated there is too little audio to draw a rate
 * from at all.
 *
 * Raises `audio-concealment`. Emits `audio-concealment`. Config: `audioConcealmentDetector`.
 */
export class AudioConcealmentDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-concealment';
	public readonly name = 'audio-concealment-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;
	private readonly _window: WindowEntry[] = [];
	private _sumAudible = 0;
	private _sumTotal = 0;
	private _alertOn = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${AudioConcealmentDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.audioConcealmentDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'audio') return;

		if (this.trackMonitor.paused) {
			this._resetWindow();

			return this._alertOn ? this._clear('consumer paused') : undefined;
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this._resetWindow();

			return this._alertOn ? this._clear('remote track paused') : undefined;
		}

		const deltaTotal = inboundRtp.deltaTotalSamplesReceived;

		if (deltaTotal === undefined) return;

		if (inboundRtp.deltaConcealedSamples === undefined) return;
		if (inboundRtp.deltaSilentConcealedSamples === undefined) return;

		// concealedSamples rises during ordinary silence too, so the silent part is subtracted out
		const audible = Math.max(
			0,
			inboundRtp.deltaConcealedSamples - inboundRtp.deltaSilentConcealedSamples,
		);

		const now = Date.now();

		this._window.push({
			timestamp: now,
			audibleConcealedSamples: audible,
			totalSamplesReceived: deltaTotal,
		});
		this._sumAudible += audible;
		this._sumTotal += deltaTotal;

		const windowInMs = this.config.windowInMs;

		for (
			let oldest = this._window[0];
			oldest && oldest.timestamp < now - windowInMs;
			oldest = this._window[0]
		) {
			this._sumAudible -= oldest.audibleConcealedSamples;
			this._sumTotal -= oldest.totalSamplesReceived;
			this._window.shift();
		}

		const oldestEntry = this._window[0];

		if (!oldestEntry) return;
		if (this._sumTotal < this.config.minSamplesInWindow) return;

		const concealmentRate = this._sumAudible / this._sumTotal;

		if (this._alertOn) {
			if (concealmentRate < this.config.offThreshold) {
				this._clear('concealment back to normal');
			}

			return;
		}

		if (concealmentRate <= this.config.onThreshold) return;

		this._alertOn = true;
		this._startedAt = now;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('audio-concealment', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			concealmentRate,
		});

		clientMonitor.raiseIssue<AudioConcealmentIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: AudioConcealmentDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				concealmentRate,
				windowInMs,
			},
		});
	}

	private _resetWindow() {
		this._window.length = 0;
		this._sumAudible = 0;
		this._sumTotal = 0;
	}

	private _clear(comment: string) {
		this._alertOn = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: AudioConcealmentIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as AudioConcealmentIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<AudioConcealmentIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
