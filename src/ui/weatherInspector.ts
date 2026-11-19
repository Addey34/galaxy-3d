/**
 * L'INSPECTEUR MÉTÉO : choisir un point de la Terre et lire, en ce point, les couches DÉJÀ actives
 * et chargées (GAL-METEO-INSPECT-003).
 *
 * Chargé à la demande, à la première activation du mode depuis le panneau météo : il n'existe pas
 * au démarrage. Il ne fait QUE lire : `inspectWeatherPoint` (INSPECT-002) interroge les grilles que
 * les couches tiennent déjà, sans requête réseau, et ne rallume jamais une couche éteinte.
 *
 * LA SÉLECTION n'a pas de second système de raycasting : le clic passe par le crochet `placeHit` du
 * picker de corps (qui fait déjà la différence entre un clic et un glisser), et le rayon est
 * converti en latitude / longitude par `core/surfacePick`, c'est-à-dire par la chaîne exacte qui
 * oriente la surface (pôle IAU, phase de rotation). Au clavier : deux champs de coordonnées et un
 * bouton « centre de la vue ».
 *
 * LA RÉACTIVITÉ réutilise ce qui existe : les cases du panneau (`onChange`), la langue et les unités
 * (`onLocaleChange`, `onUnitSystemChange`). Le reste (nouvelle grille, échec, changement de date,
 * donnée périmée) se lit à 4 Hz dans la boucle d'images, comme le badge des sources, sur une
 * SIGNATURE des lectures : le DOM n'est touché que si elle change, et les lignes sont mises à jour
 * en place, jamais reconstruites.
 */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import {
  describeReading,
  VARIABLE_ORDER,
  type InspectRow,
} from '@/core/inspectDisplay';
import { pickGeographic, isFacingCamera, bodyCenter } from '@/core/surfacePick';
import { onUnitSystemChange } from '@/core/units';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getAnnouncer } from './announcer';
import { inspectWeatherPoint, type WeatherLayerHandle } from './earthLayer';
import { syncSurfaceFocus } from './surfaceFocus';

/** Période de relecture des grilles (ms) : assez court pour suivre une date, assez long pour ne rien coûter. */
const POLL_MS = 250;
const NBSP = ' ';

export interface WeatherInspector {
  /** Le mode est-il armé (clic sur le globe = lecture) ? */
  isArmed(): boolean;
  /** Arme ou désarme le mode ; ouvre ou ferme la carte. */
  setArmed(on: boolean): void;
  /** Libère la boucle d'images, les abonnements, la carte et le repère ; idempotent. */
  dispose(): void;
  /** Se prévient du changement d'état (le bouton du panneau suit). */
  onArmedChange(listener: (armed: boolean) => void): void;
  /**
   * Un clic en coordonnées fenêtre. Rend `true` s'il a choisi un point (le picker de corps ne doit
   * alors rien faire d'autre) ; `false` si le mode est éteint ou si le clic manque le globe.
   */
  claim(clientX: number, clientY: number): boolean;
  /** Choisit un point par ses coordonnées (le chemin du clavier, et des tests). */
  selectPoint(latitudeDeg: number, longitudeDeg: number): void;
  /** Le point choisi, ou `null`. */
  point(): { latitudeDeg: number; longitudeDeg: number } | null;
}

export interface WeatherInspectorOptions {
  api: PublicAPI;
  layers: readonly WeatherLayerHandle[];
  /** Le panneau des couches : ses cases (activer / éteindre) relancent la lecture. */
  panel: { onChange(listener: () => void): void };
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  /** Le corps suivi : le mode s'éteint quand on quitte la Terre pour un autre corps. */
  getSelectedBody: () => string | null;
}

