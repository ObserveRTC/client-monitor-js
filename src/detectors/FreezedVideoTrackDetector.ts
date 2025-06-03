import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/**
 * Frozen Video Track Detector
 * 
 * Detects when inbound video tracks experience frame freezes by monitoring
 * the `freezeCount` statistic from WebRTC inbound RTP statistics. Frame freezes
 * occur when video playback stalls due to missing, corrupted, or delayed frames.
 * 
 * **Detection Logic:**
 * - Monitors `freezeCount` from inbound RTP statistics
 * - Compares current freeze count with previous value to detect new freezes
 * - Sets `isFreezed` flag when new freeze events are detected
 * - Emits events on freeze state transitions (started/stopped)
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `createIssue`: Whether to create ClientIssue when video freeze is detected
 * 
 * **Events Emitted:**
 * - `freezed-video-track`: Emitted when video frame freeze is detected
 * 
 * **Issues Created:**
 * - Type: `freezed-video-track`
 * - Payload: `{ trackId }`
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   videoFreezesDetector: {
 *     disabled: false,
 *     createIssue: true
 *   }
 * };
 * 
 * // Listen for video freeze events
 * monitor.on('freezed-video-track', ({ trackMonitor }) => {
 *   console.log('Video freeze detected on track:', trackMonitor.track.id);
 * });
 * ```
 */
export class FreezedVideoTrackDetector implements Detector {
	/** Unique identifier for this detector type */
	public readonly name = 'freezed-video-track-detector';
	
	/**
	 * Creates a new FreezedVideoTrackDetector instance
	 * @param trackMonitor - The inbound track monitor to analyze for video freezes
	 */
	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
	}

	/** Gets the detector configuration from the client monitor */
	private get _config() {
		return this.peerConnection.parent.config.videoFreezesDetector;
	}

	/** Gets the peer connection monitor that owns this track */
	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Previous freeze count for delta calculation */
	private _lastFreezeCount = 0;

	/**
	 * Updates the detector state and checks for video frame freezes
	 * 
	 * This method monitors changes in the freeze count to detect when video
	 * frames have stopped updating, indicating a freeze condition.
	 * 
	 * **Processing Steps:**
	 * 1. Gets current inbound RTP statistics and freeze count
	 * 2. Calculates delta from previous freeze count
	 * 3. Updates freeze state based on whether new freezes occurred
	 * 4. Emits events and creates issues on freeze state transitions
	 * 5. Updates tracking variables for next iteration
	 */
	public update() {
		const inboundRtp = this.trackMonitor.getInboundRtp();
		if (!inboundRtp || !inboundRtp.freezeCount || this._config.disabled) {
			return;
		}

		const wasFreezed = inboundRtp.isFreezed;
		const clientMonitor = this.peerConnection.parent;

		inboundRtp.isFreezed = 0 < Math.max(0, inboundRtp.freezeCount - this._lastFreezeCount);
		this._lastFreezeCount = inboundRtp.freezeCount;

		if (!wasFreezed && inboundRtp.isFreezed) {
			clientMonitor.emit('freezed-video-track', {
				clientMonitor: this.peerConnection.parent,
				trackMonitor: this.trackMonitor,
			});

			if (this._config.createIssue) {
				clientMonitor.addIssue({
					type: 'freezed-video-track',
					payload: {
						trackId: inboundRtp.trackIdentifier,
					}
				});
			}

		} else if (wasFreezed && !inboundRtp.isFreezed) {
			// clientMonitor.addIssue({
			// 	type: 'freezed-video-track',
			// 	payload: {
			// 		peerConnectionId: this.peerConnection.peerConnectionId,
			// 		trackId: inboundRtp.trackIdentifier,
			// 		ssrc: inboundRtp.ssrc,
			// 		duration: Date.now() - this._startedFreezeAt,
			// 		issueContext,
			// 	}
			// });
		}
	}
}
