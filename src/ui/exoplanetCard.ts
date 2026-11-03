/**
 * LA FICHE D'UN SYSTÈME D'EXOPLANÈTES, ouverte par un clic sur un repère du ciel ou par la
 * recherche d'un nom (le chemin au clavier : un clic de souris n'est pas une interface).
 *
 * Chargée à la demande, à la première activation de la couche : elle n'existe pas au démarrage.
 * Elle ne dessine aucune planète et ne déplace pas la caméra ; elle LIT le fichier daté de la NASA
 * (`core/exoplanets.ts`) et dit ce qu'il contient, sans rien inventer pour une valeur absente.
 * Une surface contextuelle parmi les autres : le coordinateur en garde une seule ouverte, et
 * Échap la ferme en rendant le focus à ce qui l'a ouverte.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import {
  LIGHT_YEARS_PER_PARSEC,
  UNKNOWN_DISTANCE_PC,
  type ExoplanetRow,
  type ExoplanetSystem,
} from '@/core/exoplanets';
import { angularToleranceRad, searchNames } from '@/core/skyPick';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { getAnnouncer } from './announcer';
import type { OverlayCoordinator } from './overlayCoordinator';
import { syncSurfaceFocus } from './surfaceFocus';

/** Rayon de capture d'un clic, en pixels : un anneau de 9 px se vise du doigt sans le manquer. */
const PICK_RADIUS_PX = 14;
/** Déplacement max entre pointerdown et pointerup pour rester un clic (sinon, glisser-pivoter). */
const CLICK_MOVE_TOLERANCE = 5;
const MAX_SUGGESTIONS = 12;

/** Méthodes de découverte de l'archive : la clé de phrase de chacune ; une inconnue reste en l'état. */
export const METHOD_KEYS: Readonly<Record<string, string>> = {
  Transit: 'exo.method.transit',
  'Radial Velocity': 'exo.method.radialVelocity',
  Imaging: 'exo.method.imaging',
  Microlensing: 'exo.method.microlensing',
  'Transit Timing Variations': 'exo.method.transitTiming',
  'Eclipse Timing Variations': 'exo.method.eclipseTiming',
  'Orbital Brightness Modulation': 'exo.method.orbitalBrightness',
  'Pulsar Timing': 'exo.method.pulsarTiming',
  'Pulsation Timing Variations': 'exo.method.pulsationTiming',
  Astrometry: 'exo.method.astrometry',
  'Disk Kinematics': 'exo.method.diskKinematics',
};

export interface ExoplanetCard {
  /** La couche est allumée ou éteinte : les clics, la recherche et la fiche suivent. */
  setActive(on: boolean): void;
  open(system: ExoplanetSystem): void;
  close(): void;
}

interface Options {
  starfield: Starfield;
  camera: PerspectiveCamera;
  canvas: HTMLElement;
  coordinator: OverlayCoordinator;
}

function number(value: number, digits = 3): string {
  return new Intl.NumberFormat(getLocale(), {
    maximumSignificantDigits: digits,
  }).format(value);
}

function fact(label: string, value: string): HTMLElement[] {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  return [dt, dd];
}

function planetItem(row: ExoplanetRow): HTMLElement {
  const [name, period, radius, axis, year, method] = row;
  const unknown = t('exo.card.unknown');
  const item = document.createElement('li');
  item.className = 'exo-planet';
  const title = document.createElement('h3');
  title.className = 'exo-planet-name';
  title.textContent = name;
  const list = document.createElement('dl');
  list.className = 'exo-facts';
  list.append(
    ...fact(
      t('exo.card.period'),
      period === null ? unknown : t('exo.unit.days', { v: number(period) })
    ),
    ...fact(
      t('exo.card.radius'),
      radius === null
        ? unknown
        : t('exo.unit.earthRadii', { v: number(radius) })
    ),
    ...fact(
      t('exo.card.axis'),
      axis === null ? unknown : t('exo.unit.au', { v: number(axis) })
    ),
    ...fact(t('exo.card.year'), year === null ? unknown : String(year)),
    ...fact(
      t('exo.card.method'),
      method === null ? unknown : methodLabel(method)
    )
  );
  item.append(title, list);
  return item;
}

/** La méthode dans la langue active ; une méthode que l'archive ajouterait reste en son texte. */
function methodLabel(method: string): string {
  const key = METHOD_KEYS[method];
  return key ? t(key) : method;
}

function distanceText(system: ExoplanetSystem): string {
  const pc = system[3];
  if (pc === null || pc >= UNKNOWN_DISTANCE_PC)
    return t('exo.card.distanceUnknown');
  return t('exo.card.distance', { ly: number(pc * LIGHT_YEARS_PER_PARSEC, 4) });
}

