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
 *
 * The fix to the first is that `reasons` is *assigned* on every collection, never only on the bad
 * ones — which is what these tests pin. It is not that every charge is published: a continuous
 * charge is only listed once the collection's charges come to more than a point, so the fixtures
 * below are sized to clear that floor. An open finding publishes whatever it charged regardless.
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

		pcMonitor.downlinkVideoCongestionSeverity = 0.6;
		update();

		// Uplink and jitter cost nothing this collection, so neither is listed beside it.
		expect(Object.keys(pcMonitor.calculatedStabilityScore.reasons ?? {})).toEqual([
			'downlink-congestion',
		]);
	});

	// The staleness: reasons written on a bad collection and left attached through the good ones.
	it('clears the reasons once the connection recovers', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.downlinkVideoCongestionSeverity = 0.6;
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

		pcMonitor.downlinkVideoCongestionSeverity = 0.6;
		update();
		expect(Object.keys(pcMonitor.calculatedStabilityScore.reasons ?? {})).toEqual([
			'downlink-congestion',
		]);

		pcMonitor.downlinkVideoCongestionSeverity = 0;
		pcMonitor.uplinkVideoCongestionSeverity = 0.6;
		update();

		expect(Object.keys(pcMonitor.calculatedStabilityScore.reasons ?? {})).toEqual([
			'uplink-congestion',
		]);
	});

	// The aggregate the client score publishes is rebuilt each tick from the same rule, so a
	// reason that has gone cannot survive in it either.
	it('rebuilds the aggregated reasons from scratch on every collection', () => {
		const { pcMonitor, calculator, update } = setup();

		pcMonitor.downlinkVideoCongestionSeverity = 0.6;
		update();
		expect(Object.keys(calculator.currentReasons)).toEqual([ 'downlink-congestion' ]);

		pcMonitor.downlinkVideoCongestionSeverity = 0;
		update();

		expect(Object.keys(calculator.currentReasons)).toEqual([]);
	});

	/**
	 * The floor, stated directly: a charge that did not move the score by a point is real enough
	 * to subtract but not to report, so it does not fill `reasons` with readings nobody would act
	 * on. The score still carries it — the two are deliberately not the same question.
	 */
	it('does not list a continuous charge that cost less than a point', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.avgInboundFractionLost = 0.16;
		update();

		expect(pcMonitor.calculatedStabilityScore.value).toBeLessThan(
			DefaultScoreCalculator.MAX_SCORE,
		);
		expect(pcMonitor.calculatedStabilityScore.reasons).toBeUndefined();
	});

	/**
	 * The floor applies to the continuous charges only. A detector that raised has made a claim,
	 * and an empty reason list beside an open finding would contradict it — so once anything is
	 * raised, everything charged this collection is published however small.
	 */
	it('lists a sub-point charge anyway once a detector has raised', () => {
		const { pcMonitor, update } = setup();

		pcMonitor.avgInboundFractionLost = 0.16;
		pcMonitor.issues.raise({
			key: 'transport-loss-sustained-pc-1',
			type: 'transport-loss-sustained',
			payload: {},
		} as any);
		update();

		expect(pcMonitor.calculatedStabilityScore.reasons)
			.toHaveProperty('transport-loss-sustained');
	});
});
