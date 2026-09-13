/**
 * The top of each codec's quantizer scale, keyed by the subtype of the codec's `mimeType`.
 *
 * `qpSum` is reported in the codec's own units and those units are not comparable: a mean quantizer
 * of 40 is severe H.264 and unremarkable VP9. Without the codec the number cannot be read at all,
 * which is why an unrecognised `mimeType` yields no reading rather than a guess.
 */
export const QP_SCALE_BY_CODEC: Readonly<Record<string, number>> = {
	vp8: 127,
	vp9: 255,
	av1: 255,
	h264: 51,
	h265: 51,
	hevc: 51,
};

/**
 * The quantizer scale of the codec a `mimeType` names, or `undefined` for one whose scale is not
 * known.
 *
 * `video/VP8`, `video/H264`, ... — the subtype is the codec, normalised so that spellings like
 * `H.264` and `HEVC` land on the same key as the table uses.
 */
export function qpScaleOf(mimeType?: string): number | undefined {
	const codec = mimeType?.split('/')[1]?.toLowerCase().replace(/[^a-z0-9]/g, '');

	return codec === undefined ? undefined : QP_SCALE_BY_CODEC[codec];
}
