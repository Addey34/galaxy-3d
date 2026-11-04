/**
 * LA FICHE D'UN OBJET DU CIEL PROFOND, ouverte par un clic sur un repère ou par la recherche d'une
 * désignation, d'un numéro Messier ou d'un nom d'usage (le chemin au clavier).
 *
 * Chargée à la demande, à la première activation de la couche : elle n'existe pas au démarrage.
 * Elle ne quitte pas le corps suivi : l'objet est amené au centre de l'écran par un décalage de la
 * fenêtre de projection (`ui/cardCentering`, `SkyCenteringView`), car viser le point du ciel mettrait
 * la planète suivie devant lui. Elle LIT le fichier daté d'OpenNGC
 * (`core/deepsky.ts`) : ni distance ni taille de scène, une valeur absente se dit « non publiée ».
 * Une surface contextuelle parmi les autres : le coordinateur n'en garde qu'une ouverte.
 */
import type { SkyCenteringHost } from '@/components/systems/SkyCenteringView';
import { createCardCentering } from './cardCentering';
import { Vector3, type PerspectiveCamera } from 'three';
import type { DeepSkyMarkers } from '@/components/celestial/DeepSkyMarkers';
import type { DeepSkyFile, DeepSkyObject } from '@/core/deepsky';
import { angularToleranceRad, searchNames } from '@/core/skyPick';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { getAnnouncer } from './announcer';
import type { OverlayCoordinator } from './overlayCoordinator';
import { syncSurfaceFocus } from './surfaceFocus';

/** Rayon de capture d'un clic, en pixels : un losange de 9 px se vise du doigt sans le manquer. */
const PICK_RADIUS_PX = 14;
/** Déplacement max entre pointerdown et pointerup pour rester un clic (sinon, glisser-pivoter). */
const CLICK_MOVE_TOLERANCE = 5;
const MAX_SUGGESTIONS = 12;

/** Le type OpenNGC → la clé de sa phrase ; un type que le fichier ajouterait reste en son code. */
export const TYPE_KEYS: Readonly<Record<string, string>> = {
  G: 'deep.type.G',
  OCl: 'deep.type.OCl',
  'Cl+N': 'deep.type.ClN',
  GCl: 'deep.type.GCl',
  Neb: 'deep.type.Neb',
  HII: 'deep.type.HII',
  PN: 'deep.type.PN',
  RfN: 'deep.type.RfN',
  SNR: 'deep.type.SNR',
};

export interface DeepSkyCard {
  /** La couche est allumée ou éteinte : les clics, la recherche et la fiche suivent. */
  setActive(on: boolean): void;
  open(object: DeepSkyObject): void;
  close(): void;
}

interface Options {
  markers: DeepSkyMarkers;
  file: DeepSkyFile;
  camera: PerspectiveCamera;
  canvas: HTMLElement;
  /** La caméra, pour centrer l'écran sur l'objet ouvert (`SkyCenteringView`, chargé à la première ouverture). */
  centering?: SkyCenteringHost;
  coordinator: OverlayCoordinator;
}

function number(value: number, digits = 4): string {
  return new Intl.NumberFormat(getLocale(), {
    maximumSignificantDigits: digits,
  }).format(value);
}

function typeLabel(type: string): string {
  const key = TYPE_KEYS[type];
  return key ? t(key) : type;
}

/** Les noms qui désignent un objet : désignation, « M n », nom d'usage. */
export function namesOf(object: DeepSkyObject): string[] {
  const [designation, messier, common] = object;
  return [
    designation,
    ...(messier !== null ? [`M ${messier}`] : []),
    ...(common ? [common] : []),
  ];
}

function fact(label: string, value: string): HTMLElement[] {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  return [dt, dd];
}

