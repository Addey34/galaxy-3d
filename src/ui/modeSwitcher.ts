/**
 * Bascule de mode Éducatif ↔ Exploration (#mode-controls .mode-btn).
 *
 * Lance la transition animée « dolly zoom » : positions et tailles se déploient de l'échelle
 * compressée vers la vraie échelle (ou l'inverse) tandis que la caméra recule et recentre sur
 * le Soleil, puis revient au corps sélectionné (la sélection est conservée à travers la
 * bascule). Respecte `prefers-reduced-motion` : bascule instantanée si l'utilisateur le demande.
 * Le bouton Explo actif déclenche aussi le HUD « Voyage spatial » via `onModeChange`.
 */
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { CameraSystem } from '@/components/systems/CameraSystem';

/** L'utilisateur préfère-t-il un mouvement réduit ? (bascule instantanée, sans morph). */
function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

/** Corps actuellement sélectionné dans la barre de navigation, ou null (Vue Globale). */
function selectedBody(): string | null {
  const active = document.querySelector<HTMLButtonElement>(
    '.controls button.is-active'
  );
  if (!active || active.id === 'orbit-overview') return null;
  return active.id.replace('orbit-', '') || null;
}

export function setupModeSwitcher(
  om: OrbitalMechanics,
  camera: CameraSystem,
  onModeChange?: (mode: 'educ' | 'explo') => void
): void {
  const modeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#mode-controls .mode-btn')
  );

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('is-active')) return;
      const mode = btn.dataset['mode'] === 'explo' ? 'explo' : 'educ';
      const isExplo = mode === 'explo';
      modeBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      document.body.classList.toggle('is-explo-mode', isExplo);

      // Sélection conservée : la caméra recule vers la vue d'ensemble (recentrée Soleil)
      // pendant la transition, puis revient au corps suivi une fois le recul terminé.
      // Seul le morph de positions/tailles est gouverné par prefers-reduced-motion (mouvement
      // nouveau) ; le vol caméra, lui, existait déjà et reste identique dans les deux cas.
      const follow = selectedBody();
      camera.transitionScaleMode(mode, follow);
      om.setMode(mode, !prefersReducedMotion());

      onModeChange?.(mode);
    });
  });
}
