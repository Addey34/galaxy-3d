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
import { nearestMarker } from '@/core/satellites';
import { searchNames } from '@/core/skyPick';
import type { CelestialBodyConfig } from '@/types';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { onLocaleChange, t } from '@/i18n';
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
}

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
    };
  };
  const card = await setupSatelliteCard({
    coordinator: env.coordinator,
    canvas,
    info: infoOf,
    onSelect: (id) => {
      selectedId = id;
    },
    openCraft: env.openCraft,
  });

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
  const p = new THREE.Vector3();
  const helio = new THREE.Vector3();
  let rotationMs = Number.NaN;
  let rotation: readonly (readonly number[])[] = [];

  const clear = (): void => ctx?.clearRect(0, 0, canvas.width, canvas.height);

  return {
    setActive(on) {
      active = on;
      canvas.hidden = !on;
      searchRow.hidden = !on;
      if (!on) {
        card.close();
        hits = 0;
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
      hits = 0;
      card.tick();
      clear();
      let painted = 0;
      const earth = anyWithinValidity(epochs, ms)
        ? env.earthHelioAU(date)
        : null;
      if (!earth) {
        canvas.dataset['markers'] = '0';
        return;
      }
      // TEME ≈ équateur vrai de la date : une rotation par image, la même pour tous les objets.
      if (rotationMs !== ms) {
        rotation = Rotation_EQD_EQJ(date).rot;
        rotationMs = ms;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.font = '11px sans-serif';
      const claim = (rect: LabelRect): void => space?.add(rect);
      const labels: { text: string; x: number; y: number }[] = [];

      ctx.fillStyle = 'rgba(190, 235, 255, 0.95)';
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        if (!withinValidity(entry.epoch, ms)) continue;
        const state = propagate(entry.satrec, date);
        // SGP4 n'a pas de solution (orbite décrue) : rien à dessiner.
        if (!state || typeof state.position === 'boolean') continue;
        const [ex, ey, ez] = rotate(
          rotation,
          state.position.x,
          state.position.y,
          state.position.z
        );
        const rel = equatorialToScene(ex / AU_KM, ey / AU_KM, ez / AU_KM);
        helio.copy(earth).add(rel);
        placeInstrument(
          p,
          helio,
          { parent: env.earth, parentHelioAU: earth },
          morph
        );
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
      // L'objet choisi : un anneau et son nom, seulement quand il est peint (jamais hors validité ni derrière la Terre).
      if (selectedId !== null) {
        const row = byId.get(selectedId);
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