export async function setupExoplanetCard(
  options: Options
): Promise<ExoplanetCard> {
  const { starfield, camera, canvas, coordinator } = options;
  // Les phrases de la fiche sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let active = false;
  let current: ExoplanetSystem | null = null;
  let opener: HTMLElement | null = null;

  // ---- la fiche
  const card = document.createElement('aside');
  card.id = 'exoplanet-card';
  card.className = 'surface surface--info surface--exoplanet';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'exo-card-name');
  card.hidden = true;

  const header = document.createElement('header');
  header.className = 'bi-header';
  const heading = document.createElement('div');
  heading.className = 'bi-heading';
  const name = document.createElement('h2');
  name.className = 'bi-name';
  name.id = 'exo-card-name';
  const subtitle = document.createElement('p');
  subtitle.className = 'bi-subtitle';
  heading.append(name, subtitle);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'bi-close surface-close';
  closeButton.innerHTML =
    '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  header.append(heading, closeButton);

  const body = document.createElement('div');
  body.className = 'surface-body exo-body';
  // Une zone qui défile doit s'atteindre au clavier (axe : scrollable-region-focusable), et se nommer.
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', 'exo-card-name');
  const planets = document.createElement('ul');
  planets.className = 'exo-planets';
  const source = document.createElement('p');
  source.className = 'exo-source';
  body.append(planets, source);
  card.append(header, body);
  document.body.append(card);

  // ---- la recherche, au clavier : un nom d'hôte ouvre la même fiche qu'un clic
  const searchRow = document.createElement('div');
  searchRow.id = 'exoplanets-search-row';
  searchRow.className = 'exo-search';
  searchRow.hidden = true;
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'exoplanets-search';
  const search = document.createElement('input');
  search.id = 'exoplanets-search';
  search.type = 'search';
  search.autocomplete = 'off';
  search.setAttribute('list', 'exoplanets-search-options');
  const options_ = document.createElement('datalist');
  options_.id = 'exoplanets-search-options';
  searchRow.append(searchLabel, search, options_);
  const toggleWrapper = document.getElementById('exoplanets-toggle-wrapper');
  if (toggleWrapper) toggleWrapper.after(searchRow);
  else document.body.append(searchRow);

  const names = (): string[] =>
    (starfield.exoplanetHosts?.systems ?? []).map((s) => s[0]);

  function render(): void {
    searchLabel.textContent = t('exo.search.label');
    search.placeholder = t('exo.search.placeholder');
    if (!current) return;
    name.textContent = current[0];
    subtitle.textContent = `${t(
      current[7].length === 1
        ? 'exo.card.planets.one'
        : 'exo.card.planets.other',
      { count: current[7].length }
    )} · ${distanceText(current)}`;
    planets.replaceChildren(...current[7].map(planetItem));
    source.textContent = t('exo.card.source', {
      date: starfield.exoplanetHosts?.retrieved ?? '',
    });
    closeButton.setAttribute('aria-label', t('surface.close'));
  }

  function close(): void {
    if (card.hidden) return;
    card.hidden = true;
    current = null;
    syncSurfaceFocus(false, card, opener);
    opener = null;
  }

  function open(system: ExoplanetSystem): void {
    // Entrée puis la perte de focus du champ (`change`) demandent deux fois la même fiche.
    if (!card.hidden && current === system) return;
    opener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : canvas;
    current = system;
    render();
    coordinator.requestOpen('exoplanet-card');
    card.hidden = false;
    syncSurfaceFocus(true, card, opener);
    getAnnouncer().announce(
      t('exo.card.opened', { name: system[0], count: system[7].length })
    );
  }

  coordinator.register('exoplanet-card', () => {
    if (!card.hidden) {
      card.hidden = true;
      current = null;
      opener = null;
    }
  });

  closeButton.addEventListener('click', close);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  search.addEventListener('input', () => {
    const found = searchNames(names(), search.value, MAX_SUGGESTIONS);
    options_.replaceChildren(
      ...found.map((n) => {
        const option = document.createElement('option');
        option.value = n;
        return option;
      })
    );
  });
  const openTyped = (): void => {
    const typed = search.value.trim();
    // Le nom exact d'abord ; sinon la première suggestion : Entrée sur « TRAPPIST » ouvre TRAPPIST-1.
    const wanted =
      starfield.exoplanetHosts?.findSystem(typed) ??
      starfield.exoplanetHosts?.findSystem(
        searchNames(names(), typed, 1)[0] ?? ''
      );
    if (wanted) open(wanted);
  };
  search.addEventListener('change', openTyped);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // Sans cela, la même frappe « activerait » le bouton Fermer où le focus vient d'arriver.
    event.preventDefault();
    openTyped();
  });

  // ---- le clic sur le ciel : même tolérance de glisser que le picker de corps
  let start: { id: number; x: number; y: number } | null = null;
  let pending: ExoplanetSystem | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    pending = null;
    if (!active || !event.isPrimary || event.button !== 0) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!active || !start || event.pointerId !== start.id) return;
    const from = start;
    start = null;
    if (
      Math.hypot(event.clientX - from.x, event.clientY - from.y) >
      CLICK_MOVE_TOLERANCE
    )
      return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Direction du rayon dans le repère de la scène : le ciel est centré sur la caméra.
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new Vector3(ndcX, ndcY, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    const hit = (
      starfield.exoplanetsVisible ? starfield.exoplanetHosts : null
    )?.pickSystem(
      [ray.x, ray.y, ray.z],
      angularToleranceRad(camera.fov, rect.height, PICK_RADIUS_PX)
    );
    pending = hit ?? null;
  });
  // Ouvrir sur `click` et non sur `pointerup` : les événements souris de compatibilité d'un tap
  // (mousedown sur le canvas, non focalisable) reprennent sinon le focus que la fiche vient de
  // prendre ; `click` les suit tous (mesuré : après un tap, le focus restait hors de la fiche).
  canvas.addEventListener('click', () => {
    const hit = pending;
    pending = null;
    if (hit && active) open(hit);
  });

  onLocaleChange(() => {
    void loadDeferredMessages().then(render);
  });

  return {
    setActive(on) {
      active = on;
      searchRow.hidden = !on;
      if (!on) close();
    },
    open,
    close,
  };
}
