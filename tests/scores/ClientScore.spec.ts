/* eslint-disable @typescript-eslint/no-explicit-any */
import { DefaultScoreCalculator } from "../../src/scores/DefaultScoreCalculator";

const MAX = DefaultScoreCalculator.MAX_SCORE;

/**
 * The client score is a distance, so the honest way to pin it is over the vector of dimension
 * scores rather than through monitors that would have to be built to produce one. The end of the
 * file drives the whole path once, so the wiring from monitors to that vector is covered too.
 */
function clientScoreOf(scores: (number | undefined | null)[]): number | undefined {
	const calculator = new DefaultScoreCalculator({} as any);

	return (calculator as any)._clientScoreFrom(scores);
}

/** What the calculation says, worked out independently of the implementation. */
function expectedRmseScore(scores: number[]): number {
	const mse = scores.reduce((sum, score) => sum + ((MAX - score) ** 2), 0) / scores.length;

	return MAX - Math.sqrt(mse);
}

describe('the client score', () => {
	describe('is 5 minus the RMS distance from a perfect call', () => {
		// An even shortfall across every dimension is the one case where the distance and the
		// arithmetic mean agree, which is what makes these the right anchors for the scale.
		it.each([
			[ 'a perfect call', [ 5, 5, 5, 5, 5 ], 5 ],
			[ 'every dimension one point down', [ 4, 4, 4, 4, 4 ], 4 ],
			[ 'three dimensions two points down', [ 3, 3, 3 ], 3 ],
			[ 'nothing working at all', [ 0, 0, 0 ], 0 ],
		])('%s scores %p -> %p', (_name, scores, expected) => {
			expect(clientScoreOf(scores as number[])).toBe(expected);
		});

		// Uneven degradation is where a distance and a mean part company, and it parts company in
		// the direction a person would: one dead dimension is worse than the same total shortfall
		// spread thinly over three healthy-ish ones.
		it.each([
			[ [ 5, 5, 0 ], 2.113 ],
			[ [ 5, 5, 5, 5, 0 ], 2.764 ],
			[ [ 5, 4, 1 ], 2.619 ],
			[ [ 5, 1, 1 ], 1.734 ],
		])('%p scores about %p', (scores, expected) => {
			expect(clientScoreOf(scores)).toBeCloseTo(expected, 2);
			expect(clientScoreOf(scores)).toBeCloseTo(expectedRmseScore(scores), 2);
		});

		it('is never an average of the dimensions', () => {
			// The mean of [5, 5, 0] is 3.33, and reporting that for a call with one dead
			// dimension is the exact mistake the distance exists to avoid.
			expect(clientScoreOf([ 5, 5, 0 ])).toBeLessThan(10 / 3);
		});

		/**
		 * The same total shortfall, concentrated rather than spread. Both vectors are five points
		 * from perfect in sum, so an average cannot tell them apart at all; only a distance can.
		 */
		it('scores concentrated damage below evenly spread damage of the same size', () => {
			const spread = clientScoreOf([ 10 / 3, 10 / 3, 10 / 3 ]) as number;
			const concentrated = clientScoreOf([ 5, 5, 0 ]) as number;

			expect(spread).toBeCloseTo(10 / 3, 2);
			expect(concentrated).toBeLessThan(spread);
		});
	});

	describe('counts only the dimensions that exist', () => {
		it('drops undefined dimensions instead of scoring them zero', () => {
			expect(clientScoreOf([ 5, 4, undefined, 3, undefined ])).toBe(clientScoreOf([ 5, 4, 3 ]));
		});

		it('drops null dimensions the same way', () => {
			expect(clientScoreOf([ 5, null, 4, null, 3 ])).toBe(clientScoreOf([ 5, 4, 3 ]));
		});

		// The distinction that matters most: a call that carries no video is not a call whose
		// video has failed, and the two must not produce the same number.
		it('does not read an absent dimension as a broken one', () => {
			expect(clientScoreOf([ 5, 5, undefined ])).toBe(MAX);
			expect(clientScoreOf([ 5, 5, 0 ])).toBeLessThan(MAX);
		});

		it('scores a single available dimension as that dimension', () => {
			expect(clientScoreOf([ undefined, undefined, 3, undefined, undefined ])).toBe(3);
		});

		it('has no answer at all when nothing was measurable', () => {
			expect(clientScoreOf([ undefined, undefined, undefined, undefined, undefined ])).toBeUndefined();
			expect(clientScoreOf([])).toBeUndefined();
		});
	});

	describe('stays inside the 0..5 scale', () => {
		it.each([
			[ [ 5, 5, 5, 5, 5 ] ],
			[ [ 5, 5, 0 ] ],
			[ [ 0, 0, 0, 0, 0 ] ],
			[ [ 4, 0, 5, 1, 2 ] ],
		])('%p', (scores) => {
			const score = clientScoreOf(scores) as number;

			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(MAX);
		});
	});
});

