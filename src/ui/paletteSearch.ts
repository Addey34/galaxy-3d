/**
 * LES RÉSULTATS TYPÉS DE LA PALETTE (lot 47, 2026-10-12) : lieux, missions, instruments, survols,
 * sous les corps. Un MORCEAU chargé à la première frappe utile : l'index pèse 77 ko gzip et le
 * budget JS du démarrage n'avait que 5 396 o de marge (mesuré le 2026-10-12). Le module pur est
 * `core/search.ts`, l'index est dérivé par `scripts/generate-search-index.mjs`.
 *
 * Chaque résultat AGIT, par les commandes que l'application possède déjà (la sélection partagée,
 * le mode, l'horloge, la caméra, le panneau météo), jamais par un chemin à lui :
 *   - une couche de données : son corps, puis la couche cochée PAR SA CASE, panneau ouvert ;
 *   - un lieu : son corps, puis la caméra face à la formation, une fois le vol fini ;
 *   - une mission : sa sonde si on la dessine et qu'elle existe à cette date, sinon sa cible du
 *     catalogue si elle est UNIQUE (dont la fiche liste la mission), sinon sa page, qui donne
 *     toutes ses cibles ;
 *   - un instrument : sa sonde ;
 *   - un survol : la date du point le plus proche, la sonde, en Explo ;
 *   - une découverte : le corps, ou son parent quand on ne le dessine pas (sa fiche dit ce qu'on
 *     savait à la date de la scène).
 */
import { iauLongitudeToSceneLongitude } from '@/core/gazetteer';
import {
  prepareSearchIndex,
  searchPrepared,
  type PreparedIndex,
  type SearchDataset,
  type SearchHit,
  type SearchIndexFile,
  type SearchKind,
} from '@/core/search';
import { viewAnglesFromDirection } from '@/core/viewAngles';
import { loadFormations } from '@/config/placeObservations';
import { getLocale, t } from '@/i18n';
import { LOCALE_PATH } from '@/i18n/locales';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { PublicAPI } from '@/SolarSystemApp';
import * as THREE from 'three';
import Logger from '@/utils/Logger';

/** Ce que l'application prête à la recherche pour agir. */
export interface SearchContext {
  api: PublicAPI;
  selectBody(name: string): void;
  setMode(mode: 'educ' | 'explo'): void;
  /** Re-synchronise le permalien après une action qui a changé la date ou le cadrage. */
  sync(): void;
  /** Les couches de données de l'application, libellé dans la langue courante. */
  datasets(): SearchDataset[];
  /** Active une couche comme un clic sur sa case, et montre son panneau. */
  showDataset(id: string): void;
}

/** Adresse ABSOLUE : une adresse relative résoudrait sous `/titan/` quand on démarre sur une page de corps. */
export const SEARCH_INDEX_URL = '/assets/search/index.json';

/** Le segment des pages de mission, celui de `seo/documentPage.ts` (croisé par un test). */
export const MISSIONS_PATH_SEGMENT = 'missions';

let prepared: { locale: string; index: PreparedIndex } | null = null;
let file: Promise<SearchIndexFile | null> | null = null;

function loadIndex(): Promise<SearchIndexFile | null> {
  file ??= fetch(SEARCH_INDEX_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SearchIndexFile>;
    })
    .catch((error: unknown) => {
      // Une panne se retente à la frappe suivante : on ne garde pas l'échec.
      file = null;
      Logger.warn(`[Recherche] index indisponible : ${String(error)}`);
      return null;
    });
  return file;
}

/** Les résultats typés d'une requête ; `[]` tant que l'index n'est pas là ou s'il manque. */
export async function searchTyped(
  query: string,
  context: SearchContext
): Promise<SearchHit[]> {
  const data = await loadIndex();
  if (!data) return [];
  const locale = getLocale();
  // Préparé par langue : « Lune » doit trouver les formations lunaires en français.
  if (prepared?.locale !== locale)
    prepared = {
      locale,
      index: prepareSearchIndex(
        data,
        (id) => bodyDisplayName(id),
        context.datasets()
      ),
    };
  return searchPrepared(prepared.index, query);
}

/** La sonde que ce résultat ferait sélectionner, pour griser ce qui n'existe pas à cette date. */
export function hitProbe(hit: SearchHit): string | null {
  if (hit.kind === 'instrument') return hit.probe;
  return null;
}

/** La ligne secondaire d'un résultat : de quoi il s'agit, dans la langue courante. */
export function hitDetail(hit: SearchHit): string {
  switch (hit.kind) {
    case 'dataset':
    case 'place':
      return bodyDisplayName(hit.body);
    case 'mission':
      return hit.probe
        ? bodyDisplayName(hit.probe)
        : hit.body
          ? bodyDisplayName(hit.body)
          : t('search.missionPage');
    case 'instrument':
      return bodyDisplayName(hit.probe);
    case 'flyby':
    case 'orbitInsertion':
      return '';
    case 'discovery':
      return [hit.when, hit.who].filter(Boolean).join(' · ');
  }
}

export function groupTitle(kind: SearchKind): string {
  return t(`search.group.${kind}`);
}

/**
 * Les lignes des résultats typés, sous les corps : un titre par type, puis une option par
 * résultat, au clavier comme les corps (`role="option"`, `aria-selected` tenu par la palette).
 * Rend ce que la palette parcourt aux flèches.
 */
