/**
 * Bascule de mode Éducatif ↔ Exploration (#mode-controls .mode-btn).
 *
 * Lance la transition animée des positions et tailles entre les deux échelles. Le cadrage de la
 * caméra reste inchangé pendant le morph ; la sélection est conservée, mais le suivi automatique
 * est suspendu jusqu'à une nouvelle sélection. Respecte prefers-reduced-motion : bascule
 * instantanée si l'utilisateur le demande.
 * Le bouton Explo actif déclenche aussi le HUD « Voyage spatial » via `onModeChange`.
 */
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { CameraSystem } from '@/components/systems/CameraSystem';

export interface ModeSwitcher {
  setMode(mode: 'educ' | 'explo'): void;
  getMode(): 'educ' | 'explo';
}

/** L'utilisateur préfère-t-il un mouvement réduit ? (bascule instantanée, sans morph). */
function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

export function setupModeSwitcher(
  om: OrbitalMechanics,
  camera: CameraSystem,
  onModeChange?: (mode: 'educ' | 'explo') => void
): ModeSwitcher {
  const modeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#mode-controls .mode-btn')
  );
  modeBtns.forEach((btn) =>
    btn.setAttribute(
      'aria-pressed',
      String(btn.classList.contains('is-active'))
    )
  );
  const setMode = (mode: 'educ' | 'explo'): void => {
    const btn = modeBtns.find(
      (candidate) => candidate.dataset['mode'] === mode
    );
    if (!btn || btn.disabled || btn.classList.contains('is-active')) return;
    const isExplo = mode === 'explo';
    modeBtns.forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    document.body.classList.toggle('is-explo-mode', isExplo);
    camera.transitionScaleMode(mode);
    om.setMode(mode, !prefersReducedMotion());
    onModeChange?.(mode);
  };
  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('is-active')) return;
      const mode = btn.dataset['mode'] === 'explo' ? 'explo' : 'educ';
      const isExplo = mode === 'explo';
      modeBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      document.body.classList.toggle('is-explo-mode', isExplo);

      // La caméra conserve son cadrage pendant que seules les positions et tailles morphent.
      camera.transitionScaleMode(mode);
      om.setMode(mode, !prefersReducedMotion());

      onModeChange?.(mode);
    });
  });
  return {
    setMode,
    getMode: () =>
      modeBtns.find((btn) => btn.classList.contains('is-active'))?.dataset[
        'mode'
      ] === 'explo'
        ? 'explo'
        : 'educ',
  };
}
