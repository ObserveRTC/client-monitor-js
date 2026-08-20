import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type AudioConcealmentIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Audible concealment share over the evaluation window, in `0..1`. */
	concealmentRate: number;
	/** Concealment events per second over the evaluation window. */
	concealmentEventRate: number;
	/** How the concealment was distributed: many short gaps or few long ones. */
	burstiness: 'bursty' | 'continuous' | 'unknown';
	windowInMs: number;
	durationInMs?: number;
}

type WindowEntry = {
	timestamp: number;
	audibleConcealedSamples: number;
	totalSamplesReceived: number;
	concealmentEvents: number;
};

/**
 * Audio Concealment Detector
 *
 * Reports how the audio actually *sounded*, which packet loss does not.
 * Opus + NetEQ conceal a great deal of loss inaudibly, and conversely audio
 * degrades without dramatic loss when the jitter buffer misbehaves — so
 * concealment is both the more sensitive and the more specific signal.
 *
 * **Detection logic:**
 * - Accumulates audible concealment over a sliding window rather than judging a
 *   single stats tick, because concealment is bursty by nature and a per-tick
 *   threshold would flap.
 * - Raises `audio-concealment` when the windowed rate crosses `onThreshold`,
 *   resolves under `offThreshold` (hysteresis).
 *
 * **Why "audible":** `concealedSamples` also rises during ordinary silence, so
 * `InboundRtpMonitor` subtracts `silentConcealedSamples` before this detector
 * ever sees the number. Without that subtraction this would flag every quiet
 * moment in every call — a worse signal than packet loss rather than a better
 * one.
 *
 * **False-positive guards:** the detector stays silent while the remote track is
 * paused (nothing is being sent, so nothing can be concealed meaningfully) and
 * while too few samples arrived in the window to judge.
 *
 * **Issues created:**
 * - Type: `audio-concealment`
 */
export class AudioConcealmentDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-concealment';
	public readonly name = 'audio-concealment-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	/** Hard cap protecting against pathologically fast update rates. */
	private static readonly MAX_WINDOW_ENTRIES = 128;

	private readonly issueKey: string;
	private readonly _window: WindowEntry[] = [];
	// running sums over _window, maintained on push/evict
	private _sumAudible = 0;
	private _sumTotal = 0;
	private _sumEvents = 0;
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

		// a paused remote track would otherwise look like total concealment failure
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this._resetWindow();

			return this._alertOn ? this._clear('remote track paused') : undefined;
		}

		const deltaTotal = inboundRtp.deltaTotalSamplesReceived;

		if (deltaTotal === undefined) return;

		const audible = Math.max(
			0,
			(inboundRtp.deltaConcealedSamples ?? 0) - (inboundRtp.deltaSilentConcealedSamples ?? 0),
		);

		const now = Date.now();
		const events = inboundRtp.deltaConcealmentEvents ?? 0;

		this._window.push({
			timestamp: now,
			audibleConcealedSamples: audible,
			totalSamplesReceived: deltaTotal,
			concealmentEvents: events,
		});
		this._sumAudible += audible;
		this._sumTotal += deltaTotal;
		this._sumEvents += events;

		const windowInMs = this.config.windowInMs;

		for (
			let oldest = this._window[0];
			oldest && (oldest.timestamp < now - windowInMs || AudioConcealmentDetector.MAX_WINDOW_ENTRIES < this._window.length);
			oldest = this._window[0]
		) {
			this._sumAudible -= oldest.audibleConcealedSamples;
			this._sumTotal -= oldest.totalSamplesReceived;
			this._sumEvents -= oldest.concealmentEvents;
			this._window.shift();
		}

		const oldestEntry = this._window[0];

		if (!oldestEntry) return;
		if (this._sumTotal < this.config.minSamplesInWindow) return;

		const concealmentRate = this._sumAudible / this._sumTotal;
		const elapsedInSec = Math.max(1, now - oldestEntry.timestamp) / 1000;
		const concealmentEventRate = this._sumEvents / elapsedInSec;

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
			concealmentEventRate,
		});

		clientMonitor.raiseIssue<AudioConcealmentIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: AudioConcealmentDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				concealmentRate,
				concealmentEventRate,
				burstiness: this._classifyBurstiness(this._sumAudible, this._sumEvents),
				windowInMs,
			},
		});
	}

	private _resetWindow() {
		this._window.length = 0;
		this._sumAudible = 0;
		this._sumTotal = 0;
		this._sumEvents = 0;
	}

	private _classifyBurstiness(concealedSamples: number, events: number): 'bursty' | 'continuous' | 'unknown' {
		if (events < 1) return 'unknown';

		const samplesPerEvent = concealedSamples / events;

		// At 48 kHz, 4800 samples is 100 ms — beyond that a single event is a
		// perceptible dropout rather than a click.
		return samplesPerEvent < 4800 ? 'bursty' : 'continuous';
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