const ICONS: Record<string, string> = {
  temperature:
    '<path d="M6.5 9.4V3.4a1.5 1.5 0 0 1 3 0v6a2.9 2.9 0 1 1-3 0z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 5.2v5.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  pressure:
    '<path d="M2.2 10.6a5.8 5.8 0 1 1 11.6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 10.6l2.6-3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="10.6" r="0.9" fill="currentColor"/>',
  humidity:
    '<path d="M8 2.2c2.4 3 3.9 4.9 3.9 6.9a3.9 3.9 0 0 1-7.8 0c0-2 1.5-3.9 3.9-6.9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  precipitation:
    '<path d="M4.5 9a2.5 2.5 0 0 1 .2-4.98A3.2 3.2 0 0 1 11 4.1 2.2 2.2 0 0 1 11.3 9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 11l-.6 1.6M8.2 11l-.6 1.6M10.4 11l-.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  cloudCover:
    '<path d="M4.5 12a2.8 2.8 0 0 1 .2-5.58A3.6 3.6 0 0 1 11.6 6 2.8 2.8 0 0 1 11.5 12z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  wind: '<path d="M2 6h7.2a2 2 0 1 0-2-2M2 9.6h9.6a2 2 0 1 1-2 2M2 13h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

function format(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** « 48,86° N » : les points cardinaux viennent du dictionnaire (O, L, E selon la langue). */
export function coordinateText(lat: number, lon: number): string {
  const ns = t(lat >= 0 ? 'inspect.dir.N' : 'inspect.dir.S');
  const ew = t(lon >= 0 ? 'inspect.dir.E' : 'inspect.dir.W');
  return `${format(Math.abs(lat), 2)}°${NBSP}${ns}, ${format(Math.abs(lon), 2)}°${NBSP}${ew}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setText(node: HTMLElement, text: string | null): void {
  const next = text ?? '';
  if (node.textContent !== next) node.textContent = next;
  node.hidden = next === '';
}

export async function setupWeatherInspector(
  options: WeatherInspectorOptions
): Promise<WeatherInspector> {
  const { api, layers, panel, camera, canvas, getSelectedBody } = options;
  // Les phrases sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let armed = false;
  let point: { latitudeDeg: number; longitudeDeg: number } | null = null;
  let signature = '';
  let lastPoll = 0;
  let opener: HTMLElement | null = null;
  const armedListeners: Array<(armed: boolean) => void> = [];
  const rows = new Map<string, HTMLLIElement>();

  // ---- la carte
  const card = el('aside', 'surface surface--info surface--inspector');
  card.id = 'weather-inspector';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'weather-inspector-title');
  card.hidden = true;

  const header = el('header', 'bi-header');
  const heading = el('div', 'bi-heading');
  const title = el('h2', 'bi-name');
  title.id = 'weather-inspector-title';
  const subtitle = el('p', 'bi-subtitle');
  subtitle.id = 'weather-inspector-point';
  heading.append(title, subtitle);
  const closeButton = el('button', 'bi-close surface-close');
  closeButton.type = 'button';
  closeButton.innerHTML =
    '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  header.append(heading, closeButton);

  const body = el('div', 'surface-body wi-body');
  // Une zone qui défile doit s'atteindre au clavier, et se nommer.
  body.tabIndex = 0;
  body.setAttribute('role', 'group');
  body.setAttribute('aria-labelledby', 'weather-inspector-title');

  const form = el('form', 'wi-coords');
  form.noValidate = true;
  const latLabel = el('label', 'wi-field');
  const latText = el('span');
  const latInput = el('input');
  latInput.type = 'number';
  latInput.inputMode = 'decimal';
  latInput.step = 'any';
  latInput.min = '-90';
  latInput.max = '90';
  latInput.id = 'weather-inspector-lat';
  latLabel.append(latText, latInput);
  const lonLabel = el('label', 'wi-field');
  const lonText = el('span');
  const lonInput = el('input');
  lonInput.type = 'number';
  lonInput.inputMode = 'decimal';
  lonInput.step = 'any';
  lonInput.min = '-180';
  lonInput.max = '180';
  lonInput.id = 'weather-inspector-lon';
  lonLabel.append(lonText, lonInput);
  const goButton = el('button', 'wi-button wi-button--primary');
  goButton.type = 'submit';
  const centerButton = el('button', 'wi-button');
  centerButton.type = 'button';
  form.append(latLabel, lonLabel, goButton, centerButton);

  const problem = el('p', 'wi-problem');
  problem.setAttribute('role', 'status');
  problem.hidden = true;
  const hint = el('p', 'wi-hint');
  const list = el('ul', 'wi-rows');
  list.setAttribute('aria-label', '');
  const noLayers = el('p', 'wi-hint wi-hint--layers');
  const images = el('p', 'wi-note');
  const caveat = el('p', 'wi-note wi-caveat');
  body.append(form, problem, hint, list, noLayers, images, caveat);
  card.append(header, body);
  document.body.append(card);

  // ---- le marqueur : un repère 2D attaché au point, jamais un objet de la scène
  const marker = el('div', 'wi-marker');
  marker.setAttribute('aria-hidden', 'true');
  marker.hidden = true;
  document.body.append(marker);

  const earthBody = () => api.sceneSystem.getBody('earth');

  // ---- le rendu des lignes (mises à jour en place)
  function buildRow(row: InspectRow): HTMLLIElement {
    const li = el('li', 'wi-row');
    li.dataset['layer'] = row.layerId;
    const icon = el('span', 'wi-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18">${ICONS[row.variable] ?? ''}</svg>`;
    const main = el('div', 'wi-main');
    const label = el('span', 'wi-label');
    const value = el('span', 'wi-value');
    const detail = el('span', 'wi-detail');
    const message = el('span', 'wi-message');
    const details = el('details', 'wi-meta');
    const summary = el('summary');
    const dl = el('dl', 'wi-meta-list');
    details.append(summary, dl);
    main.append(label, value, detail, message, details);
    li.append(icon, main);
    return li;
  }

  function patchRow(li: HTMLLIElement, row: InspectRow): void {
    li.dataset['status'] = row.status;
    li.dataset['variable'] = row.variable;
    const [label, value, detail, message, details] = Array.from(
      li.querySelector('.wi-main')!.children
    ) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLDetailsElement,
    ];
    setText(label, row.label);
    setText(value, row.value);
    setText(detail, row.detail);
    setText(message, row.message);
    details.hidden = row.meta.length === 0;
    const summary = details.querySelector('summary')!;
    if (summary.textContent !== t('inspect.details'))
      summary.textContent = t('inspect.details');
    const dl = details.querySelector('dl')!;
    const key = JSON.stringify(row.meta);
    if (dl.dataset['meta'] !== key) {
      dl.dataset['meta'] = key;
      dl.replaceChildren(
        ...row.meta.flatMap(({ label: l, value: v }) => {
          const dt = el('dt');
          dt.textContent = l;
          const dd = el('dd');
          dd.textContent = v;
          return [dt, dd];
        })
      );
    }
  }

  function readNow() {
    if (!point) return [];
    return inspectWeatherPoint(layers, point.latitudeDeg, point.longitudeDeg);
  }

  /** Ce que la lecture dit, en une chaîne : change si et seulement si l'affichage doit changer. */
  function signatureOf(readings: ReturnType<typeof readNow>): string {
    return readings
      .map(({ layerId, reading }) => {
        const value =
          reading.kind === 'scalar'
            ? reading.value
            : `${reading.speedKmh}/${reading.directionDeg}`;
        const p = reading.provenance;
        return `${layerId}|${reading.availability}|${reading.phase}|${reading.emptyReason ?? ''}|${value}|${p?.requestedHour ?? ''}|${p?.effectiveDate ?? ''}|${p?.provider ?? ''}|${p?.temporalCategory ?? ''}`;
      })
      .join('\n');
  }

  function renderStatic(): void {
    title.textContent = t('inspect.title');
    subtitle.textContent = point
      ? coordinateText(point.latitudeDeg, point.longitudeDeg)
      : '';
    subtitle.hidden = !point;
    latText.textContent = t('inspect.lat');
    lonText.textContent = t('inspect.lon');
    goButton.textContent = t('inspect.go');
    centerButton.textContent = t('inspect.center');
    closeButton.setAttribute('aria-label', t('surface.close'));
    caveat.textContent = t('inspect.caveat');
    images.textContent = t('inspect.hint.images');
  }

  function render(): void {
    renderStatic();
    const readings = readNow();
    signature = signatureOf(readings);
    const active = readings.filter(
      ({ reading }) => reading.availability !== 'inactive'
    );
    const models = active
      .map(({ layerId, reading }) =>
        describeReading(layerId, reading, t, getLocale())
      )
      .sort(
        (a, b) =>
          VARIABLE_ORDER.indexOf(a.variable) -
          VARIABLE_ORDER.indexOf(b.variable)
      );
    const wanted = new Set(models.map((m) => m.layerId));
    for (const [id, li] of rows)
      if (!wanted.has(id)) {
        li.remove();
        rows.delete(id);
      }
    for (const model of models) {
      let li = rows.get(model.layerId);
      if (!li) {
        li = buildRow(model);
        rows.set(model.layerId, li);
      }
      patchRow(li, model);
      list.append(li); // l'ordre des couches du panneau (append déplace sans recréer)
    }
    list.hidden = models.length === 0;
    // Les trois états d'une carte : rien de choisi, choisi sans couche active, lectures.
    hint.textContent = t('inspect.hint.pick');
    hint.hidden = !!point;
    noLayers.textContent = t('inspect.hint.noLayers');
    noLayers.hidden = !(point && models.length === 0);
    images.hidden = !(point && models.length === 0);
    caveat.hidden = models.length === 0;
  }

  let disposed = false;
  function refresh(): void {
    if (disposed || card.hidden) return;
    render();
  }

  // ---- le point
  function selectPoint(latitudeDeg: number, longitudeDeg: number): void {
    const lat = Math.max(-90, Math.min(90, latitudeDeg));
    // Longitude ramenée dans [-180, 180] : le marqueur et la grille lisent la même.
    const lon = ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
    point = { latitudeDeg: lat, longitudeDeg: lon };
    latInput.value = format(lat, 2).replace(/\s/g, '').replace(',', '.');
    lonInput.value = format(lon, 2).replace(/\s/g, '').replace(',', '.');
    problem.hidden = true;
    if (!armed) setArmed(true);
    render();
    getAnnouncer().announce(
      t('inspect.selected', {
        lat: format(lat, 2),
        lon: format(lon, 2),
      })
    );
  }

  const NBSP_RE = /[\s\u00a0]/g;
  function applyInputs(): void {
    const lat = Number(latInput.value.replace(NBSP_RE, '').replace(',', '.'));
    const lon = Number(lonInput.value.replace(NBSP_RE, '').replace(',', '.'));
    if (
      latInput.value.trim() === '' ||
      lonInput.value.trim() === '' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      problem.textContent = t('inspect.badCoords');
      problem.hidden = false;
      return;
    }
    selectPoint(lat, lon);
  }

  /** Le rayon de la caméra par un point de l'écran (coordonnées normalisées). */
  function pickAtNdc(ndcX: number, ndcY: number) {
    const earth = earthBody();
    if (!earth) return null;
    camera.updateMatrixWorld();
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(camera)
      .sub(origin)
      .normalize();
    return pickGeographic(origin, direction, earth);
  }

  function claim(clientX: number, clientY: number): boolean {
    if (!armed) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const hit = pickAtNdc(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    if (!hit) return false;
    selectPoint(hit.latitudeDeg, hit.longitudeDeg);
    return true;
  }

  // ---- le marqueur, une transformation par image
  const scratch = new THREE.Vector3();
  const centerScratch = new THREE.Vector3();
  const cameraScratch = new THREE.Vector3();
  let markerShown = false;
  let markerX = -1e9;
  let markerY = -1e9;
  function placeMarker(): void {
    const earth = earthBody();
    let visible = false;
    if (earth && point && armed) {
      earth.surfacePointToWorld(point.latitudeDeg, point.longitudeDeg, scratch);
      camera.getWorldPosition(cameraScratch);
      centerScratch.copy(bodyCenter(earth));
      // Derrière le globe : masqué (produit scalaire normale · vers-caméra).
      if (isFacingCamera(scratch, centerScratch, cameraScratch)) {
        scratch.project(camera);
        if (scratch.z < 1) {
          const rect = canvas.getBoundingClientRect();
          const x = rect.left + (scratch.x * 0.5 + 0.5) * rect.width;
          const y = rect.top + (-scratch.y * 0.5 + 0.5) * rect.height;
          if (Math.abs(x - markerX) > 0.1 || Math.abs(y - markerY) > 0.1) {
            markerX = x;
            markerY = y;
            marker.style.transform = `translate(${Math.round(x * 10) / 10}px, ${Math.round(y * 10) / 10}px)`;
          }
          visible = true;
        }
      }
    }
    if (visible !== markerShown) {
      markerShown = visible;
      marker.hidden = !visible;
    }
  }

  const stopFrame = api.animationSystem.onFrame(() => {
    if (disposed || !armed) return;
    // Le corps suivi n'est plus la Terre (ni la vue globale) : le mode s'éteint.
    const selected = getSelectedBody();
    if (selected && selected !== 'earth' && selected !== 'overview') {
      setArmed(false);
      return;
    }
    placeMarker();
    const now = performance.now();
    if (now - lastPoll < POLL_MS) return;
    lastPoll = now;
    if (card.hidden || !point) return;
    const next = signatureOf(readNow());
    if (next !== signature) render();
  });

  // ---- l'état armé
  function setArmed(on: boolean): void {
    if (disposed || on === armed) return;
    // Un import qui se résout après un changement de corps ne doit pas armer le mode ailleurs.
    if (on) {
      const selected = getSelectedBody();
      if (selected && selected !== 'earth' && selected !== 'overview') return;
    }
    armed = on;
    document.body.classList.toggle('wi-armed', on);
    if (on) {
      opener =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
          ? document.activeElement
          : null;
      card.hidden = false;
      render();
      syncSurfaceFocus(true, card, opener);
    } else {
      point = null;
      signature = '';
      card.hidden = true;
      problem.hidden = true;
      markerShown = false;
      marker.hidden = true;
      syncSurfaceFocus(false, card, opener);
      opener = null;
    }
    for (const listener of armedListeners) listener(armed);
  }

  closeButton.addEventListener('click', () => setArmed(false));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setArmed(false);
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyInputs();
  });
  centerButton.addEventListener('click', () => {
    const hit = pickAtNdc(0, 0);
    if (!hit) {
      problem.textContent = t('inspect.offGlobe');
      problem.hidden = false;
      return;
    }
    selectPoint(hit.latitudeDeg, hit.longitudeDeg);
  });

  panel.onChange(refresh);
  const stopLocale = onLocaleChange(() => {
    void loadDeferredMessages().then(() => {
      if (disposed) return;
      for (const li of rows.values()) li.remove();
      rows.clear();
      refresh();
    });
  });
  const stopUnits = onUnitSystemChange(refresh);

  return {
    isArmed: () => armed,
    setArmed,
    onArmedChange: (listener) => {
      armedListeners.push(listener);
    },
    dispose() {
      if (disposed) return;
      setArmed(false);
      disposed = true;
      stopFrame();
      stopLocale();
      stopUnits();
      armedListeners.length = 0;
      card.remove();
      marker.remove();
    },
    claim,
    selectPoint,
    point: () => (point ? { ...point } : null),
  };
}
