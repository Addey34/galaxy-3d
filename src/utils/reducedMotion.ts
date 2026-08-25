/**
 * Préférence système `prefers-reduced-motion`, consultée par tout ce qui anime la caméra ou
 * l'UI (morph éducatif↔explo, vols caméra, transitions CSS) — un seul point de vérité pour
 * décider entre animation et bascule instantanée.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}
