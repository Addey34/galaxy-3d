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

/**
 * Vrai dès qu'un paramètre `debug-…` est présent, quel qu'il soit. Sert à décider s'il faut
 * charger le morceau des sondes de débogage (`ui/debugProbes`) : chaque sonde vérifie ensuite
 * SON drapeau, donc aucune liste de drapeaux n'a à être recopiée ici.
 */
export function hasAnyDebugFlag(): boolean {
  if (typeof window === 'undefined') return false;
  return [...new URLSearchParams(window.location.search).keys()].some((key) =>
    key.startsWith('debug-')
  );
}
