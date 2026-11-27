/**
 * LA FICHE D'UNE ÉTOILE VOISINE, ouverte par un clic sur un repère ou par la recherche d'un nom
 * (« Proxima », « Alpha Centauri », « Sirius »).
 *
 * Chargée à la demande, à la première activation de la couche : elle n'existe pas au démarrage.
 * Elle dit ce que la scène ne peut pas montrer sans mentir : la DISTANCE, en années-lumière avec son
 * incertitude quand la source en publie une, en unités astronomiques, à l'échelle « la Terre à 1 cm
 * du Soleil », et en temps de trajet de la lumière. Chaque nombre vient de la distance publiée
 * (`core/neighbours`) ; une valeur absente se dit « non publiée ». Comme les fiches du ciel
 * profond et des exoplanètes, elle ne quitte pas le corps suivi : l'étoile est amenée au centre de
 * l'écran par un décalage de la fenêtre de projection (`ui/cardCentering`).
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { SkyCenteringHost } from '@/components/systems/SkyCenteringView';
import type { NeighbourMarkers } from '@/components/celestial/NeighbourMarkers';
import {
  approach,
  distanceFacts,
  namesOf,
  systemName,
  systemPrimary,
  totalProperMotionArcsecPerYear,
  type NeighbourFile,
  type NeighbourRow,
  type NeighbourSystem,
} from '@/core/neighbours';
import { angularToleranceRad, searchNames } from '@/core/skyPick';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { getAnnouncer } from './announcer';
import { createCardCentering } from './cardCentering';
import type { OverlayCoordinator } from './overlayCoordinator';
import { syncSurfaceFocus } from './surfaceFocus';

/** Rayon de capture d'un clic, en pixels : un carré de 11 px se vise du doigt sans le manquer. */
const PICK_RADIUS_PX = 14;
/** Déplacement max entre pointerdown et pointerup pour rester un clic (sinon, glisser-pivoter). */
const CLICK_MOVE_TOLERANCE = 5;
const MAX_SUGGESTIONS = 12;

export interface NeighbourCard {
  /** La couche est allumée ou éteinte : les clics, la recherche et la fiche suivent. */
  setActive(on: boolean): void;
  open(system: NeighbourSystem): void;
  close(): void;
}

interface Options {
  markers: NeighbourMarkers;
  file: NeighbourFile;
  camera: PerspectiveCamera;
  canvas: HTMLElement;
  /** La caméra, pour centrer l'écran sur l'étoile ouverte (`SkyCenteringView`, chargé à la première ouverture). */
  centering?: SkyCenteringHost;
  coordinator: OverlayCoordinator;
  /** Ouvre le voisinage solaire en 3D sur cette étoile (absent : pas de bouton). */
  openStellar?: (focus: string) => void;
}

function number(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    maximumSignificantDigits: digits,
  }).format(value);
}

