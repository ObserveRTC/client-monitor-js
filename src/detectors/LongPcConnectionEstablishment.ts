import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

/**
 * Detects when peer connection establishment takes longer than expected.
 * 
 * This detector monitors the duration of peer connection establishment and triggers
 * an alert when the connection remains in 'connecting' state for longer than the
 * configured threshold. It uses a one-time event emission pattern to avoid
 * duplicate alerts for the same connection attempt.
 * 
 * **Configuration Options:**
 * - `disabled`: Whether the detector is disabled (default: false)
 * - `thresholdInMs`: Maximum allowed duration for connection establishment in milliseconds
 * - `createIssue`: Whether to create an issue when long establishment is detected
 * 
 * **Events Emitted:**
 * - `too-long-pc-connection-establishment`: Emitted when connection establishment exceeds threshold
 * 
 * **Usage Example:**
 * ```typescript
 * const detector = new LongPcConnectionEstablishmentDetector(peerConnectionMonitor);
 * 
 * clientMonitor.on('too-long-pc-connection-establishment', (event) => {
 *   console.log(`Connection establishment took too long: ${event.peerConnectionMonitor.peerConnectionId}`);
 * });
 * ```
 * 
 * **Behavior:**
 * - Only monitors connections in 'connecting' state
 * - Resets event flag when connection transitions to 'connected'
 * - Uses one-time emission per connection attempt to prevent spam
 * - Requires `connectingStartedAt` timestamp to calculate duration
 */
export class LongPcConnectionEstablishmentDetector implements Detector{
	public readonly name = 'long-pc-connection-establishment-detector';
	
	private get config() {
		return this.peerConnection.parent.config.longPcConnectionEstablishmentDetector;
	}

	/**
	 * Flag to ensure one-time event emission per connection attempt
	 */
	private _evented = false;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		
	}

	public update(): void {
		if (this.config.disabled) return;
		if (this.peerConnection.connectionState !== 'connecting') {
			if (this._evented && this.peerConnection.connectionState === 'connected') {
				return (this._evented = false, void 0)
			}
			return;
		}
		if (this._evented) return;
		if (this.peerConnection.connectingStartedAt === undefined) return;
		
		const duration = Date.now() - this.peerConnection.connectingStartedAt;
		if (duration < this.config.thresholdInMs) {
			return;
		}
		this._evented = true;
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('too-long-pc-connection-establishment', {
			peerConnectionMonitor: this.peerConnection,
			clientMonitor,
		});

		if (this.config.createIssue) {
			clientMonitor.addIssue({
				type: 'long-pc-connection-establishment',
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					duration,
				}
			})
		}
	}
}