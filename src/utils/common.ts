
export function groupBy<T, K>(array: T[], getKey: (value: T) => K): Map<K, T[]> {
  return array.reduce((map, currentValue) => {
    const key = getKey(currentValue);
    const collection = map.get(key);
    if (!collection) {
      map.set(key, [currentValue]);
    } else {
      collection.push(currentValue);
    }
    return map;
  }, new Map<K, T[]>());
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function roundNumber(num?: number): number | undefined {
  if (num === undefined || num === null) return undefined;
  return Math.round(num);
}

export function calculateEmpiricalDeviation(data: number[]): number | undefined {
  if (data.length < 2) return undefined;

  // Step 1: Calculate the mean
  const mean = data.reduce((sum, value) => sum + value, 0) / data.length;

  // Step 2: Calculate the squared deviations from the mean
  const squaredDeviations = data.map(value => Math.pow(value - mean, 2));

  // Step 3: Calculate the variance (sum of squared deviations divided by n - 1)
  const variance = squaredDeviations.reduce((sum, value) => sum + value, 0) / (data.length - 1);

  // Step 4: Take the square root of the variance to get the standard deviation
  return Math.sqrt(variance);
}

export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type RequiredBy<T, K = keyof T> = Merge<
  T & {
    [P in keyof T as P extends K ? P : never]-?: T[P]
  }
>

type Merge<T> = {
	[P in keyof T]: T[P]
}


export const NULL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Difference between two readings of a monotonic counter, treating a backwards
 * step as "no progress": a counter that goes down means the underlying stats
 * object was reset (SSRC reuse, ICE restart, replaced track), and a negative
 * delta would poison every rate derived from it.
 */
/**
 * The increase of a monotonic counter between two samples, or `undefined` when
 * there is no increase to report.
 *
 * A counter going *backwards* is a reset — SSRC or pair-id reuse after
 * renegotiation, an adapter recomputing, stats arriving out of order — and a
 * reset is not an observation that nothing moved. Returning `0` there made the
 * two indistinguishable, and a zero delta is what several detectors treat as
 * proof of a stall.
 */
export function positiveDelta(current?: number, previous?: number): number | undefined {
	if (current === undefined || previous === undefined) return undefined;
	if (current < previous) return undefined;

	return current - previous;
}


/**
 * How long a gap between stats collections has to be before it means the ticks
 * themselves stopped rather than the thing being measured.
 *
 * Derived from the monitor's own cadence instead of configured, because a fixed
 * millisecond value means something different at every collecting period. The
 * floor keeps it sane when collection is externally driven (`collectingPeriodInMs: 0`,
 * as in a replay).
 */
export function maxTickGapInMs(collectingPeriodInMs: number): number {
	return Math.max(collectingPeriodInMs * 3, 15_000);
}

/**
 * The single RTP-to-transport attribution rule: streams attribute to a
 * transport by their explicit `transportId`; streams carrying none (older
 * browsers, exotic stacks) attribute to the transport only when it is the peer
 * connection's sole transport — exact under BUNDLE, and never counted twice
 * when a connection without BUNDLE has several transports.
 *
 * Every consumer that maps RTP streams onto a transport must go through this,
 * so two detectors can never disagree about which transport a stream belongs
 * to. `PeerConnectionMonitor.attributeRtpToTransport` is the bound
 * convenience over it.
 */
export function attributeRtpToTransport<T extends { transportId?: string }>(
	rtps: T[],
	transportId: string,
	transportCount: number,
): T[] {
	const attributed = rtps.filter((rtp) => rtp.transportId === transportId);

	if (0 < attributed.length) return attributed;

	return transportCount === 1
		? rtps.filter((rtp) => rtp.transportId === undefined)
		: [];
}
