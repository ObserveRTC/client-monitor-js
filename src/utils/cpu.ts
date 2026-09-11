/**
 * Markers of an implementation that does its work off the CPU, matched case-insensitively as
 * substrings of `encoderImplementation` / `decoderImplementation`.
 *
 * `accelerator` is the broad one and carries most of the weight: every hardware path Chromium
 * exposes is named for the accelerator behind it — `MediaFoundationVideoEncodeAccelerator`,
 * `VaapiVideoDecodeAccelerator`, `V4L2VideoEncodeAccelerator`, and so on. The rest catch vendor
 * and platform names that do not follow that convention, plus Chromium's older generic
 * `ExternalEncoder` / `ExternalDecoder`.
 *
 * These strings are free-form and vendor-specific, so this list is a blocklist rather than proof:
 * an unrecognised hardware implementation still counts as CPU work. `powerEfficient*` is checked
 * alongside it to cover what the names miss.
 */
export const OFF_CPU_IMPLEMENTATION_MARKERS = [
	'accelerator',
	'external',
	'hardware',
	'mediacodec',
	'mediafoundation',
	'videotoolbox',
	'vaapi',
	'nvenc',
	'nvdec',
	'quicksync',
	'omx',
];

/**
 * Whether this stream's codec work lands somewhere other than the CPU, and so says nothing about
 * CPU performance. Two independent tests, either of which is enough: the implementation name, and
 * the browser's own power-efficiency hint.
 *
 * A stream that reports neither is treated as CPU work. That is the deliberate direction to fail
 * in — an unknown implementation keeps contributing evidence, where the opposite default would
 * silence the detector on every browser whose naming we have not catalogued.
 *
 * It lives here rather than beside the detector that thresholds on it because it is applied where
 * the numbers are taken: `PeerConnectionMonitor` leaves an off-CPU stream out of the collection's
 * codec-time delta, since what a stream contributes has to be decided at the moment the value is
 * taken, not when a slice is read back.
 */
export function runsOffCpu(implementation?: string, powerEfficient?: boolean): boolean {
	if (powerEfficient === true) return true;
	if (implementation === undefined) return false;

	const name = implementation.toLowerCase();

	return OFF_CPU_IMPLEMENTATION_MARKERS.some((marker) => name.includes(marker));
}