/**
 * The wiring, driven once end to end: five dimension scores really are the peer connections'
 * stability score and the four direction-and-kind track groups, and nothing else.
 */
describe('the client score over its monitors', () => {
	function createTrack(
		direction: 'inbound' | 'outbound',
		kind: 'audio' | 'video',
		value?: number,
		weight = 1,
	) {
		return { direction, kind, calculatedScore: { value, weight } };
	}

	function createClient(stabilityScores: (number | undefined)[], tracks: any[]) {
		const peerConnections = stabilityScores.map((value) => ({
			calculatedStabilityScore: { value, weight: 1 },
			tracks,
		}));

		return {
			peerConnections,
			mappedPeerConnections: new Map(peerConnections.map((pc, i) => [ `pc-${i}`, pc ])),
			tracks,
			score: undefined as number | undefined,
			setScore(value: number) {
				this.score = value;
			},
		};
	}

	it('reads one dimension per direction and kind, plus the transport', () => {
		const client = createClient([ 5 ], [
			createTrack('inbound', 'audio', 4),
			createTrack('inbound', 'video', 0),
			createTrack('outbound', 'audio', 5),
			createTrack('outbound', 'video', 3),
		]);
		const calculator = new DefaultScoreCalculator(client as any);

		calculator._calculateClientMonitorScore();

		expect(client.score).toBeCloseTo(expectedRmseScore([ 5, 4, 0, 5, 3 ]), 2);
	});

	// Several tracks of one kind are one dimension, not several: the existing weighted mean
	// collapses them before the distance is taken.
	it('collapses several tracks of a kind into that one dimension', () => {
		const client = createClient([ 5 ], [
			createTrack('inbound', 'video', 5),
			createTrack('inbound', 'video', 1),
		]);
		const calculator = new DefaultScoreCalculator(client as any);

		calculator._calculateClientMonitorScore();

		expect(client.score).toBeCloseTo(expectedRmseScore([ 5, 3 ]), 2);
	});

	it('leaves a kind out entirely when this call carries none of it', () => {
		const client = createClient([ 5 ], [ createTrack('inbound', 'audio', 3) ]);
		const calculator = new DefaultScoreCalculator(client as any);

		calculator._calculateClientMonitorScore();

		// Transport 5 and inbound audio 3; the three kinds nobody is carrying are absent.
		expect(client.score).toBeCloseTo(expectedRmseScore([ 5, 3 ]), 2);
	});

	// A track still gathering collections has no score, and no score is not a bad one.
	it('leaves a track that cannot be judged yet out of its dimension', () => {
		const client = createClient([ 5 ], [
			createTrack('inbound', 'audio', undefined),
			createTrack('inbound', 'video', 2),
		]);
		const calculator = new DefaultScoreCalculator(client as any);

		calculator._calculateClientMonitorScore();

		expect(client.score).toBeCloseTo(expectedRmseScore([ 5, 2 ]), 2);
	});

	it('publishes nothing when no dimension can be judged', () => {
		const client = createClient([ undefined ], [ createTrack('inbound', 'audio', undefined) ]);
		const calculator = new DefaultScoreCalculator(client as any);

		calculator._calculateClientMonitorScore();

		expect(client.score).toBeUndefined();
	});
});
