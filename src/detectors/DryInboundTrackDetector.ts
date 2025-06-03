import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";

/**
 * Dry Inbound Track Detector
 * 
 * Detects inbound tracks that have stopped receiving data (gone "dry") despite
 * the remote peer continuing to send. This can indicate network issues, codec
 * problems, or other transmission failures that prevent media from flowing.
 * 
 * **Detection Logic:**
 * - Monitors `bytesReceived` from inbound RTP statistics
 * - Tracks duration when bytesReceived remains at 0
 * - Ignores periods when remote track is paused (expected behavior)
 * - Triggers alert after configured threshold duration
 * - Only triggers once per track until reset
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `createIssue`: Whether to create ClientIssue when dry track is detected
 * - `thresholdInMs`: Duration threshold in milliseconds before triggering (default: 5000ms)
 * 
 * **Events Emitted:**
 * - `dry-inbound-track`: Emitted when track is detected as dry
 * 
 * **Issues Created:**
 * - Type: `dry-inbound-track`
 * - Payload: `{ trackId, duration }`
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   dryInboundTrackDetector: {
 *     disabled: false,
 *     createIssue: true,
 *     thresholdInMs: 5000  // 5 seconds of no data
 *   }
 * };
 * 
 * // Listen for dry track events
 * monitor.on('dry-inbound-track', ({ trackMonitor }) => {
 *   console.log('Dry inbound track detected:', trackMonitor.track.id);
 * });
 * ```
 */
export class DryInboundTrackDetector implements Detector {
	/** Unique identifier for this detector type */
	public readonly name = 'dry-inbound-track-detector';
	
	/**
	 * Creates a new DryInboundTrackDetector instance
	 * @param trackMonitor - The inbound track monitor to analyze for data flow
	 */
	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
	}

	/** Flag to prevent multiple events for the same dry period */
	private _evented = false;

	/** Gets the peer connection monitor that owns this track */
	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.dryInboundTrackDetector;
	}

	/** Timestamp when the dry period started */
	private _activatedAt?: number;

	/**
	 * Updates the detector state and checks for dry inbound track conditions
	 * 
	 * This method monitors the flow of inbound data and detects when a track
	 * stops receiving bytes for an extended period, indicating a transmission issue.
	 * 
	 * **Processing Steps:**
	 * 1. Skip if already evented or detector is disabled
	 * 2. Check if track is receiving data (bytesReceived > 0)
	 * 3. Reset timer if remote track is paused (expected behavior)
	 * 4. Start timing if no data is flowing and track should be active
	 * 5. Trigger alert if dry duration exceeds threshold
	 * 6. Emit event and create issue when dry condition is detected
	 */
	public update() {
		if (this._evented || this.config.disabled) return;
		if (this.trackMonitor.getInboundRtp()?.bytesReceived !== 0) return;
		if (this.trackMonitor.remoteOutboundTrackPaused) {
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

		clientMonitor.emit('dry-inbound-track', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		if (this.config.createIssue) {
			clientMonitor.addIssue({
				type: 'dry-inbound-track',
				payload: {
					trackId: this.trackMonitor.track.id,
					duration,
				}
			});
		}
	}
}