export type CalculatedScore = {
	weight: number;
	value?: number;
	appData?: Record<string, unknown>;
	reasons?: Record<string, number>;
}

// every track calculates its own score and stores 
// the latest CalculatedScore in a score property also emits as an event 'score'
// every peer connection collects the scores and calculates its own score based on RTT, and stores it in the score property similar to track
// every client collects the scores and calculates its own score based on the peer connection scores, and stores it in the score property similar to track
// every call collects the scores and calculates its own score based on the client scores, and stores it in the score property similar to track, but
// but calls only recalculate it after a configured amount of time passed from the last recalculation, and it does not trigger automatically

/**
 * How much motion the content carries, which changes how visible a given
 * quantizer is. Nothing in the stats reveals it, so the application declares it
 * via `InboundTrackMonitor.setContext()` or `ClientMonitor.setInboundTrackContext()`;
 * undeclared, screen share is treated as `lowmotion` and everything else as
 * `standard`.
 */
export type VideoMotionType = 'lowmotion' | 'standard' | 'highmotion';

export function calculateLatencyMOS(
	{ avgJitter, rttInMs, packetsLoss }:
	{ avgJitter: number, rttInMs: number, packetsLoss: number },
): number {
	const effectiveLatency = rttInMs + (avgJitter * 2) + 10;
	let rFactor = effectiveLatency < 160
		? 93.2 - (effectiveLatency / 40)
		: 93.2 - (effectiveLatency / 120) - 10;

	rFactor -= (packetsLoss * 2.5);
	
	return 1 + ((0.035) * rFactor) + ((0.000007) * rFactor * (rFactor - 60) * (100 - rFactor));
}

export function getRttScore(x: number): number {
	// logarithmic version: 1.0 at 150 and 0.1 at 300
	return (-1.2984 * Math.log(x)) + 7.5059;

	// exponential version: 1.0 at 150 and 0.1 at 300
	// return Math.exp(-0.01536 * x);
}