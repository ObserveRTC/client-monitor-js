import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { Detector } from "./Detector";

/**
 * Dry Outbound Track Detector
 * 
 * Detects outbound tracks that have stopped sending data (gone "dry").
 * This can indicate issues with media capture, encoding problems, network
 * transmission failures, or track state changes that prevent data from being sent.
 * 
 * **Detection Logic:**
 * - Monitors `bytesSent` from outbound RTP statistics
 * - Triggers when no bytes are being sent for a configured duration
 * - Ignores muted tracks or tracks not in 'live' state
 * - Uses timer-based detection with configurable threshold
 * - One-time event emission using `_evented` flag
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `createIssue`: Whether to create ClientIssue when dry track is detected
 * - `thresholdInMs`: Duration threshold in milliseconds to trigger detection
 * 
 * **Events Emitted:**
 * - `dry-outbound-track`: Emitted when outbound track stops sending data
 * 
 * **Issues Created:**
 * - Type: `dry-outbound-track`
 * - Payload: `{ trackId, duration }`
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   dryOutboundTrackDetector: {
 *     disabled: false,
 *     createIssue: true,
 *     thresholdInMs: 5000 // 5 seconds
 *   }
 * };
 * 
 * // Listen for dry outbound track events
 * monitor.on('dry-outbound-track', ({ trackMonitor, duration }) => {
 *   console.log('Outbound track stopped sending data:', trackMonitor.track.id);
 *   console.log('Duration without data:', duration, 'ms');
 * });
 * ```
 */
export class DryOutboundTrackDetector implements Detector {
	/** Unique identifier for this detector type */
	public readonly name = 'dry-outbound-track-detector';
	
	/**
	 * Creates a new DryOutboundTrackDetector instance
	 * @param trackMonitor - The outbound track monitor to analyze for data transmission
	 */
	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
	}

	/** Flag to prevent duplicate event emission - set to true once event is triggered */
	private _evented = false;

	/** Gets the peer connection monitor that owns this track */
	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.dryOutboundTrackDetector;
	}

	/** Timestamp when the detector first detected no data transmission */
	private _activatedAt?: number;

	/**
	 * Updates the detector state and checks for dry outbound track condition
	 * 
	 * This method monitors outbound data transmission and detects when a track
	 * stops sending data for an extended period.
	 * 
	 * **Processing Steps:**
	 * 1. Skip if already evented, disabled, or bytes are being sent
	 * 2. Reset timer if track is muted or not live
	 * 3. Start timer when no bytes are being sent
	 * 4. Trigger detection when threshold duration is exceeded
	 * 5. Emit event and create issue (one-time only)
	 */
	public update() {
		if (this._evented || this.config.disabled) return;
		if (this.trackMonitor.getOutboundRtps()?.[0]?.bytesSent !== 0) return;
		if (this.trackMonitor.track.muted || this.trackMonitor.track.readyState !== 'live') {
			this._activatedAt = undefined;
			return;
		}

		if (!this._activatedAt) {
			this._activatedAt = Date.now();
		}

		const duration = Date.now() - this._activatedAt;

		if (duration < this.config.thresholdInMs) return;

		this._evented = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dry-outbound-track', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		if (this.config.createIssue) {
			clientMonitor.addIssue({
				type: 'dry-outbound-track',
				payload: {
					trackId: this.trackMonitor.track.id,
					duration,
				}
			});
		}
	}
}