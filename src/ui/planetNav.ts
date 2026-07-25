/**
 * Barre de navigation entre corps (nav.controls).
 *
 * Les boutons de corps sont générés depuis le catalogue (`CELESTIAL_CONFIG`) : ajouter un
 * corps ne demande AUCUNE édition HTML. Seule la Vue Globale est statique dans le HTML.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { SMALL_BODY_KINDS } from '@/types';
import { bodyDisplayName } from '@/i18n/bodyText';
import { onLocaleChange, t } from '@/i18n';
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
  // Les boutons vivent dans la piste défilable, pas dans le conteneur (qui porte
  // aussi les flèches et la poignée de repli).
  const nav = document.querySelector<HTMLElement>('.controls-track');
  if (!nav) return;

  forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
    if (cfg.kind === 'skybox') return; // la skybox n'est pas navigable
    // Les petits corps sans texture (astéroïdes, comètes, planètes naines sans mesh) restent
    // hors de la barre — ils se naviguent via leurs labels Explo. Exception : les corps à
    // vraie taille significative ET dotés d'une texture surface (ex. Pluton, Cérès une fois
    // leur texture ajoutée) obtiennent un bouton comme une planète ordinaire.
    if (SMALL_BODY_KINDS.has(cfg.kind) && !cfg.textures.surface) return;

    const label = bodyDisplayName(name);
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

/** Ré-étiquette les boutons de corps dans la langue courante (nom d'affichage localisé). */
function relabelPlanetButtons(): void {
  document
    // La Vue Globale (#orbit-overview) est statique et gérée par applyStaticI18n (data-i18n) :
    // on ne ré-étiquette que les boutons de corps générés depuis le catalogue.
    .querySelectorAll<HTMLButtonElement>(
      '.controls-track button[id^="orbit-"]:not(#orbit-overview)'
    )
    .forEach((btn) => {
      const name = btn.id.replace('orbit-', '');
      const label = bodyDisplayName(name);
      btn.textContent = label;
      btn.setAttribute('aria-label', label);
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

/**
 * Câble le chrome de la barre : molette verticale → défilement horizontal de la piste,
 * flèches gauche/droite (masquées quand leur côté ne peut plus défiler), et poignée
 * tiroir qui replie la barre vers le haut de la page.
 */
function setupNavChrome(): void {
  const nav = document.querySelector<HTMLElement>('.controls');
  const track = document.querySelector<HTMLElement>('.controls-track');
  if (!nav || !track) return;

  // Molette : le geste vertical naturel défile la piste horizontalement (sans Shift).
  track.addEventListener(
    'wheel',
    (e) => {
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault(); // passive: false requis — on remplace le scroll de page par le nôtre
      track.scrollLeft += delta;
    },
    { passive: false }
  );

  // Flèches : défilement d'environ un « écran » de piste par clic, en douceur.
  const leftArrow = nav.querySelector<HTMLButtonElement>('.nav-arrow--left');
  const rightArrow = nav.querySelector<HTMLButtonElement>('.nav-arrow--right');
  const scrollByPage = (dir: -1 | 1): void =>
    track.scrollBy({
      left: dir * track.clientWidth * 0.65,
      behavior: 'smooth',
    });
  leftArrow?.addEventListener('click', () => scrollByPage(-1));
  rightArrow?.addEventListener('click', () => scrollByPage(1));

  // Chaque flèche disparaît quand son côté est en butée (ou si rien ne déborde).
  const syncArrows = (): void => {
    const overflow = track.scrollWidth - track.clientWidth;
    leftArrow?.classList.toggle('is-hidden', track.scrollLeft <= 1);
    rightArrow?.classList.toggle('is-hidden', track.scrollLeft >= overflow - 1);
  };
  track.addEventListener('scroll', syncArrows, { passive: true });
  window.addEventListener('resize', syncArrows);
  // Largeur des boutons dépendante de la langue → resynchronise après re-étiquetage.
  onLocaleChange(() => requestAnimationFrame(syncArrows));
  requestAnimationFrame(syncArrows);

  // Poignée tiroir : replie/déplie la barre (mode casier collé en haut de page).
  const collapseBtn =
    nav.querySelector<HTMLButtonElement>('.controls-collapse');
  if (collapseBtn) {
    let collapsed = false;
    const applyCollapsed = (): void => {
      nav.classList.toggle('is-collapsed', collapsed);
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
      collapseBtn.setAttribute(
        'aria-label',
        collapsed ? t('nav.expand') : t('nav.collapse')
      );
    };
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      applyCollapsed();
      if (!collapsed) requestAnimationFrame(syncArrows);
    });
    onLocaleChange(applyCollapsed);
    applyCollapsed();
  }
}

export function setupPlanetControls(
  camera: CameraSystem,
  onSelect?: (name: string) => void
): PlanetNavigation {
  buildPlanetButtons();
  setupNavChrome();
  onLocaleChange(relabelPlanetButtons);
  const btns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.controls-track button')
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
