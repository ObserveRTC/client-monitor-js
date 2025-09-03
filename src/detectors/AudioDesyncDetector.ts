import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

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
 * - `createIssue`: Whether to create ClientIssue when audio desync is detected
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
 *     createIssue: true,
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
	/** Unique identifier for this detector type */
	public readonly name = 'audio-desync-detector';
	
	/**
	 * Creates a new AudioDesyncDetector instance
	 * @param trackMonitor - The inbound track monitor to analyze for audio desync
	 */
	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		
	}

	/** Duration of the last detected desync period in milliseconds */
	public lastDesyncDuration?: number;

	/** Timestamp when current desync period started */
	private _startedDesyncAt?: number;

	/** Previous corrected samples count for delta calculation */
	private _prevCorrectedSamples = 0;
	
	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.audioDesyncDetector;
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
		const inboundRtp = this.trackMonitor.getInboundRtp();
		if (!inboundRtp || inboundRtp.kind !== 'audio') return;
		if (this.config.disabled) return;

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
				if (this._startedDesyncAt) {
					this.lastDesyncDuration = Date.now() - this._startedDesyncAt;
				}
				this._startedDesyncAt = undefined;
			}
			return;
		} else if (wasDesync) {
			return;
		}

		this._startedDesyncAt = Date.now();
		this.peerConnection.parent.emit('audio-desync-track', {
			clientMonitor: this.peerConnection.parent,
			trackMonitor: this.trackMonitor,
		});

		if (this.config.createIssue) {
			this.peerConnection.parent.addIssue({
				type: 'audio-desync',
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					trackId: this.trackMonitor.track.id,
					dCorrectedSamples,
					fractionalCorrection

				}
			})
		}
	}
}
