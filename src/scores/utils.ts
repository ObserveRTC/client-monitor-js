/**
 * The sample carries the reason *keys* only — the penalty magnitudes stay
 * local (readable on the monitors and the 'score' event). Returns undefined
 * when shipping is disabled or there is nothing to explain.
 */
export function scoreReasonKeys(
	reasons: Record<string, number> | undefined,
	sendScoreReasonsToServer: boolean | undefined,
): string[] | undefined {
	if (sendScoreReasonsToServer === false) return undefined;
	if (!reasons) return undefined;

	const keys = Object.keys(reasons);

	return 0 < keys.length ? keys : undefined;
}
