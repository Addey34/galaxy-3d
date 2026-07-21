/**
 * Barre de navigation entre corps (nav.controls).
 *
 * Les boutons de corps sont générés depuis le catalogue (`CELESTIAL_CONFIG`) : ajouter un
 * corps ne demande AUCUNE édition HTML. Seule la Vue Globale est statique dans le HTML.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { SMALL_BODY_KINDS } from '@/types';
import type { CameraSystem } from '@/components/systems/CameraSystem';

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
    // Les petits corps (astéroïdes, comètes, planètes naines) restent hors de la barre —
    // ils seraient trop nombreux à terme. Ils se naviguent via leurs labels Explo cliquables.
    if (SMALL_BODY_KINDS.has(cfg.kind)) return;

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

/**
 * Commande de navigation partagée entre la barre de boutons et les labels projetés du
 * mode Exploration : un seul point d'entrée pour cibler un corps.
 */
export interface PlanetNavigation {
  /**
   * Cible un corps (ou la « Vue Globale » via `'overview'`) : lance le vol caméra et, si le
   * corps a un bouton dans la barre, le marque actif. Fonctionne aussi pour les corps sans
   * bouton (petits corps naviguables uniquement par leur label Explo) ; la barre n'affiche
   * alors aucun bouton actif. `CameraSystem.setTarget` ignore les noms inconnus.
   */
  selectBody(name: string): void;
}

export function setupPlanetControls(
  camera: CameraSystem,
  onSelect?: (name: string) => void
): PlanetNavigation {
  buildPlanetButtons();
  const btns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.controls button')
  );

  const selectBody = (name: string): void => {
    const id = `orbit-${name}`;
    // Synchronise l'état actif : le bouton du corps s'il existe, sinon aucun (petit corps).
    btns.forEach((b) => b.classList.toggle('is-active', b.id === id));
    if (name === 'overview') {
      camera.goToOverview();
    } else {
      camera.setTarget(name);
    }
    // Notifie les observateurs (fiche d'info…) — un seul point pour toutes les sources
    // de sélection, puisque barre, picker 3D et labels Explo passent tous par ici.
    onSelect?.(name);
  };

  btns.forEach((btn) => {
    btn.addEventListener('click', () =>
      selectBody(btn.id.replace('orbit-', ''))
    );
  });

  return { selectBody };
}
