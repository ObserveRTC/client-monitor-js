import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientMonitorEvents } from "../ClientMonitorEvents";

export type CongestionDecetorEvent = ClientMonitorEvents['congestion'];

/**
 * Network Congestion Detector
 * 
 * Detects network congestion conditions by analyzing bandwidth limitations, RTT variations,
 * and packet loss patterns. The detector uses configurable sensitivity levels to balance
 * between early detection and false positives.
 * 
 * **Detection Logic:**
 * - Monitors `qualityLimitationReason` on outbound RTP streams for bandwidth limitations
 * - Analyzes RTT variations (difference between current and EWMA RTT values)
 * - Considers packet loss rates in conjunction with bandwidth limitations
 * - Uses sensitivity-based thresholds to determine congestion state
 * 
 * **Sensitivity Levels:**
 * - `high`: Triggers on any bandwidth limitation (most sensitive, may have false positives)
 * - `medium`: Requires bandwidth limitation + significant RTT increase (balanced approach)
 * - `low`: Requires bandwidth limitation + packet loss > 5% (least sensitive, high confidence)
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `createIssue`: Whether to create ClientIssue when congestion is detected
 * - `sensitivity`: Detection sensitivity level ('low', 'medium', 'high')
 * 
 * **Events Emitted:**
 * - `congestion`: Emitted when network congestion is first detected
 * 
 * **Issues Created:**
 * - Type: `congestion`
 * - Payload: Includes current and historical bandwidth/bitrate metrics
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   congestionDetector: {
 *     disabled: false,
 *     createIssue: true,
 *     sensitivity: 'medium'  // 'low', 'medium', 'high'
 *   }
 * };
 * 
 * // Listen for congestion events
 * monitor.on('congestion', ({ peerConnectionMonitor, availableIncomingBitrate }) => {
 *   console.log('Congestion detected on PC:', peerConnectionMonitor.peerConnectionId);
 *   console.log('Available bandwidth:', availableIncomingBitrate, 'bps');
 * });
 * ```
 */
export class CongestionDetector implements Detector {
	public static readonly ISSUE_TYPE = 'congestion';
	/** Unique identifier for this detector type */
	public readonly name = 'congestion-detector';
	
	/** Maximum available incoming bitrate observed during non-congested periods */
	private _maxAvailableIncomingBitrate = 0;

	/** Maximum receiving bitrate observed during non-congested periods */
	private _maxReceivingBitrate = 0;

	/** Maximum available outgoing bitrate observed during non-congested periods */
	private _maxAvailableOutgoingBitrate = 0;

	/** Maximum sending bitrate observed during non-congested periods */
	private _maxSendingBitrate = 0;

	/**
	 * Creates a new CongestionDetector instance
	 * @param peerConnection - The peer connection monitor to analyze for congestion
	 */
	public constructor(
		public readonly peerConnection: PeerConnectionMonitor
	) {
	}

	/** Gets the detector configuration from the client monitor */
	private get config() {
		return this.peerConnection.parent.config.congestionDetector;
	}

	/**
	 * Updates the detector state and checks for network congestion
	 * 
	 * This method analyzes various network quality indicators to determine if the
	 * peer connection is experiencing congestion. The detection logic varies based
	 * on the configured sensitivity level.
	 * 
	 * **Processing Steps:**
	 * 1. Checks for bandwidth-limited outbound RTP streams
	 * 2. Calculates RTT variation from EWMA baseline
	 * 3. Applies sensitivity-specific logic to determine congestion state
	 * 4. Updates historical maximums during non-congested periods
	 * 5. Emits events and creates issues when congestion is detected
	 * 6. Resets historical maximums after congestion detection for next cycle
	 * 
	 * **Sensitivity Logic:**
	 * - **High**: Any bandwidth limitation triggers congestion
	 * - **Medium**: Bandwidth limitation + RTT increase > 33% of current EWMA RTT (min 50ms, max 150ms)
	 * - **Low**: Bandwidth limitation + outbound packet loss > 5%
	 */
	public update() {
		if (this.config.disabled) return;

		let hasBwLimitedOutboundRtp = false;

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			hasBwLimitedOutboundRtp ||= outboundRtp.qualityLimitationReason === 'bandwidth';
			// isCongested ||= outboundRtp.stats.qualityLimitationReason === 'bandwidth';
		}

