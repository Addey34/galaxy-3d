/** Déclarations de `drift-compare.mjs`, pour `src/config/driftCompare.test.ts`. */
export const READ_DATE_KEYS: string[];
export function withoutReadDates(text: string): string;
export function sameIgnoringReadDates(
  shipped: string | null | undefined,
  fresh: string
): boolean;
