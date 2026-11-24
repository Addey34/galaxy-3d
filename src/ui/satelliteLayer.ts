/**
 * LA COUCHE DES SATELLITES ARTIFICIELS : stations et satellites brillants de CelesTrak, chargée à la
 * première activation de la case « Satellites en orbite ». Éteinte au démarrage, jamais mémorisée.
 *
 * Couche d'instrument 2D, jamais un mesh : un satellite mesure quelques mètres à une centaine de
 * mètres, donc moins qu'un pixel à toute distance où l'on voit la Terre. Chaque objet est un point
 * peint au canvas, sans aucune taille de scène (invariant de réalisme de l'exploration).
 *
 * Les éléments viennent du service `galaxy-data` (jamais de CelesTrak directement), sont propagés par
 * SGP4 dans le repère TEME, passés à l'équateur J2000 puis au repère de la scène, et posés par la
 * règle même des sondes en orbite (`core/instrumentPlacement` : vraie position en Explo, règle des
 * lunes en Éducatif). Un élément n'est utilisé que dans sa fenêtre de validité
 * (`ELEMENT_VALIDITY_DAYS`) : hors fenêtre, le satellite n'est pas dessiné plutôt que mal placé.
 */
import * as THREE from 'three';
import { Rotation_EQD_EQJ } from 'astronomy-engine';
import {
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  type SatRec,
} from 'satellite.js';
import '@/core/timeScale';
import { equatorialToScene } from '@/core/frames';
import { GALAXY_DATA_ORIGIN } from '@/core/galaxyData';
import { placeInstrument } from '@/core/instrumentPlacement';
import {
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
  type LabelRect,
  type LabelSpace,
} from '@/core/labelSpace';
import type { ScreenOcclusion } from '@/core/screenOcclusion';
import {
  AU_KM,
  anyWithinValidity,
  epochMs,
  parseSatelliteFile,
  rotate,
  toOmm,
  withinValidity,
} from '@/core/satellites';
import type { SatelliteElements } from '@/core/satellites';
import { nearestMarker, orbitSummary } from '@/core/satellites';
import {
  PATH_SAMPLES,
  followVerdict,
  pathIsStale,
  pathSampleTimes,
  type FollowVerdict,
} from '@/core/satelliteTrack';
import { SQRT_K } from '@/core/ScaleService';
import type { CameraTarget } from '@/components/systems/CameraSystem';
import { searchNames } from '@/core/skyPick';
import type { CelestialBodyConfig } from '@/types';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { onLocaleChange, t } from '@/i18n';
import { getAnnouncer } from './announcer';
import type { CraftOpener } from './craftAccess';
import type { OverlayCoordinator } from './overlayCoordinator';
import { setupSatelliteCard, type SatelliteInfo } from './satelliteCard';
import { hasDebugFlag } from '@/utils/debugFlags';
import Logger from '@/utils/Logger';
import './satelliteLayer.css';

/** `?debug-satellites` : publie les repères peints (numéro, x, y) sur le canvas, pour les tests de clic. */
const DEBUG_POINTS = hasDebugFlag('debug-satellites');

export const SATELLITES_URL = `${GALAXY_DATA_ORIGIN}/satellites/elements.json`;

export interface SatelliteLayerEnvironment {
  /** La Terre : le parent dont la règle des lunes place les satellites en Éducatif. */
  earth: CelestialBodyConfig;
  /** Position héliocentrique de la Terre (UA, repère scène), la règle même qui la dessine. */
  earthHelioAU(date: Date): THREE.Vector3 | null;
  /** Ouvre l'inspection 3D d'un modèle d'engin (ici l'ISS) ; absent : pas de bouton. */
  openCraft?: CraftOpener;
  /** La fiche d'un satellite se pose là où se posent les autres fiches contextuelles. */
  coordinator: OverlayCoordinator;
  /** La scène : l'ancre du suivi (un groupe vide, aucun pixel) s'y pose, comme celles des sondes. */
  scene: THREE.Object3D;
  /** La caméra : le suivi la cible comme n'importe quel autre objet, par son système (un seul moteur de caméra). */
  camera: SatelliteCameraPort;
}

