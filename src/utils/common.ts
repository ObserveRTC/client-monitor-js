
export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function roundNumber(num?: number): number | undefined {
  if (num === undefined || num === null) return undefined;
  return Math.round(num);
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