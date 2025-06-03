import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";

/**
 * Playout Discrepancy Detector
 * 
 * Detects discrepancies between frames received and frames rendered in inbound video tracks.
 * This can indicate video playout issues where frames are being dropped during rendering,
 * potentially due to performance issues, processing delays, or display problems.
 * 
 * **Detection Logic:**
 * - Monitors delta between `deltaFramesReceived` and `deltaFramesRendered`
 * - Calculates frame skew: received frames - rendered frames
 * - Uses hysteresis with high/low thresholds to prevent oscillation
 * - Triggers when frame skew exceeds high threshold, clears when below low threshold
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `createIssue`: Whether to create ClientIssue when playout discrepancy is detected
 * - `highSkewThreshold`: Frame skew threshold to trigger detection
 * - `lowSkewThreshold`: Frame skew threshold to clear detection (hysteresis)
 * 
 * **Events Emitted:**
 * - `inbound-video-playout-discrepancy`: Emitted when playout discrepancy is detected
 * 
 * **Issues Created:**
 * - Type: `inbound-video-playout-discrepancy`
 * - Payload: `{ trackId, frameSkew, ewmaFps }`
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   playoutDiscrepancyDetector: {
 *     disabled: false,
 *     createIssue: true,
 *     highSkewThreshold: 10,  // Trigger when 10+ frames are skewed
 *     lowSkewThreshold: 3     // Clear when skew drops below 3 frames
 *   }
 * };
 * 
 * // Listen for playout discrepancy events
 * monitor.on('inbound-video-playout-discrepancy', ({ trackMonitor, frameSkew }) => {
 *   console.log('Video playout discrepancy on track:', trackMonitor.track.id);
 *   console.log('Frame skew:', frameSkew, 'frames');
 * });
 * ```
 */
export class PlayoutDiscrepancyDetector implements Detector {
	/** Unique identifier for this detector type */
	public readonly name = 'playout-discrepancy-detector';
	
	/**
	 * Creates a new PlayoutDiscrepancyDetector instance
	 * @param trackMonitor - The inbound track monitor to analyze for playout discrepancies
	 */
	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
	}

	/** Gets the peer connection monitor that owns this track */
	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.playoutDiscrepancyDetector;
	}

	/** Flag indicating if playout discrepancy is currently active */
	public active = false;

	/**
	 * Updates the detector state and checks for video playout discrepancies
	 * 
	 * This method monitors the difference between received and rendered frames
	 * to detect when video frames are being dropped during playout.
	 * 
	 * **Processing Steps:**
	 * 1. Skip if detector is disabled or required stats are missing
	 * 2. Calculate frame skew (received - rendered frames)
	 * 3. Apply hysteresis logic using high/low thresholds
	 * 4. Emit events and create issues when discrepancy is first detected
	 * 5. Track active state to prevent duplicate alerts
	 */
	public update() {
		if (this.config.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || !inboundRtp.deltaFramesReceived || !inboundRtp.deltaFramesRendered || !inboundRtp.ewmaFps) return;

		const frameSkew = inboundRtp.deltaFramesReceived - inboundRtp.deltaFramesRendered;

		if (this.active) {
			if (frameSkew < this.config.lowSkewThreshold) {
				this.active = false;
				return;
			}

			return;
		}

		if (frameSkew < this.config.highSkewThreshold) return;

		this.active = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('inbound-video-playout-discrepancy', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		if (this.config.createIssue) {
			clientMonitor.addIssue({
				type: 'inbound-video-playout-discrepancy',
				payload: {
					trackId: this.trackMonitor.track.id,
					frameSkew,
					ewmaFps: inboundRtp.ewmaFps,
				}
			});
		}
	}
}