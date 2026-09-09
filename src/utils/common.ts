
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

  const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
  const squaredDeviations = data.map(value => Math.pow(value - mean, 2));
  const variance = squaredDeviations.reduce((sum, value) => sum + value, 0) / (data.length - 1);

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
 * The increase of a monotonic counter between two samples, or `undefined` when there is
 * none. A counter going backwards is a reset (SSRC reuse, renegotiation, out-of-order
 * stats), not an observation that nothing moved — detectors read a zero delta as a stall.
 */
export function positiveDelta(current?: number, previous?: number): number | undefined {
	if (current === undefined || previous === undefined) return undefined;
	if (current < previous) return undefined;

	return current - previous;
}

export function accumulatedValue(current?: number, value?: number): number | undefined {
  if (current === undefined) return value;
  if (value === undefined) return current;

  return current + value;
}