/** Ce que le suivi demande à la caméra, ni plus ni moins. */
export interface SatelliteCameraPort {
  registerTargets(targets: Record<string, CameraTarget>): void;
  setTarget(bodyName: string): void;
  readonly targetName: string | null;
}

/** Le nom de la cible de caméra du suivi : une ancre invisible, comme celle d'une sonde. */
export const FOLLOW_ANCHOR = 'satellite-track';

/**
 * Le cadrage du suivi, en rayons de la Terre : un satellite est un point sans taille, c'est l'ENVIRONNEMENT
 * qui se cadre. Distance de visite 0,9 rayon (la courbure de la Terre et l'objet), zoom de 73 km (0,0115 rayon)
 * à 6 rayons. Les mêmes multiples dans les deux modes ; seul le rayon change (Éducatif : celui de la scène,
 * Explo : le vrai, `radiusKm`), donc la caméra voit la même chose et ne se retrouve jamais à des milliers de rayons.
 */
const FOLLOW_VISIT_RADII = 0.9;
const FOLLOW_FRAME_RADII = 0.1;
const FOLLOW_CLEARANCE_RADII = 0.01;

export interface SatelliteStatus {
  /** Instant où le service a lu CelesTrak, ISO 8601 UTC. */
  fetchedAt: string;
  /** Satellites dont les éléments valent à cette date (dessinés ou non selon la vue). */
  valid: number;
  total: number;
}

export interface SatelliteLayer {
  setActive(on: boolean): void;
  /** À appeler chaque image : peint la couche si elle est active, sinon ne fait rien. */
  update(
    camera: THREE.PerspectiveCamera,
    date: Date,
    morph: number,
    occlusion: ScreenOcclusion | null,
    space: LabelSpace | null
  ): void;
  status(date: Date): SatelliteStatus;
  /**
   * Un clic (px fenêtre) tombe-t-il sur un satellite peint à la dernière image ? Si oui, sa fiche s'ouvre et
   * le clic est pris. Jamais pour un objet que SGP4 ne place pas (hors validité) ni derrière la Terre.
   */
  claim(clientX: number, clientY: number): boolean;
}

interface Entry {
  readonly elements: SatelliteElements;
  readonly satrec: SatRec;
  readonly epoch: number;
}

