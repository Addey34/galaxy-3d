/**
 * Barre de navigation entre corps (nav.controls).
 *
 * Les boutons de corps sont générés depuis le catalogue (`CELESTIAL_CONFIG`) : ajouter un
 * corps ne demande AUCUNE édition HTML. Seule la Vue Globale est statique dans le HTML.
 */
import { CELESTIAL_CONFIG } from '../config/settings';
import { forEachBody } from '../config/catalog';
import type { CameraSystem } from '../components/systems/CameraSystem';

// Accent doré dédié au Soleil (son orbitalColor vaut 0x000000, inutilisable ici).
const SUN_ACCENT = 0xffcc33;

/** Convertit une couleur hexadécimale (0xRRGGBB) en triplet CSS « r, g, b ». */
function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

/**
 * Génère un bouton de navigation par corps depuis le catalogue. Chaque bouton porte
 * `--planet-rgb` = couleur de son orbite (survol + état actif en CSS). Le Soleil reçoit un
 * accent doré (son orbitalColor est noir) ; la Vue Globale garde son accent CSS statique.
 */
function buildPlanetButtons(): void {
  const nav = document.querySelector<HTMLElement>('.controls');
  if (!nav) return;

  forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
    if (cfg.kind === 'skybox') return; // la skybox n'est pas navigable

    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const accent = cfg.kind === 'star' ? SUN_ACCENT : cfg.orbitalColor;

    const btn = document.createElement('button');
    btn.id = `orbit-${name}`;
    btn.className = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-label', label);
    btn.style.setProperty('--planet-rgb', hexToRgbTriplet(accent));
    nav.appendChild(btn);
  });
}

export function setupPlanetControls(camera: CameraSystem): void {
  buildPlanetButtons();
  const btns = document.querySelectorAll<HTMLButtonElement>('.controls button');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const bodyName = btn.id.replace('orbit-', '');
      if (bodyName === 'overview') {
        camera.goToOverview();
      } else {
        camera.setTarget(bodyName);
      }
    });
  });
}
