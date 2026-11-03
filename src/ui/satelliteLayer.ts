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
import { json2satrec, propagate, type SatRec } from 'satellite.js';
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
import type { CelestialBodyConfig } from '@/types';
import Logger from '@/utils/Logger';

export const SATELLITES_URL = `${GALAXY_DATA_ORIGIN}/satellites/elements.json`;

export interface SatelliteLayerEnvironment {
  /** La Terre : le parent dont la règle des lunes place les satellites en Éducatif. */
  earth: CelestialBodyConfig;
  /** Position héliocentrique de la Terre (UA, repère scène), la règle même qui la dessine. */
  earthHelioAU(date: Date): THREE.Vector3 | null;
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
}

interface Entry {
  readonly elements: SatelliteElements;
  readonly satrec: SatRec;
  readonly epoch: number;
}

const STYLE = `
#satellite-overlay { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 21; pointer-events: none; }
#satellite-overlay[hidden], body.is-capturing #satellite-overlay { display: none; }
`;

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

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
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

    update(camera, date, morph, occlusion, space) {
      if (!active || !ctx) return;
      const ms = date.getTime();
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
      for (const entry of entries) {
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
      const value = String(painted);
      if (canvas.dataset['markers'] !== value)
        canvas.dataset['markers'] = value;
    },
  };
}
