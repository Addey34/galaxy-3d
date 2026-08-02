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
import { onLocaleChange, t } from '@/i18n';

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
): void {
  const modeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#mode-controls .mode-btn')
  );
  const scaleDisclaimer = document.getElementById('scale-disclaimer');
  const updateScaleDisclaimer = (mode: 'educ' | 'explo'): void => {
    if (!scaleDisclaimer) return;
    const key = mode === 'explo' ? 'mode.explo.scale' : 'mode.educ.scale';
    scaleDisclaimer.dataset['i18n'] = key;
    scaleDisclaimer.textContent = t(key);
  };

  onLocaleChange(() => {
    const active = modeBtns.find((button) =>
      button.classList.contains('is-active')
    );
    updateScaleDisclaimer(
      active?.dataset['mode'] === 'explo' ? 'explo' : 'educ'
    );
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('is-active')) return;
      const mode = btn.dataset['mode'] === 'explo' ? 'explo' : 'educ';
      const isExplo = mode === 'explo';
      modeBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      document.body.classList.toggle('is-explo-mode', isExplo);
      updateScaleDisclaimer(mode);

      // La caméra conserve son cadrage pendant que seules les positions et tailles morphent.
      camera.transitionScaleMode(mode);
      om.setMode(mode, !prefersReducedMotion());

      onModeChange?.(mode);
    });
  });
}
