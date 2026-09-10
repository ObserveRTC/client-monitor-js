/* eslint-disable @typescript-eslint/no-explicit-any */
import { DefaultScoreCalculator } from "../../src/scores/DefaultScoreCalculator";
import { IssueRegistry } from "../../src/utils/IssueRegistry";
import { stubClientIssues } from "../helpers/detectorMocks";

/**
 * `reasons` is read as "what is wrong with this monitor right now" — in a dashboard, and in every
 * sample shipped to the server. Two ways it lied about that, both found in a captured call:
 *
 * - it was written only on collections that were bad enough, so a monitor that recovered kept the
 *   last bad collection's object attached and went on reporting a fault for the rest of the call;
 * - conditions that cost nothing were still listed, at `0`, which is indistinguishable from a
 *   detected fault that never resolved.
 *
 * A connection with no congestion at any point in an hour and fifty minutes was reporting
 * `uplink-congestion` and `downlink-congestion` on every one of 1966 collections because of them.
 */
function createPeerConnection() {
	return {
		issues: new IssueRegistry(stubClientIssues().asSink),
		calculatedStabilityScore: { weight: 1 } as any,
		tracks: [],
		uplinkVideoCongestionSeverity: undefined as number | undefined,
		downlinkVideoCongestionSeverity: undefined as number | undefined,
		avgInboundFractionLost: undefined as number | undefined,
		avgOutboundFractionLost: undefined as number | undefined,
		avgInboundJitterInMs: undefined as number | undefined,
	};
}

function setup() {
	const pcMonitor = createPeerConnection();
	const client = {
		peerConnections: [ pcMonitor ],
		mappedPeerConnections: new Map([ [ 'pc-1', pcMonitor ] ]),
		tracks: [],
		setScore() { /* the client score is not what this file is about */ },
	};
	const calculator = new DefaultScoreCalculator(client as any);

	return { pcMonitor, calculator, update: () => calculator.update() };
}

describe('score reasons', () => {
	it('lists nothing on a connection with nothing wrong', () => {
		const { pcMonitor, update } = setup();

		update();

		expect(pcMonitor.calculatedStabilityScore.reasons).toBeUndefined();
	});

	// The exact phantom from the capture: no congestion in the whole call, both keys reported on
	// every collection because the severity was written whether or not there was any.
	it('does not list a condition that cost nothing', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.avgInboundFractionLost = 0.1;
		update();

		expect(Object.keys(pcMonitor.calculatedStabilityScore.reasons ?? {})).toEqual([
			'transport-loss-sustained',
		]);
	});

	// The staleness: reasons written on a bad collection and left attached through the good ones.
	it('clears the reasons once the connection recovers', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.downlinkVideoCongestionSeverity = 0.5;
		update();
		expect(pcMonitor.calculatedStabilityScore.reasons).toHaveProperty('downlink-congestion');

		pcMonitor.downlinkVideoCongestionSeverity = 0;
		update();

		expect(pcMonitor.calculatedStabilityScore.reasons).toBeUndefined();
	});

	/**
	 * The rule stated directly: each collection starts from an empty list and only what is wrong
	 * *now* goes into it. A fault that has been replaced by a different one must not leave its own
	 * key behind alongside the new one.
	 */
	it('replaces the previous collection\'s reasons rather than adding to them', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.downlinkVideoCongestionSeverity = 0.4;
		update();
		expect(Object.keys(pcMonitor.calculatedStabilityScore.reasons ?? {})).toEqual([
			'downlink-congestion',
		]);

		pcMonitor.downlinkVideoCongestionSeverity = 0;
		pcMonitor.avgInboundFractionLost = 0.2;
		update();

		expect(Object.keys(pcMonitor.calculatedStabilityScore.reasons ?? {})).toEqual([
			'transport-loss-sustained',
		]);
	});

	// The aggregate the client score publishes is rebuilt each tick from the same rule, so a
	// reason that has gone cannot survive in it either.
	it('rebuilds the aggregated reasons from scratch on every collection', () => {
		const { pcMonitor, calculator, update } = setup();

		pcMonitor.downlinkVideoCongestionSeverity = 0.4;
		update();
		expect(Object.keys(calculator.currentReasons)).toEqual([ 'downlink-congestion' ]);

		pcMonitor.downlinkVideoCongestionSeverity = 0;
		update();

		expect(Object.keys(calculator.currentReasons)).toEqual([]);
	});

	/**
	 * The case that made the staleness invisible in testing: a shallow fault costs less than a
	 * point, so the old guard never rewrote the reasons at all and whatever was there stayed.
	 */
	it('clears them even when neither the fault nor the recovery moved the score by a point', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.avgInboundFractionLost = 0.16;
		update();
		expect(pcMonitor.calculatedStabilityScore.value).toBeGreaterThan(
			DefaultScoreCalculator.MAX_SCORE - 1,
		);
		expect(pcMonitor.calculatedStabilityScore.reasons).toHaveProperty('transport-loss-sustained');

		pcMonitor.avgInboundFractionLost = 0;
		update();

		expect(pcMonitor.calculatedStabilityScore.reasons).toBeUndefined();
	});
});