		let rttDiffInS = 0;
		if (this.peerConnection.avgRttInSec !== undefined) {
			if (this.peerConnection.ewmaRttInSec !== undefined) {
				rttDiffInS = Math.abs(this.peerConnection.avgRttInSec - this.peerConnection.ewmaRttInSec);
			}
		}

		let isCongested = false;
		switch (this.config.sensitivity) {
			case 'high':
				isCongested = hasBwLimitedOutboundRtp;
				break;
			case 'medium': {
				if (!this.peerConnection.ewmaRttInSec) break;
				
				const rttDiffThreshold = Math.min(0.15, Math.max(0.05, this.peerConnection.ewmaRttInSec * 0.33));
				
				isCongested = hasBwLimitedOutboundRtp && rttDiffInS > rttDiffThreshold;

				break;
			}
			case 'low': {
				if (!this.peerConnection.ewmaRttInSec || !this.peerConnection.outboundFractionLost) break;
				
				isCongested = hasBwLimitedOutboundRtp && this.peerConnection.outboundFractionLost > 0.05;
				break;
			}
		}
		const availableIncomingBitrate = this.peerConnection.totalAvailableIncomingBitrate;
		const availableOutgoingBitrate = this.peerConnection.totalAvailableOutgoingBitrate;

		if (!isCongested) {
			if (this.peerConnection.congested) {
				this.peerConnection.congested = false;
				this._resolveIssue();
			}
			this._maxAvailableIncomingBitrate = Math.max(this._maxAvailableIncomingBitrate, availableIncomingBitrate);
			this._maxAvailableOutgoingBitrate = Math.max(this._maxAvailableOutgoingBitrate, availableOutgoingBitrate);
			this._maxReceivingBitrate = Math.max(this._maxReceivingBitrate, this.peerConnection.receivingBitrate);
			this._maxSendingBitrate = Math.max(this._maxSendingBitrate, this.peerConnection.sendingBitrate);

			return;
		} else if (this.peerConnection.congested) {
			return;
		}

		// congestion is detected
		this.peerConnection.congested = true;
		this.peerConnection.parent.emit('congestion', {
			clientMonitor: this.peerConnection.parent,
			peerConnectionMonitor: this.peerConnection,
			availableIncomingBitrate,
			availableOutgoingBitrate,
			maxAvailableIncomingBitrate: this._maxAvailableIncomingBitrate,
			maxAvailableOutgoingBitrate: this._maxAvailableOutgoingBitrate,
			maxReceivingBitrate: this._maxSendingBitrate,
			maxSendingBitrate: this._maxSendingBitrate,
		});
		
		if (this.config.createIssue) {
			this.peerConnection.parent.addIssue({
				type: CongestionDetector.ISSUE_TYPE,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					availableIncomingBitrate,
					availableOutgoingBitrate,
					maxAvailableIncomingBitrate: this._maxAvailableIncomingBitrate,
					maxAvailableOutgoingBitrate: this._maxAvailableOutgoingBitrate,
					maxReceivingBitrate: this._maxReceivingBitrate,
					maxSendingBitrate: this._maxSendingBitrate,
				}
			});
		}

		this._maxAvailableIncomingBitrate = 0;
		this._maxAvailableOutgoingBitrate = 0;
		this._maxReceivingBitrate = 0;
		this._maxSendingBitrate = 0;
	}

	private _resolveIssue() {
		const clientMonitor = this.peerConnection.parent;

		return clientMonitor.resolveActiveIssues(CongestionDetector.ISSUE_TYPE, (issue) => {
			return (issue.payload as Record<string, unknown>)?.peerConnectionId === this.peerConnection.peerConnectionId;
		});
	}

}
