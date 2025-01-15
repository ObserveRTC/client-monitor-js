import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientMonitorEvents } from "../ClientMonitorEvents";

export type CongestionDecetorEvent = ClientMonitorEvents['congestion'];

export class CongestionDetector implements Detector {
	public readonly name = 'congestion-detector';
	
	public constructor(
		public readonly peerConnection: PeerConnectionMonitor
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.congestionDetector;
	}

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

		if (!isCongested) {
			if (this.peerConnection.congested) {
				this.peerConnection.congested = false;
			}
			return;
		} else if (this.peerConnection.congested) {
			return;
		}

		// congestion is detected
		this.peerConnection.congested = true;

		const targetIncomingBitrateAfterCongestion = this.peerConnection.selectedIceCandidatePairs.reduce((acc, pair) => acc + (pair.availableIncomingBitrate ?? 0), 0);
		const targetOutgoingBitrateAfterCongestion = this.peerConnection.selectedIceCandidatePairs.reduce((acc, pair) => acc + (pair.availableOutgoingBitrate ?? 0), 0);
		const eventBase = {
			targetIncomingBitrateAfterCongestion,
			targetOutgoingBitrateAfterCongestion,
			targetIncomingBitrateBeforeCongestion: this.peerConnection.highestSeenAvailableIncomingBitrate,
			targetOutgoingBitrateBeforeCongestion: this.peerConnection.highestSeenAvailableOutgoingBitrate,
			highestSeenIncomingBitrateBeforeCongestion: this.peerConnection.highestSeenReceivingBitrate,
			highestSeenOutgoingBitrateBeforeCongestion: this.peerConnection.highestSeenSendingBitrate,
		}

		this.peerConnection.highestSeenAvailableIncomingBitrate = undefined;
		this.peerConnection.highestSeenAvailableOutgoingBitrate = undefined;
		this.peerConnection.highestSeenReceivingBitrate = undefined;
		this.peerConnection.highestSeenSendingBitrate = undefined;

		this.peerConnection.parent.emit('congestion', {
			...eventBase,
			peerConnectionMonitor: this.peerConnection,
		});
		this.peerConnection.parent.addIssue({
			type: 'congestion',
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				...eventBase,
			},
		});
	}
}
