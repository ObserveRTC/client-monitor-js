/**
 * The sample carries the reasons together with the points each one
 * subtracted (`Record<string, number>`), so a degraded score explains itself
 * on the wire, magnitudes included. Returns undefined when shipping is
 * disabled or there is nothing to explain. The returned object is a shallow
 * copy — the sample must not alias the live reasons object the score
 * calculator replaces on every tick.
 */
export function sampledScoreReasons(
	reasons: Record<string, number> | undefined,
	sendScoreReasonsToServer: boolean | undefined,
): Record<string, number> | undefined {
	if (sendScoreReasonsToServer === false) return undefined;
	if (!reasons) return undefined;
	if (Object.keys(reasons).length === 0) return undefined;

	return { ...reasons };
}