function fixed(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function fact(label: string, value: string): HTMLElement[] {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  return [dt, dd];
}

/** La distance en années-lumière, avec son incertitude quand la source en publie une. */
function distanceText(row: NeighbourRow): string {
  const d = distanceFacts(row);
  // Le chiffre significatif s'arrête où l'incertitude commence : 4,2465 ± 0,0003 se lit 4,2465.
  if (d.lightYearsError === null)
    return t('nb.card.distanceValue', { ly: number(d.lightYears, 4) });
  const digits = Math.max(
    0,
    Math.min(6, 1 - Math.floor(Math.log10(d.lightYearsError)))
  );
  return t('nb.card.distanceError', {
    ly: fixed(d.lightYears, digits),
    err: fixed(d.lightYearsError, digits),
  });
}

function radialText(row: NeighbourRow): string {
  const direction = approach(row);
  if (direction === null) return t('nb.card.unknown');
  const v = number(Math.abs(row[10]!), 3);
  return direction === 'approaching'
    ? t('nb.card.rvApproaching', { v })
    : t('nb.card.rvReceding', { v });
}

export async function setupNeighbourCard(
  options: Options
): Promise<NeighbourCard> {
  const { markers, file, camera, canvas, coordinator, centering, openStellar } =
    options;
  const centerOn = createCardCentering(centering);
  // Les phrases de la fiche sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let active = false;
  let current: NeighbourSystem | null = null;
  let opener: HTMLElement | null = null;

  // ---- la fiche
  const card = document.createElement('aside');
  card.id = 'neighbour-card';
  card.className = 'surface surface--info surface--exoplanet';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'neighbour-card-name');
  card.hidden = true;

  const header = document.createElement('header');
  header.className = 'bi-header';
  const heading = document.createElement('div');
  heading.className = 'bi-heading';
  const name = document.createElement('h2');
  name.className = 'bi-name';
  name.id = 'neighbour-card-name';
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
  body.setAttribute('aria-labelledby', 'neighbour-card-name');
  const facts = document.createElement('dl');
  facts.className = 'exo-facts';
  const hint = document.createElement('p');
  hint.className = 'exo-source';
  const origin = document.createElement('p');
  origin.className = 'exo-source';
  const source = document.createElement('p');
  source.className = 'exo-source';
  const acknowledgement = document.createElement('p');
  acknowledgement.className = 'exo-source';
  const stellarButton = document.createElement('button');
  stellarButton.type = 'button';
  stellarButton.className = 'settings-button';
  stellarButton.id = 'neighbour-card-stellar';
  stellarButton.hidden = !openStellar;
  body.append(facts, stellarButton, hint, origin, source, acknowledgement);
  card.append(header, body);
  document.body.append(card);

  // ---- la recherche, au clavier : un nom ouvre la même fiche qu'un clic
  const searchRow = document.createElement('div');
  searchRow.id = 'neighbour-search-row';
  searchRow.className = 'exo-search';
  searchRow.hidden = true;
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'neighbour-search';
  const search = document.createElement('input');
  search.id = 'neighbour-search';
  search.type = 'search';
  search.autocomplete = 'off';
  search.setAttribute('list', 'neighbour-search-options');
  const options_ = document.createElement('datalist');
  options_.id = 'neighbour-search-options';
  searchRow.append(searchLabel, search, options_);
  const toggleWrapper = document.getElementById('neighbours-toggle-wrapper');
  if (toggleWrapper) toggleWrapper.after(searchRow);
  else document.body.append(searchRow);

  // Nom (sans casse) → système : le premier système qui porte un nom le garde.
  const byName = new Map<string, NeighbourSystem>();
  const names: string[] = [];
  for (const system of markers.systems)
    for (const n of namesOf(system)) {
      const key = n.toLowerCase();
      if (byName.has(key)) continue;
      byName.set(key, system);
      names.push(n);
    }

  function render(): void {
    searchLabel.textContent = t('nb.search.label');
    search.placeholder = t('nb.search.placeholder');
    closeButton.setAttribute('aria-label', t('surface.close'));
    stellarButton.textContent = t('st.open');
    if (!current) return;
    const primary = systemPrimary(current);
    const unknown = t('nb.card.unknown');
    const d = distanceFacts(primary);
    name.textContent = systemName(current);
    subtitle.textContent = [t('nb.card.kind'), primary[2]]
      .filter(Boolean)
      .join(' · ');
    facts.replaceChildren(
      ...(current.members.length > 1
        ? fact(
            t('nb.card.members'),
            current.members
              .map((m) => (m[2] ? `${m[0]} (${m[2]})` : m[0]))
              .join(', ')
          )
        : []),
      ...fact(t('nb.card.distance'), distanceText(primary)),
      ...fact(t('nb.card.au'), t('nb.card.auValue', { au: number(d.au, 4) })),
      ...fact(
        t('nb.card.scale'),
        t('nb.card.scaleValue', { km: number(d.kmAtOneCentimetre, 3) })
      ),
      ...fact(
        t('nb.card.light'),
        t('nb.card.lightValue', { years: number(d.lightYears, 3) })
      ),
      ...fact(
        t('nb.card.motion'),
        t('nb.card.motionValue', {
          v: number(totalProperMotionArcsecPerYear(primary), 3),
        })
      ),
      ...fact(t('nb.card.rv'), radialText(primary)),
      ...fact(t('nb.card.spectral'), primary[2] ?? unknown),
      ...fact(t('nb.card.vmag'), number(primary[7], 3)),
      ...fact(t('deep.card.ra'), `${number(primary[3], 6)}°`),
      ...fact(t('deep.card.dec'), `${number(primary[4], 6)}°`)
    );
    hint.textContent = t('nb.card.hint');
    origin.textContent =
      primary[11] === 'gaia-dr3'
        ? t('nb.card.origin.gaia', { id: primary[12] ?? '' })
        : t('nb.card.origin.hyg');
    source.textContent = t('nb.card.source', {
      license: file.source.hyg.license,
    });
    // Le remerciement exigé par l'ESA, verbatim (en anglais, comme l'exige la source).
    acknowledgement.textContent =
      primary[11] === 'gaia-dr3'
        ? (file.source.gaia?.acknowledgement ?? '')
        : '';
    acknowledgement.hidden = acknowledgement.textContent === '';
  }

  function close(): void {
    if (card.hidden) return;
    card.hidden = true;
    current = null;
    syncSurfaceFocus(false, card, opener);
    opener = null;
  }

  function open(system: NeighbourSystem): void {
    // Entrée puis la perte de focus du champ (`change`) demandent deux fois la même fiche.
    if (!card.hidden && current === system) return;
    opener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : canvas;
    current = system;
    render();
    coordinator.requestOpen('neighbour-card');
    card.hidden = false;
    syncSurfaceFocus(true, card, opener);
    getAnnouncer().announce(t('nb.card.opened', { name: systemName(system) }));
    // Une étoile choisie dans la liste ou au clic arrive au centre de l'écran.
    const direction: [number, number, number] = [0, 0, 0];
    const index = markers.systems.indexOf(system);
    if (index >= 0 && markers.directionOf(index, direction))
      centerOn(direction, card);
  }

  coordinator.register('neighbour-card', () => {
    if (!card.hidden) {
      card.hidden = true;
      current = null;
      opener = null;
    }
  });

  stellarButton.addEventListener('click', () => {
    const system = current;
    if (!system || !openStellar) return;
    close();
    openStellar(systemName(system));
  });
  closeButton.addEventListener('click', close);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  search.addEventListener('input', () => {
    const found = searchNames(names, search.value, MAX_SUGGESTIONS);
    options_.replaceChildren(
      ...found.map((n) => {
        const option = document.createElement('option');
        option.value = n;
        return option;
      })
    );
  });
  const openTyped = (): void => {
    const typed = search.value.trim().toLowerCase();
    // Le nom exact d'abord ; sinon la première suggestion : Entrée sur « proxi » ouvre Proxima.
    const wanted =
      byName.get(typed) ??
      byName.get((searchNames(names, typed, 1)[0] ?? '').toLowerCase());
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
  let pending: NeighbourSystem | null = null;
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
    pending = markers.pickSystem(
      [ray.x, ray.y, ray.z],
      angularToleranceRad(camera.fov, rect.height, PICK_RADIUS_PX)
    );
  });
  // Ouvrir sur `click` et non sur `pointerup` : les événements souris de compatibilité d'un tap
  // reprennent sinon le focus que la fiche vient de prendre (même piège que la fiche des exoplanètes).
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
