import { EventEmitter } from "events";
import { ClientMonitorEvents } from "../ClientMonitor";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";
import { EvaluatorProcess } from "../Evaluators";

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
}

export function createCongestionDetector(emitter: EventEmitter, config: CongestionDetectorConfig): EvaluatorProcess {
	type PeerConnectionState = {
		measurements: { added: number, RttInMs: number }[],
		sum: number,
		sumSquares: number,
		congested?: number,
		visited: boolean,
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
		
		state.visited = true;
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
			state.congested = now;
			return true;
		}

		if (avgRttInS < 0) {
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
		if (config.minRTTDeviationThresholdInMs < deviation) {
			return false;
		}
		if (config.deviationFoldThreshold * stdDev < deviation) {
			state.congested = now;
			return true;
		}
		return false;
	}

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
			}).get(peerConnection.id)!;
			
			if (!isCongested(now, state, peerConnection)) {
				continue;
			}

			peerConnectionIds.push(peerConnection.id);
			trackIds.push(...Array.from(peerConnection.trackIds()));
		}

		if (0 < peerConnectionIds.length) {
			const event: ClientMonitorEvents['congestion-detected'] = {
				peerConnectionIds,
				trackIds,
			};
			emitter.emit('congestion-detected', event);
		}
	};
	return process;
}