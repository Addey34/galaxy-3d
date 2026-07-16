/**
 * Bascule de mode Éducatif ↔ Exploration (#mode-controls .mode-btn).
 *
 * Change l'échelle (OrbitalMechanics + CameraSystem) et réinitialise la sélection de corps :
 * Terre en Explo (repère naturel), Vue Globale en Éducatif. Le bouton Explo est actif et
 * déclenche aussi le HUD « Voyage spatial » via le callback `onModeChange`.
 */
import type { OrbitalMechanics } from '../core/OrbitalMechanics';
import type { CameraSystem } from '../components/systems/CameraSystem';

export function setupModeSwitcher(
  om: OrbitalMechanics,
  camera: CameraSystem,
  onModeChange?: (mode: 'educ' | 'explo') => void
): void {
  const modeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#mode-controls .mode-btn')
  );
  const planetBtns = document.querySelectorAll<HTMLButtonElement>('.controls button');
  const overviewBtn = document.getElementById('orbit-overview');
  const earthBtn    = document.getElementById('orbit-earth');

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('is-active')) return;
      const mode = btn.dataset['mode'] === 'explo' ? 'explo' : 'educ';
      const isExplo = mode === 'explo';
      modeBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      document.body.classList.toggle('is-explo-mode', isExplo);
      om.setMode(mode);
      camera.setScaleMode(mode);
      onModeChange?.(mode);

      planetBtns.forEach((b) => b.classList.remove('is-active'));
      if (isExplo) {
        earthBtn?.classList.add('is-active');
      } else {
        overviewBtn?.classList.add('is-active');
      }
    });
  });
}
