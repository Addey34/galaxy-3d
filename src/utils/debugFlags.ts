/**
 * Drapeaux de débogage activés par la query string (`?debug-earth`, `?debug-meteo`…).
 *
 * Centralise le test `URLSearchParams(location.search).has(flag)` qui était répété tel quel
 * dans plusieurs modules UI. Tolère l'absence de `window` (SSR/tests) → `false`.
 */
export function hasDebugFlag(flag: string): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has(flag);
}
