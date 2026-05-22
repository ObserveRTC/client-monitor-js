import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type AudioDesyncIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	dCorrectedSamples: number;
	fractionalCorrection: number;
	durationInMs?: number;
}

/**
 * Audio Desynchronization Detector
 *
 * Detects audio synchronization issues by monitoring the rate of sample corrections
 * (acceleration/deceleration) applied to inbound audio tracks. When audio frames arrive
 * at incorrect rates, the audio subsystem compensates by inserting or removing samples,
 * which can indicate timing issues between audio and video streams.
 *
 * **Detection Logic:**
 * - Monitors `insertedSamplesForDeceleration` and `removedSamplesForAcceleration` from WebRTC stats
 * - Calculates fractional correction rate: corrected_samples / (corrected_samples + received_samples)
 * - Uses hysteresis thresholds to prevent oscillation between alert states
 * - Triggers on sustained high correction rates, clears on sustained low correction rates
 *
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `fractionalCorrectionAlertOnThreshold`: Correction rate threshold to trigger alert (default: 0.1)
 * - `fractionalCorrectionAlertOffThreshold`: Correction rate threshold to clear alert (default: 0.05)
 *
 * **Events Emitted:**
 * - `audio-desync-track`: Emitted when audio desync is first detected
 *
 * **Issues Created:**
 * - Type: `audio-desync`
 * - Payload: `{ peerConnectionId, trackId, dCorrectedSamples, fractionalCorrection }`
 *
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   audioDesyncDetector: {
 *     disabled: false,
 *     fractionalCorrectionAlertOnThreshold: 0.1,  // 10% correction rate triggers alert
 *     fractionalCorrectionAlertOffThreshold: 0.05  // 5% correction rate clears alert
 *   }
 * };
 *
 * // Listen for audio desync events
 * monitor.on('audio-desync-track', ({ trackMonitor }) => {
 *   console.log('Audio desync detected on track:', trackMonitor.track.id);
 * });
 * ```
 */
export class AudioDesyncDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-desync';
	/** Unique identifier for this detector type */
	public readonly name = 'audio-desync-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;

	/**
	 * Creates a new AudioDesyncDetector instance
	 * @param trackMonitor - The inbound track monitor to analyze for audio desync
	 */

	private readonly issueKey: string;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${AudioDesyncDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	/** Timestamp when current desync period started */
	private _startedDesyncAt?: number;

	/** Previous corrected samples count for delta calculation */
	private _prevCorrectedSamples = 0;

	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.audioDesyncDetector!;
	}

	/** Gets the peer connection monitor that owns this track */
	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/**
	 * Updates the detector state and checks for audio desynchronization
	 *
	 * This method is called periodically during stats collection to analyze
	 * the current state of audio sample corrections and determine if the
	 * track is experiencing desynchronization issues.
	 *
	 * **Processing Steps:**
	 * 1. Validates that this is an audio track with valid stats
	 * 2. Calculates the rate of sample corrections in the current period
	 * 3. Applies hysteresis logic to determine alert state transitions
	 * 4. Emits events and creates issues when desync is detected
	 * 5. Tracks desync duration for reporting
	 */
	public update() {
		if (this.disabled) return;
		const inboundRtp = this.trackMonitor.getInboundRtp();
		if (!inboundRtp || inboundRtp.kind !== 'audio') return;

		const correctedSamples = (inboundRtp.insertedSamplesForDeceleration ?? 0) + (inboundRtp.removedSamplesForAcceleration ?? 0);
		const dCorrectedSamples = correctedSamples - this._prevCorrectedSamples;

		if (dCorrectedSamples < 1 || (inboundRtp.receivingAudioSamples ?? 0) < 1) return;

		const fractionalCorrection = dCorrectedSamples / (dCorrectedSamples + (inboundRtp.receivingAudioSamples ?? 0));

		const wasDesync = inboundRtp.desync;
		if (inboundRtp.desync) {
			if (fractionalCorrection < this.config.fractionalCorrectionAlertOffThreshold) {
				inboundRtp.desync = false;
			}
		} else {
			inboundRtp.desync = this.config.fractionalCorrectionAlertOnThreshold < fractionalCorrection;
		}

		if (!inboundRtp.desync) {
			if (wasDesync) {
				this._resolve(`Audio desync resolved after `);
			}
			return;
		} else if (wasDesync) {
			return;
		}

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