export function renderHits(
  container: HTMLElement,
  hits: readonly SearchHit[],
  context: SearchContext,
  unavailable: ReadonlySet<string>
): { button: HTMLButtonElement; activate(): void }[] {
  const items: { button: HTMLButtonElement; activate(): void }[] = [];
  let group: SearchKind | null = null;
  hits.forEach((hit, index) => {
    if (hit.kind !== group) {
      group = hit.kind;
      const title = document.createElement('div');
      title.className = 'palette-group-title';
      title.dataset['group'] = `search.group.${hit.kind}`;
      title.textContent = groupTitle(hit.kind);
      container.append(title);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `palette-hit-${index}`;
    button.className = 'palette-item palette-hit';
    button.dataset['kind'] = hit.kind;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    const name = document.createElement('span');
    name.className = 'palette-item-name';
    name.textContent = hit.label;
    button.append(name);
    const detail = hitDetail(hit);
    if (detail) {
      const kindEl = document.createElement('span');
      kindEl.className = 'palette-item-kind';
      kindEl.textContent = detail;
      button.append(kindEl);
    }
    button.setAttribute(
      'aria-label',
      detail ? `${hit.label}, ${detail}` : hit.label
    );
    const probe = hitProbe(hit);
    const off = probe !== null && unavailable.has(probe);
    button.classList.toggle('is-unavailable', off);
    button.setAttribute('aria-disabled', String(off));
    if (off) button.title = t('nav.unavailable');
    const activate = (): void => {
      if (!off) runHit(hit, context, unavailable);
    };
    button.addEventListener('click', activate);
    container.append(button);
    items.push({ button, activate });
  });
  return items;
}

const MS_PER_DAY = 86_400_000;

/** Exécute un résultat. `unavailable` : les cibles sans position à la date courante. */
export function runHit(
  hit: SearchHit,
  context: SearchContext,
  unavailable: ReadonlySet<string>
): void {
  const { api } = context;
  switch (hit.kind) {
    case 'dataset':
      context.selectBody(hit.body);
      context.showDataset(hit.id);
      return;
    case 'place': {
      context.selectBody(hit.body);
      void lookAtFormation(hit.body, hit.label, context);
      return;
    }
    case 'mission': {
      if (hit.probe && !unavailable.has(hit.probe))
        context.selectBody(hit.probe);
      else if (hit.body) context.selectBody(hit.body);
      else {
        const segment = LOCALE_PATH[getLocale()];
        const prefix = segment ? `/${segment}` : '';
        window.location.assign(
          `${prefix}/${MISSIONS_PATH_SEGMENT}/${hit.slug}/`
        );
      }
      return;
    }
    case 'instrument':
      context.selectBody(hit.probe);
      return;
    case 'discovery':
      context.selectBody(hit.body);
      return;
    case 'flyby':
    case 'orbitInsertion': {
      const om = api.orbitalMechanics;
      const at = hit.kind === 'flyby' ? hit.closestAt : hit.at;
      const delta = (Date.parse(at) - om.simulationDate.getTime()) / MS_PER_DAY;
      om.addTimeOffset(delta);
      context.setMode('explo');
      context.selectBody(hit.probe);
      context.sync();
      return;
    }
  }
}

/**
 * La caméra face à une formation : la direction va du centre du corps RENDU au point de surface
 * que `surfacePointToWorld` donne (la chaîne qui oriente la texture et les noms du gazetteer),
 * appliquée une fois le vol fini, sinon le vol l'écraserait à son arrivée.
 */
async function lookAtFormation(
  body: string,
  name: string,
  context: SearchContext
): Promise<void> {
  const features = await loadFormations(body);
  const feature = features?.find((f) => f.name === name);
  const camera = context.api.cameraSystem;
  if (!feature) return;
  camera.whenSettled(() => {
    const object = context.api.sceneSystem.getBody(body);
    const view = camera.getViewAngles();
    if (!object || !view) return;
    const centre = object.group.getWorldPosition(new THREE.Vector3());
    const point = object.surfacePointToWorld(
      feature.lat,
      iauLongitudeToSceneLongitude(feature.lon)
    );
    const angles = viewAnglesFromDirection(point.clone().sub(centre));
    if (!angles) return;
    camera.applyViewAngles(angles.azimuthDeg, angles.polarDeg, view.distance);
    publishFocus(name, point, centre, camera.camera);
    context.sync();
  });
}

/**
 * OÙ TOMBE LA FORMATION À L'ÉCRAN une fois cadrée, publié sur le canvas comme les autres couches
 * d'instrument publient leurs comptes : son nom, sa distance au centre de l'image (coordonnées
 * normalisées, 0 au centre, 1 au bord) et sa face (`front` si la caméra voit sa surface).
 * `e2e/search.spec.ts` le lit : sans lui, rien ne distinguerait « la Lune » de « Tycho ».
 */
function publishFocus(
  name: string,
  point: THREE.Vector3,
  centre: THREE.Vector3,
  camera: THREE.PerspectiveCamera
): void {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  camera.updateMatrixWorld();
  const normal = point.clone().sub(centre).normalize();
  const toCamera = camera.position.clone().sub(point).normalize();
  const projected = point.clone().project(camera);
  const offset = Math.hypot(projected.x, projected.y);
  canvas.dataset['searchFocus'] =
    `${name}|${offset.toFixed(3)}|${normal.dot(toCamera) > 0 ? 'front' : 'back'}`;
}