export async function setupSatelliteLayer(
  env: SatelliteLayerEnvironment,
  fetchImpl: typeof fetch = fetch
): Promise<SatelliteLayer | null> {
  let entries: Entry[];
  let fetchedAt: string;
  try {
    const res = await fetchImpl(SATELLITES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { file, rejected } = parseSatelliteFile(await res.json());
    if (rejected > 0)
      Logger.warn(`[satelliteLayer] ${rejected} objet(s) illisible(s) écartés`);
    fetchedAt = file.fetchedAt;
    entries = file.objects.map((elements) => ({
      elements,
      satrec: json2satrec(toOmm(elements) as never),
      epoch: epochMs(elements.epoch),
    }));
  } catch (err) {
    Logger.warn('[satelliteLayer] éléments des satellites illisibles', err);
    return null;
  }
  const epochs = entries.map((e) => e.epoch);

  const canvas = document.createElement('canvas');
  canvas.id = 'satellite-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  canvas.dataset['markers'] = '0';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  // L'ISS a un modèle 3D (GAL-OBJECT-IMMERSION-001) : un bouton, visible tant que la couche l'est, l'ouvre.
  // Les points de la couche sont un décor de canvas sans clic ni clavier : l'accès se fait par ce bouton.
  const ISS_NORAD_ID = 25544;
  // La phrase du bouton est hors démarrage : `t()` rendrait la clé brute sans elle.
  if (env.openCraft) await loadDeferredMessages();
  let craftButton: HTMLButtonElement | null = null;
  if (env.openCraft && entries.some((e) => e.elements.id === ISS_NORAD_ID)) {
    const open = env.openCraft;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'satellites-craft';
    button.className = 'settings-hint satellites-craft';
    button.hidden = true;
    const label = (): void => {
      button.textContent = t('craft.issButton');
    };
    label();
    onLocaleChange(label);
    button.addEventListener('click', () => open('iss-b', button));
    (document.getElementById('satellites-status') ?? canvas).after(button);
    craftButton = button;
  }

  // ---- la sélection (GAL-SATELLITE-SELECTION-001) : les repères peints à la dernière image, la fiche, la recherche
  const byId = new Map(entries.map((e, i) => [e.elements.id, i]));
  const hitX = new Float32Array(entries.length);
  const hitY = new Float32Array(entries.length);
  const hitIndex = new Int32Array(entries.length);
  let hits = 0;
  let selectedId: number | null = null;
  let lastMs = Date.now();
  const RAD = 180 / Math.PI;
  const infoOf = (id: number): SatelliteInfo | null => {
    const i = byId.get(id);
    if (i === undefined) return null;
    const entry = entries[i]!;
    const valid = withinValidity(entry.epoch, lastMs);
    let now: SatelliteInfo['now'] = null;
    if (valid) {
      const date = new Date(lastMs);
      const state = propagate(entry.satrec, date);
      if (
        state &&
        typeof state.position !== 'boolean' &&
        typeof state.velocity !== 'boolean'
      ) {
        const geo = eciToGeodetic(state.position, gstime(date));
        now = {
          altitudeKm: geo.height,
          speedKmS: Math.hypot(
            state.velocity.x,
            state.velocity.y,
            state.velocity.z
          ),
          latitudeDeg: geo.latitude * RAD,
          longitudeDeg: ((geo.longitude * RAD + 540) % 360) - 180,
        };
      }
    }
    return {
      elements: entry.elements,
      epochMs: entry.epoch,
      valid,
      now,
      fetchedAt,
      pathTruncated: pathFor === id && pathTruncated,
    };
  };
  // ---- le suivi caméra et la trace de l'orbite (GAL-SATELLITE-TRACKING-001)
  let followId: number | null = null;
  let anchor: THREE.Group | null = null;
  let lastMorph = 0;
  let rotationMs = Number.NaN;
  let rotation: readonly (readonly number[])[] = [];
  const p = new THREE.Vector3();
  const helio = new THREE.Vector3();
  const anchorAt = new THREE.Vector3();
  const ensureRotation = (date: Date, ms: number): void => {
    // TEME ≈ équateur vrai de la date : une rotation par instant, la même pour tous les objets.
    if (rotationMs === ms) return;
    rotation = Rotation_EQD_EQJ(date).rot;
    rotationMs = ms;
  };
  /** Pose `out` à la position SGP4 de `entry` à `date`, par la règle même des points peints ; `false` sans solution. */
  const placeEntry = (
    out: THREE.Vector3,
    entry: Entry,
    date: Date,
    earth: THREE.Vector3,
    morph: number
  ): boolean => {
    const state = propagate(entry.satrec, date);
    // SGP4 n'a pas de solution (orbite décrue) : rien à poser.
    if (!state || typeof state.position === 'boolean') return false;
    const [ex, ey, ez] = rotate(
      rotation,
      state.position.x,
      state.position.y,
      state.position.z
    );
    const rel = equatorialToScene(ex / AU_KM, ey / AU_KM, ez / AU_KM);
    helio.copy(earth).add(rel);
    placeInstrument(
      out,
      helio,
      { parent: env.earth, parentHelioAU: earth },
      morph
    );
    return true;
  };

  // La trace : UNE période en avant de la date de la scène, pour le seul objet choisi, recalculée quand la
  // date a bougé d'une fraction de période (`core/satelliteTrack`), jamais à chaque image.
  const pathRel = new Float32Array(3 * (PATH_SAMPLES + 1));
  const pathX = new Float32Array(PATH_SAMPLES + 1);
  const pathY = new Float32Array(PATH_SAMPLES + 1);
  const pathShown = new Uint8Array(PATH_SAMPLES + 1);
  let pathFor: number | null = null;
  let pathAt: number | null = null;
  let pathCount = 0;
  let pathTruncated = false;
  const refreshPath = (entry: Entry, date: Date, ms: number): void => {
    const period = orbitSummary(entry.elements).periodMinutes * 60_000;
    if (pathFor === entry.elements.id && !pathIsStale(pathAt, ms, period))
      return;
    const plan = pathSampleTimes(ms, period, entry.epoch);
    ensureRotation(date, ms);
    pathFor = entry.elements.id;
    pathAt = ms;
    pathTruncated = plan.truncated;
    pathCount = 0;
    for (const at of plan.times) {
      const state = propagate(entry.satrec, new Date(at));
      if (!state || typeof state.position === 'boolean') continue;
      const [ex, ey, ez] = rotate(
        rotation,
        state.position.x,
        state.position.y,
        state.position.z
      );
      const rel = equatorialToScene(ex / AU_KM, ey / AU_KM, ez / AU_KM);
      pathRel[3 * pathCount] = rel.x;
      pathRel[3 * pathCount + 1] = rel.y;
      pathRel[3 * pathCount + 2] = rel.z;
      pathCount += 1;
    }
  };

  const nameOf = (id: number | null): string =>
    id === null ? '' : (entries[byId.get(id) ?? -1]?.elements.name ?? '');

  // Le bouton d'arrêt toujours à portée : la fiche peut être fermée pendant le suivi.
  const chip = document.createElement('div');
  chip.id = 'satellite-follow-chip';
  chip.className = 'satellite-follow-chip';
  chip.hidden = true;
  const chipText = document.createElement('span');
  chipText.className = 'satellite-follow-chip-text';
  const chipStop = document.createElement('button');
  chipStop.type = 'button';
  chipStop.id = 'satellite-follow-stop';
  chipStop.className = 'settings-hint satellite-follow-stop';
  chip.append(chipText, chipStop);
  document.body.append(chip);
  const syncChip = (): void => {
    chip.hidden = followId === null;
    canvas.dataset['following'] = followId === null ? '' : String(followId);
    if (followId === null) return;
    chipText.textContent = t('sat.followChip', { name: nameOf(followId) });
    chipStop.textContent = t('sat.unfollow');
  };

  const card = await setupSatelliteCard({
    coordinator: env.coordinator,
    canvas,
    info: infoOf,
    onSelect: (id) => {
      selectedId = id;
    },
    openCraft: env.openCraft,
    follow: {
      active: () => followId,
      start: (id) => startFollow(id),
      stop: () => stopFollow('stop-requested'),
    },
  });

  function startFollow(id: number): void {
    const row = byId.get(id);
    if (row === undefined) return;
    const entry = entries[row]!;
    const date = new Date(lastMs);
    const earth = withinValidity(entry.epoch, lastMs)
      ? env.earthHelioAU(date)
      : null;
    if (!earth) return;
    ensureRotation(date, lastMs);
    // L'ancre est posée AVANT de cibler : la caméra lit sa position tout de suite pour son vol.
    if (!placeEntry(anchorAt, entry, date, earth, lastMorph)) return;
    if (!anchor) {
      anchor = new THREE.Group();
      anchor.name = FOLLOW_ANCHOR;
      // Le rayon de CADRAGE (un dixième du rayon de la Terre) : aucune taille réelle, rien n'est affiché.
      const earthRadius = (mode: 'educ' | 'explo'): number =>
        mode === 'explo'
          ? ((env.earth.realData?.radiusKm ?? 6371) / AU_KM) * SQRT_K
          : env.earth.radius;
      anchor.userData['radius'] = earthRadius('educ') * FOLLOW_FRAME_RADII;
      env.scene.add(anchor);
      env.camera.registerTargets({
        [FOLLOW_ANCHOR]: {
          group: anchor,
          cameraDistance: {
            educ: earthRadius('educ') * FOLLOW_VISIT_RADII,
            explo: earthRadius('explo') * FOLLOW_VISIT_RADII,
          },
          getFrameRadius: (mode) => earthRadius(mode) * FOLLOW_FRAME_RADII,
          getClearanceRadius: (mode) =>
            earthRadius(mode) * FOLLOW_CLEARANCE_RADII,
          getApproachFloorFactor: () => 1.15,
        },
      });
    }
    anchor.position.copy(anchorAt);
    followId = id;
    env.camera.setTarget(FOLLOW_ANCHOR);
    syncChip();
    card.refresh();
    getAnnouncer().announce(t('sat.following', { name: entry.elements.name }));
  }

  /** Finit le suivi : la caméra revient sur la Terre, sauf si le visiteur a lui-même choisi un autre corps. */
  function stopFollow(reason: FollowVerdict | 'stop-requested'): void {
    if (followId === null) return;
    const name = nameOf(followId);
    followId = null;
    syncChip();
    card.refresh();
    if (reason !== 'stop-retargeted' && env.camera.targetName === FOLLOW_ANCHOR)
      env.camera.setTarget('earth');
    if (reason === 'stop-retargeted') return;
    const key =
      reason === 'stop-outside'
        ? 'sat.followEndedOutside'
        : reason === 'stop-no-solution'
          ? 'sat.followEndedNoSolution'
          : 'sat.followEnded';
    getAnnouncer().announce(t(key, { name }));
  }
  chipStop.addEventListener('click', () => stopFollow('stop-requested'));
  chip.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      stopFollow('stop-requested');
    }
  });
  onLocaleChange(() => void loadDeferredMessages().then(syncChip));

  // La recherche au clavier : un nom ouvre la même fiche qu'un clic (les repères du canvas n'ont ni focus ni nom).
  const searchRow = document.createElement('div');
  searchRow.id = 'satellite-search-row';
  searchRow.className = 'exo-search';
  searchRow.hidden = true;
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'satellite-search';
  const search = document.createElement('input');
  search.id = 'satellite-search';
  search.type = 'search';
  search.autocomplete = 'off';
  search.setAttribute('list', 'satellite-search-options');
  const searchOptions = document.createElement('datalist');
  searchOptions.id = 'satellite-search-options';
  searchRow.append(searchLabel, search, searchOptions);
  (craftButton ?? document.getElementById('satellites-status') ?? canvas).after(
    searchRow
  );
  const searchText = (): void => {
    searchLabel.textContent = t('sat.search.label');
    search.placeholder = t('sat.search.placeholder');
  };
  searchText();
  onLocaleChange(() => void loadDeferredMessages().then(searchText));
  /** Les noms des objets dont les éléments valent à la date de la scène, dans l'ordre du fichier. */
  const validNames = (): string[] =>
    entries
      .filter((e) => withinValidity(e.epoch, lastMs))
      .map((e) => e.elements.name);
  search.addEventListener('input', () => {
    searchOptions.replaceChildren(
      ...searchNames(validNames(), search.value, 12).map((n) => {
        const option = document.createElement('option');
        option.value = n;
        return option;
      })
    );
  });
  const openTyped = (): void => {
    const typed = search.value.trim().toLowerCase();
    if (!typed) return;
    const names = validNames();
    const wanted =
      names.find((n) => n.toLowerCase() === typed) ??
      searchNames(names, typed, 1)[0];
    const entry = entries.find(
      (e) => e.elements.name === wanted && withinValidity(e.epoch, lastMs)
    );
    if (entry) card.open(entry.elements.id, search);
  };
  search.addEventListener('change', openTyped);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // Sans cela, la même frappe « activerait » le bouton Fermer où le focus vient d'arriver.
    event.preventDefault();
    openTyped();
  });

  let active = false;

  const clear = (): void => ctx?.clearRect(0, 0, canvas.width, canvas.height);

  /**
   * Peint la trace calculée : un trait qui s'efface avec le temps (le « maintenant » est le plus net), et des
   * chevrons qui disent le sens. Un point derrière la Terre coupe le trait ; rien n'est inventé au-delà.
   * Rend le nombre de points de la trace effectivement projetés devant la caméra.
   */
  const drawPath = (
    earth: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    morph: number,
    occlusion: ScreenOcclusion | null,
    w: number,
    h: number
  ): number => {
    if (!ctx || pathCount < 2) return 0;
    let shown = 0;
    for (let k = 0; k < pathCount; k++) {
      helio
        .set(pathRel[3 * k]!, pathRel[3 * k + 1]!, pathRel[3 * k + 2]!)
        .add(earth);
      placeInstrument(
        p,
        helio,
        { parent: env.earth, parentHelioAU: earth },
        morph
      );
      const hidden = occlusion?.hides(p.x, p.y, p.z) ?? false;
      p.project(camera);
      const ok = !hidden && p.z >= -1 && p.z <= 1;
      pathShown[k] = ok ? 1 : 0;
      pathX[k] = (p.x * 0.5 + 0.5) * w;
      pathY[k] = (-p.y * 0.5 + 0.5) * h;
      if (ok) shown += 1;
    }
    ctx.lineWidth = 1.5;
    for (let k = 1; k < pathCount; k++) {
      if (!pathShown[k] || !pathShown[k - 1]) continue;
      const alpha = 0.9 - 0.7 * (k / pathCount);
      ctx.strokeStyle = `rgba(255, 212, 121, ${Math.round(alpha * 100) / 100})`;
      ctx.beginPath();
      ctx.moveTo(pathX[k - 1]!, pathY[k - 1]!);
      ctx.lineTo(pathX[k]!, pathY[k]!);
      ctx.stroke();
    }
    // Les chevrons du sens du déplacement, à un quart, la moitié et les trois quarts de la période.
    ctx.strokeStyle = 'rgba(255, 228, 160, 0.95)';
    for (const share of [0.25, 0.5, 0.75]) {
      const k = Math.round(share * (pathCount - 1));
      if (k < 1 || k >= pathCount - 1) continue;
      if (!pathShown[k - 1] || !pathShown[k] || !pathShown[k + 1]) continue;
      const dx = pathX[k + 1]! - pathX[k - 1]!;
      const dy = pathY[k + 1]! - pathY[k - 1]!;
      const length = Math.hypot(dx, dy);
      if (length < 1e-3) continue;
      const ux = dx / length;
      const uy = dy / length;
      const x = pathX[k]!;
      const y = pathY[k]!;
      ctx.beginPath();
      ctx.moveTo(x - 6 * ux - 4 * uy, y - 6 * uy + 4 * ux);
      ctx.lineTo(x, y);
      ctx.lineTo(x - 6 * ux + 4 * uy, y - 6 * uy - 4 * ux);
      ctx.stroke();
    }
    return shown;
  };

  return {
    setActive(on) {
      active = on;
      canvas.hidden = !on;
      searchRow.hidden = !on;
      if (!on) {
        stopFollow('stop-requested');
        card.close();
        hits = 0;
        pathFor = null;
      }
      if (craftButton) craftButton.hidden = !on;
      if (!on) {
        clear();
        canvas.dataset['markers'] = '0';
      }
    },

    status(date) {
      const ms = date.getTime();
      return {
        fetchedAt,
        valid: epochs.filter((e) => withinValidity(e, ms)).length,
        total: entries.length,
      };
    },

    claim(clientX, clientY) {
      if (!active || hits === 0) return false;
      // Un doigt est plus gros qu'un curseur : la capture s'élargit sur un écran tactile.
      const radius = window.matchMedia?.('(pointer: coarse)').matches ? 24 : 14;
      const hit = nearestMarker(hitX, hitY, hits, clientX, clientY, radius);
      if (hit < 0) return false;
      card.open(entries[hitIndex[hit]!]!.elements.id);
      return true;
    },

    update(camera, date, morph, occlusion, space) {
      if (!active || !ctx) return;
      const ms = date.getTime();
      lastMs = ms;
      lastMorph = morph;
      hits = 0;
      clear();
      let painted = 0;
      const earth = anyWithinValidity(epochs, ms)
        ? env.earthHelioAU(date)
        : null;
      if (!earth) {
        // Hors validité pour tout le fichier : un suivi en cours s'arrête, il ne garde pas une position périmée.
        stopFollow('stop-outside');
        card.tick();
        canvas.dataset['markers'] = '0';
        return;
      }
      ensureRotation(date, ms);
      if (followId !== null) {
        const row = byId.get(followId);
        const entry = row === undefined ? undefined : entries[row];
        const valid = !!entry && withinValidity(entry.epoch, ms);
        const solved =
          !!entry && valid && placeEntry(anchorAt, entry, date, earth, morph);
        const verdict = followVerdict({
          present: !!entry,
          valid,
          solved,
          cameraTarget: env.camera.targetName,
          anchor: FOLLOW_ANCHOR,
        });
        if (verdict === 'continue') anchor?.position.copy(anchorAt);
        else stopFollow(verdict);
      }
      card.tick();
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.font = '11px sans-serif';
      const claim = (rect: LabelRect): void => space?.add(rect);
      const labels: { text: string; x: number; y: number }[] = [];

      ctx.fillStyle = 'rgba(190, 235, 255, 0.95)';
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        if (!withinValidity(entry.epoch, ms)) continue;
        // Sans solution SGP4 (orbite décrue) : rien à dessiner.
        if (!placeEntry(p, entry, date, earth, morph)) continue;
        // Derrière la Terre : rien à peindre.
        if (occlusion?.hides(p.x, p.y, p.z)) continue;
        p.project(camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1)
          continue;
        const x = (p.x * 0.5 + 0.5) * w;
        const y = (-p.y * 0.5 + 0.5) * h;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        painted += 1;
        hitX[hits] = x;
        hitY[hits] = y;
        hitIndex[hits] = index;
        hits += 1;
        claim({ left: x - 3, right: x + 3, top: y - 3, bottom: y + 3 });
        if (entry.elements.group === 'stations')
          labels.push({ text: entry.elements.name, x, y });
      }

      // Les noms des stations seulement, et seulement s'ils trouvent une place libre.
      ctx.fillStyle = 'rgba(225, 238, 255, 0.9)';
      for (const label of labels) {
        const textWidth = ctx.measureText(label.text).width;
        const placed = space
          ? space.placeText(
              label.x,
              label.y,
              textWidth,
              MARKER_LABEL_HEIGHT,
              markerLabelCandidates(textWidth),
              overlayLabelBounds(w, h)
            )
          : { dx: 8 + textWidth / 2, dy: 0, rect: null };
        if (!placed) continue;
        if (placed.rect) claim(placed.rect);
        ctx.fillText(
          label.text,
          label.x + placed.dx - textWidth / 2,
          label.y + placed.dy + 4
        );
      }
      // L'objet suivi, sinon l'objet choisi : sa trace (une période en avant, calculée, avec le sens du déplacement), son anneau, son nom.
      const focusId = followId ?? selectedId;
      let pathPoints = 0;
      if (focusId !== null) {
        const row = byId.get(focusId);
        const entry = row === undefined ? undefined : entries[row];
        if (entry && withinValidity(entry.epoch, ms)) {
          refreshPath(entry, date, ms);
          pathPoints = drawPath(earth, camera, morph, occlusion, w, h);
        } else pathFor = null;
      }
      const pathValue = String(pathPoints);
      if (canvas.dataset['path'] !== pathValue)
        canvas.dataset['path'] = pathValue;
      // L'objet choisi : un anneau et son nom, seulement quand il est peint (jamais hors validité ni derrière la Terre).
      if (focusId !== null) {
        const row = byId.get(focusId);
        for (let k = 0; k < hits; k++) {
          if (hitIndex[k] !== row) continue;
          ctx.strokeStyle = 'rgba(255, 212, 121, 0.95)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hitX[k]!, hitY[k]!, 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 228, 160, 0.98)';
          ctx.fillText(
            entries[row!]!.elements.name,
            hitX[k]! + 11,
            hitY[k]! - 8
          );
        }
      }
      if (DEBUG_POINTS)
        canvas.dataset['points'] = JSON.stringify(
          Array.from({ length: hits }, (_, k) => [
            entries[hitIndex[k]!]!.elements.id,
            Math.round(hitX[k]!),
            Math.round(hitY[k]!),
          ])
        );
      const value = String(painted);
      if (canvas.dataset['markers'] !== value)
        canvas.dataset['markers'] = value;
    },
  };
}
