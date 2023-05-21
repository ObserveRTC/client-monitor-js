import { EventEmitter } from "events";
import { ClientMonitorEvents } from "../ClientMonitor";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";
import { EvaluatorProcess } from "../Evaluators";

/**
 * Configuration object for the CongestionDetector function.
 */
export type CongestionDetectorConfig = {
	/**
	 * Specifies whether the congestion detector is enabled or not.
	 */
	enabled: boolean;
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
	 * The minimum number of consecutive ticks required to consider a connection as congested. 
	 * A tick represents a deviation above the deviation fold threshold.
 	*/
	minConsecutiveTickThreshold: number;

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
}

export function createCongestionDetector(emitter: EventEmitter, config: CongestionDetectorConfig): EvaluatorProcess {
	if (!config.enabled) {
		return async () => {

		};
	}
	type PeerConnectionState = {
		measurements: { added: number, RttInMs: number }[],
		sum: number,
		sumSquares: number,
		congested?: number,
		visited: boolean,
		ticks: number,
	}
	
	const peerConnectionStates = new Map<string, PeerConnectionState>();
	const isCongested = (now: number, state: PeerConnectionState, peerConnection: PeerConnectionEntry): boolean => {
		const {
			totalInboundPacketsLost,
			totalInboundPacketsReceived,
			avgRttInS,
			totalOutboundPacketsSent,
			totalOutboundPacketsLost,
		} = peerConnection.updates;
		
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

	const process: EvaluatorProcess = async (context) => {
		const { storage } = context;
		const now = Date.now();
		const peerConnectionIds: string[] = [];
		const trackIds: string[] = [];
		for (const peerConnection of storage.peerConnections()) {
			const state = peerConnectionStates.get(peerConnection.id) ?? peerConnectionStates.set(peerConnection.id, {
				measurements: [],
				sum: 0,
				sumSquares: 0,
				visited: false,
				ticks: 0,
			}).get(peerConnection.id)!;
			
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
				peerConnectionIds.push(peerConnection.id);
				trackIds.push(...Array.from(peerConnection.trackIds()));
				continue;
			}
			if (wasCongested && !congested) {
				state.congested = undefined;
				continue;
			}

			// it was not congested, and has not become congested
			highestSeenSendingBitrate = Math.max(
				highestSeenSendingBitrate, 
				storage.updates.sendingAuidoBitrate + storage.updates.sendingVideoBitrate
			);
			highestSeenReceivingBitrate = Math.max(
				highestSeenReceivingBitrate, 
				storage.updates.receivingAudioBitrate + storage.updates.receivingVideoBitrate
			);
			highestSeenAvailableOutgoingBitrate = Math.max(
				highestSeenAvailableOutgoingBitrate, 
				storage.updates.totalAvailableOutgoingBitrate
			);
			highestSeenAvailableIncomingBitrate = Math.max(
				highestSeenAvailableIncomingBitrate, 
				storage.updates.totalAvailableIncomingBitrate
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

		if (0 < peerConnectionIds.length) {
			const event: ClientMonitorEvents['congestion-detected'] = {
				peerConnectionIds,
				trackIds,
				highestSeenSendingBitrate,
				highestSeenReceivingBitrate,
				highestSeenAvailableOutgoingBitrate,
				highestSeenAvailableIncomingBitrate,
			};
			emitter.emit('congestion-detected', event);
			highestSeenSendingBitrate = 0;
			highestSeenReceivingBitrate = 0;
			highestSeenAvailableOutgoingBitrate = 0;
			highestSeenAvailableIncomingBitrate = 0;
		}
	};
	return process;
}