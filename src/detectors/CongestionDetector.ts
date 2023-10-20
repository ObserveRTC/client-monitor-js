import { AlertState, ClientMonitor, ClientMonitorEvents } from "../ClientMonitor";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";

/**
 * Configuration object for the CongestionDetector function.
 */
export type CongestionDetectorConfig = {
	/**
	 * The minimum deviation threshold for Round-Trip Time (RTT) in milliseconds.
	 * A higher value indicates a higher threshold for detecting congestion based on RTT deviation.
	 */
	minRTTDeviationThresholdInMs: number;

	/**
	 * The minimum duration threshold in milliseconds.
	 * If congestion is detected, this is the minimum duration before a reevaluation takes place.
	 */
	minDurationThresholdInMs: number;
	
	/**
	 * The deviation fold threshold. 
	 * This value is used as a multiplier with the standard deviation to compare against the deviation in RTT.
	 */
	deviationFoldThreshold: number;

	/**
	 * The fraction loss threshold for packet loss.
	 * If the fraction of packets lost is greater than this threshold, it is considered as congestion.
	 */
	fractionLossThreshold?: number;

	/**
	 * The window for measuring the RTT in milliseconds.
	 */
	measurementsWindowInMs: number;

	/**
	 * The minimum length of measurements in milliseconds. 
	 * This determines the minimum duration for which measurements should be taken before considering them for congestion detection.
	 */
	minMeasurementsLengthInMs: number;

	/**
	 * The minimum number of consecutive ticks required to consider a connection as congested. 
	 * A tick represents a deviation above the deviation fold threshold.
 	*/
	minConsecutiveTickThreshold: number;

}

