import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type AudioDesyncIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Samples NetEQ inserted or removed in the interval to realign the playout clock. */
	dCorrectedSamples: number;
	/** `dCorrectedSamples / (dCorrectedSamples + receivedSamples)`, in `0..1`. */
	fractionalCorrection: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

/**
 * Watches inbound audio for the stretching and squeezing NetEQ performs when samples arrive at
 * the wrong rate — the drift that ends with a speaker's voice trailing their lips.
 *
 * A client has no A/V timestamps to compare, so desync is inferred from the repair work rather
 * than observed directly: `insertedSamplesForDeceleration` and `removedSamplesForAcceleration`
 * count the samples NetEQ had to invent or throw away to hold the playout clock in place. Every
 * healthy stream needs a trickle of them; a stream whose clock is genuinely wrong needs them
 * continuously. The measure is scaled — corrections over corrections plus received samples — so
 * it reads the same on a busy stream as on a sparse one, and hysteresis (raised above one
 * threshold, resolved only below a lower one) keeps a borderline stream from flapping.
 *
 * It stands down while this leg's consumer or the remote producer is paused, resolving any open
 * issue: a stream nobody is sending cannot be out of sync. Ticks carrying no corrections, or no
 * received samples, are skipped rather than treated as evidence of alignment — an absent
 * measurement is not a healthy one.
 *
 * Raises `audio-desync`. Emits `audio-desync-track`. Config: `audioDesyncDetector`.
 */
export class AudioDesyncDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-desync';
	public readonly name = 'audio-desync-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${AudioDesyncDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private _startedDesyncAt?: number;

	private get config() {
		return this.peerConnection.parent.config.audioDesyncDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		const inboundRtp = this.trackMonitor.getInboundRtp();
		if (!inboundRtp || inboundRtp.kind !== 'audio') return;

		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			if (inboundRtp.desync) {
				inboundRtp.desync = false;
				this._resolve('track paused');
			}

			return;
		}

		const dCorrectedSamples =
			(inboundRtp.deltaInsertedSamplesForDeceleration ?? 0) +
			(inboundRtp.deltaRemovedSamplesForAcceleration ?? 0);
		const receivedSamples = inboundRtp.receivingAudioSamples ?? 0;

		if (dCorrectedSamples < 1 || receivedSamples < 1) return;

		const fractionalCorrection = dCorrectedSamples / (dCorrectedSamples + receivedSamples);
		const wasDesync = inboundRtp.desync === true;

		inboundRtp.desync = wasDesync
			? this.config.fractionalCorrectionAlertOffThreshold <= fractionalCorrection
			: this.config.fractionalCorrectionAlertOnThreshold < fractionalCorrection;

		if (inboundRtp.desync === wasDesync) return;
		if (!inboundRtp.desync) return this._resolve('audio desync resolved');

		this._raise({
			peerConnectionId: this.peerConnection.peerConnectionId,
			trackId: this.trackMonitor.track.id,
			dCorrectedSamples,
			fractionalCorrection,
		});
	}

	private _raise(payload: AudioDesyncIssuePayload) {
		this._startedDesyncAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('audio-desync-track', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
		});

		clientMonitor.raiseIssue<AudioDesyncIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: AudioDesyncDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: AudioDesyncIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as AudioDesyncIssuePayload),
				durationInMs: this._startedDesyncAt ? Date.now() - this._startedDesyncAt : undefined,
			};
		}

		clientMonitor.resolveIssue<AudioDesyncIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDesyncAt = undefined;
	}

}
