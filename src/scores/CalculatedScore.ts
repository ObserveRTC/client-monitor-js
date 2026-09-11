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
