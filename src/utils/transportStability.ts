import { clamp } from "./common";

/**
 * How good a path is for conversation, from the three things a transport can report about itself.
 *
 * This is ITU-T G.107's E-model, reduced to the impairments WebRTC stats actually carry. It exists
 * because round trip, jitter and loss are not independently meaningful to a listener: 3% loss on a
 * LAN and 3% loss across an ocean are different calls, and no single-stat threshold says so. The
 * model combines them on one scale that was fitted against human listening tests, which is a
 * stronger claim than any weighting we would invent.
 *
 * What it does **not** do is judge video. The E-model is a speech model, and its currency is
 * conversational quality — turn-taking, talk-over, intelligibility. A path good for speech may
 * still be carrying a blocky picture.
 */

/** The transmission rating R, mapped to a mean opinion score. */
const mosOfR = (r: number) => 1 + (0.035 * r) + (0.000007 * r * (r - 60) * (100 - r));

/**
 * The best R this model can produce, at an `effectiveLatency` of 10ms with no loss, and the score
 * it maps to — about `4.4`, which is the E-model's ceiling for narrowband speech and not `4.5`.
 *
 * `TRANSPORT_MOS_BEST` is what a flawless path scores, so it is what {@link transportStability}
 * normalises against. Normalising against `4.5` instead would leave a perfect LAN call carrying a
 * permanent penalty of about `0.03`.
 */
const R_BEST = 93.2 - (10 / 40);
export const TRANSPORT_MOS_BEST = mosOfR(R_BEST);
export const TRANSPORT_MOS_WORST = 1;

export type TransportQualityInput = {
	/** Round trip, not one-way: the model halves it. */
	rttInMs: number;
	/** Interval jitter as the receiver sees it. */
	jitterInMs: number;
	/** **Percent, not a fraction** — `2` is 2%. The E-model's loss term is scaled for percent. */
	packetLossPercent: number;
};

/**
 * The mean opinion score this path would earn for speech, `1` to about `4.4`.
 *
 * Every input is required on purpose. A missing round trip or a missing loss reading is a
 * measurement this cannot make, and defaulting it to zero would report an unmeasured path as a
 * clean one — so a caller without all three should publish nothing rather than call this.
 */
export function transportMos(
	{ rttInMs, jitterInMs, packetLossPercent }: TransportQualityInput,
): number {
	// The model's Ta is one-way mouth-to-ear delay: half the round trip, plus the de-jitter buffer
	// the receiver has to hold to absorb this much jitter, plus a nominal codec and packetisation
	// delay. Feeding it the round trip whole would double-count the return path.
	const effectiveLatencyInMs = (rttInMs / 2) + (jitterInMs * 2) + 10;

	// The two branches meet exactly at 160ms. Written as `(eff - 120) / 10` rather than
	// `(eff / 120) - 10`: the latter has the same digits, leaves a step of seven R points at the
	// boundary, and goes *flatter* above it than below, so latency stops costing where it starts
	// to matter.
	const rLatency = effectiveLatencyInMs < 160
		? 93.2 - (effectiveLatencyInMs / 40)
		: 93.2 - ((effectiveLatencyInMs - 120) / 10);

	// Clamped before the mapping, not after: R outside 0..100 sends the cubic back on itself, so
	// heavy loss would start *raising* the score again.
	const r = clamp(rLatency - (packetLossPercent * 2.5), 0, 100);

	return clamp(mosOfR(r), TRANSPORT_MOS_WORST, TRANSPORT_MOS_BEST);
}

/**
 * The same reading as `0..1`, where **`1` is a flawless path and `0` an unusable one**.
 *
 * The polarity is the way round the name reads — higher is better — which makes it the one value
 * in this file that is *not* a subtraction. Score code that wants a cost should take
 * `1 - transportStability(...)`.
 */
export function transportStability(input: TransportQualityInput): number {
	const mos = transportMos(input);

	return clamp(
		(mos - TRANSPORT_MOS_WORST) / (TRANSPORT_MOS_BEST - TRANSPORT_MOS_WORST),
		0,
		1,
	);
}