export function createCongestionDetector(config: CongestionDetectorConfig & {
	clientMonitor: ClientMonitor
}) {
	const {
		clientMonitor,
	}	= config;

	type PeerConnectionState = {
		measurements: { added: number, RttInMs: number }[],
		sum: number,
		sumSquares: number,
		congested?: number,
		visited: boolean,
		ticks: number,
	}
	let alertState: AlertState	= 'off';
	const congestedPeerConnectionIds = new Set<string>();
	const peerConnectionStates = new Map<string, PeerConnectionState>();
	const isCongested = (now: number, state: PeerConnectionState, peerConnection: PeerConnectionEntry): boolean => {
		const {
			deltaInboundPacketsLost: totalInboundPacketsLost = 0,
			deltaInboundPacketsReceived: totalInboundPacketsReceived = 0,
			avgRttInS = -1,
			deltaOutboundPacketsSent: totalOutboundPacketsSent = 0,
			deltaOutboundPacketsLost: totalOutboundPacketsLost = 0,
		} = peerConnection;
		
		if (state.congested !== undefined && (now - state.congested) < config.minDurationThresholdInMs) {
			return true;
		}

		let inbFL = -1;
		let outbFL = -1;

		if (0 <= totalInboundPacketsLost && 0 < totalInboundPacketsReceived) {
			inbFL = totalInboundPacketsLost / (totalInboundPacketsReceived + totalInboundPacketsLost);
		}
		if (0 <= totalOutboundPacketsLost && 0 < totalOutboundPacketsSent) {
			outbFL = totalOutboundPacketsLost / (totalOutboundPacketsSent + totalOutboundPacketsLost);
		}
		const maxFL = Math.max(inbFL, outbFL);
		if (config.fractionLossThreshold !== undefined && config.fractionLossThreshold < maxFL) {
			return true;
		}

		if (avgRttInS < 0 || config.measurementsWindowInMs < 1) {
			return false;
		}
		const value = avgRttInS * 1000;

		state.sum += value;
		state.sumSquares += value * value;
		state.measurements.push({
			added: now,
			RttInMs: value,
		});
		for (let check = true; check && 0 < state.measurements.length; ) {
			const elapsedInMs = now - state.measurements[0].added;
			if (elapsedInMs < config.measurementsWindowInMs) {
				check = false;
				continue;
			}
			const removedValue = state.measurements.shift()!.RttInMs;
			state.sum -= removedValue;
			state.sumSquares -= removedValue * removedValue;
		}
		if (state.measurements.length < 1 || (now - state.measurements[0].added) < config.minMeasurementsLengthInMs) {
			return false;
		}
		
		const mean = state.sum / state.measurements.length;
		const variance = (state.sumSquares / state.measurements.length) - (mean * mean);
		const stdDev = Math.sqrt(variance);
		const deviation = Math.abs(value - mean);
		if (deviation < config.minRTTDeviationThresholdInMs) {
			return false;
		}
		if (config.deviationFoldThreshold * stdDev < deviation) {
			++state.ticks;
		} else {
			state.ticks = 0;
		}
		return Math.max(0, config.minConsecutiveTickThreshold) < state.ticks;
	}
	let highestSeenSendingBitrate = 0
	let highestSeenReceivingBitrate = 0
	let highestSeenAvailableOutgoingBitrate = 0;
	let highestSeenAvailableIncomingBitrate = 0;

	async function update() {
		const { storage } = clientMonitor;
		const now = Date.now();
		const congestedPeerConnectionIds = new Set<string>();
		const trackIds: string[] = [];
		for (const peerConnection of storage.peerConnections()) {
			const { 
				peerConnectionId 
			} = peerConnection;
			let state = peerConnectionStates.get(peerConnectionId);
			if (!state) {
				state = {
					measurements: [],
					sum: 0,
					sumSquares: 0,
					visited: false,
					ticks: 0,
				};
				peerConnectionStates.set(peerConnectionId, state);
			}
			state.visited = true;
			
			const wasCongested = state.congested !== undefined;
			const congested = isCongested(now, state, peerConnection);
			if (wasCongested && congested) {
				// no change
				continue;
			}
			if (!wasCongested && congested) {
				// it become congested now
				state.congested = now;
				congestedPeerConnectionIds.add(peerConnectionId);
				continue;
			}
			if (wasCongested && !congested) {
				state.congested = undefined;
				congestedPeerConnectionIds.delete(peerConnectionId);
				continue;
			}

			// it was not congested, and has not become congested
			highestSeenSendingBitrate = Math.max(
				highestSeenSendingBitrate, 
				(storage.sendingAudioBitrate ?? 0) + (storage.sendingVideoBitrate ?? 0)
			);
			highestSeenReceivingBitrate = Math.max(
				highestSeenReceivingBitrate, 
				(storage.receivingAudioBitrate ?? 0) + (storage.receivingVideoBitrate ?? 0)
			);
			highestSeenAvailableOutgoingBitrate = Math.max(
				highestSeenAvailableOutgoingBitrate, 
				(storage.totalAvailableOutgoingBitrate ?? 0)
			);
			highestSeenAvailableIncomingBitrate = Math.max(
				highestSeenAvailableIncomingBitrate, 
				(storage.totalAvailableIncomingBitrate ?? 0)
			);
		}

		for (const [pcId, state] of Array.from(peerConnectionStates)) {
			// console.warn("pc", pcId, state);
			if (state.visited) {
				state.visited = false;
			} else {
				peerConnectionStates.delete(pcId);
			}
		}
		const prevState = alertState;
		alertState = congestedPeerConnectionIds.size < 1 ? 'off' : 'on';
		if (prevState !== alertState) {
			clientMonitor.emit('congestion-alert', alertState);
			if (alertState === 'off') {
				highestSeenSendingBitrate = 0;
				highestSeenReceivingBitrate = 0;
				highestSeenAvailableOutgoingBitrate = 0;
				highestSeenAvailableIncomingBitrate = 0;
			}
		}
	}
	return {
		id: 'congestion-detector',
		get alert() {
			return alertState;
		},
		get congestedPeerConnectionIds() {
			return congestedPeerConnectionIds;
		},
		get highestSeenAvailableIncomingBitrate() {
			return highestSeenAvailableIncomingBitrate;
		},
		get highestSeenAvailableOutgoingBitrate() {
			return highestSeenAvailableOutgoingBitrate;
		},
		get highestSeenReceivingBitrate() {
			return highestSeenReceivingBitrate;
		},
		get highestSeenSendingBitrate() {
			return highestSeenSendingBitrate;
		},
		update,
	};
}