export async function setupDeepSkyCard(options: Options): Promise<DeepSkyCard> {
  const { markers, file, camera, canvas, coordinator, centering } = options;
  const centerOn = createCardCentering(centering);
  // Les phrases de la fiche sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let active = false;
  let current: DeepSkyObject | null = null;
  let opener: HTMLElement | null = null;

  // ---- la fiche
  const card = document.createElement('aside');
  card.id = 'deepsky-card';
  card.className = 'surface surface--info surface--exoplanet';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'deepsky-card-name');
  card.hidden = true;

  const header = document.createElement('header');
  header.className = 'bi-header';
  const heading = document.createElement('div');
  heading.className = 'bi-heading';
  const name = document.createElement('h2');
  name.className = 'bi-name';
  name.id = 'deepsky-card-name';
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
  body.setAttribute('aria-labelledby', 'deepsky-card-name');
  const facts = document.createElement('dl');
  facts.className = 'exo-facts';
  const source = document.createElement('p');
  source.className = 'exo-source';
  body.append(facts, source);
  card.append(header, body);
  document.body.append(card);

  // ---- la recherche, au clavier : un nom ouvre la même fiche qu'un clic
  const searchRow = document.createElement('div');
  searchRow.id = 'deepsky-search-row';
  searchRow.className = 'exo-search';
  searchRow.hidden = true;
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'deepsky-search';
  const search = document.createElement('input');
  search.id = 'deepsky-search';
  search.type = 'search';
  search.autocomplete = 'off';
  search.setAttribute('list', 'deepsky-search-options');
  const options_ = document.createElement('datalist');
  options_.id = 'deepsky-search-options';
  searchRow.append(searchLabel, search, options_);
  const toggleWrapper = document.getElementById('deepsky-toggle-wrapper');
  if (toggleWrapper) toggleWrapper.after(searchRow);
  else document.body.append(searchRow);

  // Nom (sans casse) → objet : le premier objet qui porte un nom le garde.
  const byName = new Map<string, DeepSkyObject>();
  const names: string[] = [];
  for (const object of file.objects)
    for (const n of namesOf(object)) {
      const key = n.toLowerCase();
      if (byName.has(key)) continue;
      byName.set(key, object);
      names.push(n);
    }

  function render(): void {
    searchLabel.textContent = t('deep.search.label');
    search.placeholder = t('deep.search.placeholder');
    closeButton.setAttribute('aria-label', t('surface.close'));
    if (!current) return;
    const [
      designation,
      messier,
      common,
      type,
      constellation,
      ra,
      dec,
      v,
      size,
    ] = current;
    const unknown = t('deep.card.unknown');
    name.textContent = common ?? designation;
    subtitle.textContent = [typeLabel(type), constellation]
      .filter(Boolean)
      .join(' · ');
    facts.replaceChildren(
      ...fact(t('deep.card.designation'), designation),
      ...(messier !== null ? fact(t('deep.card.messier'), `M ${messier}`) : []),
      ...fact(t('deep.card.constellation'), constellation ?? unknown),
      ...fact(t('deep.card.ra'), `${number(ra)}°`),
      ...fact(t('deep.card.dec'), `${number(dec)}°`),
      ...fact(t('deep.card.vmag'), v === null ? unknown : number(v, 3)),
      ...fact(
        t('deep.card.size'),
        size === null ? unknown : t('deep.unit.arcmin', { v: number(size, 3) })
      )
    );
    source.textContent = t('deep.card.source', {
      date: file.source.retrieved,
      license: file.source.license,
    });
  }

  function close(): void {
    if (card.hidden) return;
    card.hidden = true;
    current = null;
    syncSurfaceFocus(false, card, opener);
    opener = null;
  }

  function open(object: DeepSkyObject): void {
    // Entrée puis la perte de focus du champ (`change`) demandent deux fois la même fiche.
    if (!card.hidden && current === object) return;
    opener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : canvas;
    current = object;
    render();
    coordinator.requestOpen('deepsky-card');
    card.hidden = false;
    syncSurfaceFocus(true, card, opener);
    getAnnouncer().announce(
      t('deep.card.opened', { name: object[2] ?? object[0] })
    );
    // Un objet choisi dans la liste ou au clic arrive au centre de l'écran.
    const direction: [number, number, number] = [0, 0, 0];
    const index = markers.objects.indexOf(object);
    if (index >= 0 && markers.directionOf(index, direction))
      centerOn(direction, card);
  }

  coordinator.register('deepsky-card', () => {
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
    // Le nom exact d'abord ; sinon la première suggestion : Entrée sur « androm » ouvre Andromeda.
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
  let pending: DeepSkyObject | null = null;
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
    pending = markers.pickObject(
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
