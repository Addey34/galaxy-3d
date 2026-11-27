/**
 * LE VOLUME STELLAIRE ÉTENDU dans la vue du voisinage (GAL-UNIVERSE-008) : choix de l'échelle (5, 25,
 * 50, 100 pc), filtres, recherche par nom, fiche d'une étoile du volume. La vue (`ui/stellarView`) garde
 * la scène, les contrôles, la boucle et l'adresse ; ce module ne la touche que par `VolumePanelHost`.
 *
 * Données (`core/stellarVolume`, fichiers de `public/assets/sky/volume/`) : RIEN au démarrage ni à
 * l'ouverture de la vue. Le manifeste et la première coquille arrivent au premier choix d'une échelle
 * au-delà de 5 pc ; chaque coquille suivante quand l'échelle l'exige ; les noms (≈ 0,5 Mo) à la première
 * recherche ou sélection ; un paquet de détails (≈ 98 ko) à la sélection d'une étoile de ce paquet. Une
 * demande remplacée par une autre (changement d'échelle, fermeture) est ANNULÉE (`AbortController`).
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  StellarVolume,
  VOLUME_RINGS_PC,
} from '@/components/stellar/StellarVolume';
import type { NeighbourhoodScene } from '@/components/stellar/NeighbourhoodScene';
import {
  absoluteMagnitude,
  colourIndexOf,
  decodeDetail,
  decodeShell,
  hostOf,
  spectralOf,
  epochDistancePc,
  magnitudeOf,
  relativeDistanceErrorOf,
  searchNames,
  shellsFor,
  VOLUME_FILTERS,
  VOLUME_SCALES_PC,
  type VolumeDetail,
  type VolumeFilter,
  type VolumeManifest,
  type VolumeNameEntry,
  type VolumeScale,
} from '@/core/stellarVolume';
import {
  distanceFromSunPc,
  parsecsToLightYears,
  type Vec3,
} from '@/core/stellarSpace';
import { starSlug } from '@/core/stellarPermalink';
import {
  assembleVolume,
  type CrossmatchFile,
  type CrossmatchNamesFile,
  type HygComplementFile,
  type HygNamesFile,
  type MissingFile,
  type NasaHostsFile,
  type VolumeAssembly,
  type VolumeIndex,
} from '@/core/stellarVolumeAssembly';
import { getLocale, t } from '@/i18n';
import Logger from '@/utils/Logger';
import { getAnnouncer } from './announcer';
import { el, fact, fixed, number } from './stellarDom';

export const VOLUME_BASE = '/assets/sky/volume/';

export interface VolumePanelHost {
  scene: NeighbourhoodScene;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  /** Le volet : les commandes du volume s'y posent en tête. */
  side: HTMLElement;
  /** La fiche du système choisi : cachée quand une étoile du volume est choisie. */
  systemCard: HTMLElement;
  /** Le conteneur des noms 2D (cercles d'échelle, étoile choisie). */
  labels: HTMLElement;
  /** Années depuis J2000 de l'instant montré par la vue. */
  yearsFromJ2000(): number;
  /** Retire la sélection d'un système du voisinage (sans annonce). */
  deselectSystem(): void;
  /** Cadre un point à cette distance (pc), avec ou sans glissement selon le mouvement réduit. */
  frameOn(point: Vec3, distancePc: number): void;
  /** L'adresse doit suivre (échelle, étoile du volume). */
  syncAddress(): void;
  /** La hauteur du volet change : la zone libre aussi. */
  layout(): void;
  /** Ouvre l'exploration d'un hôte d'exoplanètes du ciel (`ui/systemView`), si elle existe. */
  openSystem?(host: string): void;
  fetchImpl?: typeof fetch;
}

export interface VolumeAddress {
  vol?: number;
  vstar?: string;
}

export interface VolumePanel {
  /** L'étoile du volume au point écran, ou -1. */
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    radiusPx: number
  ): number;
  select(index: number, announce?: boolean): Promise<void>;
  clearSelection(): void;
  setYears(yearsFromJ2000: number): void;
  setScale(scale: VolumeScale): Promise<boolean>;
  /** Appelé à chaque image après le rendu : rapport de pixels et noms 2D. */
  frame(width: number, height: number): void;
  address(): VolumeAddress;
  applyAddress(address: VolumeAddress): Promise<void>;
  rerender(): void;
  readonly scale: VolumeScale;
  dispose(): void;
}

/** Le jeton d'adresse d'une étoile du volume : rang global, puis identifiant Gaia ou nom. */
export function volumeStarToken(index: number, check: string): string {
  return `${index}.${check}`;
}

export function parseVolumeStarToken(
  token: string
): { index: number; check: string } | null {
  const m = /^(\d{1,7})\.([a-z0-9-]{1,64})$/.exec(token);
  return m ? { index: Number(m[1]), check: m[2]! } : null;
}

export function createVolumePanel(host: VolumePanelHost): VolumePanel {
  const fetcher = host.fetchImpl ?? fetch;
  let manifest: VolumeManifest | null = null;
  let manifestRequest: Promise<VolumeManifest> | null = null;
  let volume: StellarVolume | null = null;
  /** L'assemblage des fournisseurs (`core/stellarVolumeAssembly`) : un dossier par licence. */
  let assembly: VolumeAssembly | null = null;
  /** Les fichiers des noms de HYG et de leur table, ou `null` si HYG est désactivé. */
  let hygNameFiles: { names: string; pairs: string } | null = null;
  let names: Record<string, VolumeNameEntry> | null = null;
  /** Les rangs dont le nom vient de HYG (la fiche le dit, avec sa licence). */
  let namedByHyg: ReadonlySet<number> = new Set();
  let namesRequest: Promise<Record<string, VolumeNameEntry> | null> | null =
    null;
  const details = new Map<string, ArrayBuffer>();
  let scale: VolumeScale = 5;
  let filter: VolumeFilter = 'all';
  let selected = -1;
  let detail: VolumeDetail | null = null;
  /** Les détails de l'étoile choisie n'ont pas pu être lus (réseau) : la fiche le dit, un nouveau choix réessaie. */
  let detailFailed = false;
  /**
   * LA DERNIÈRE INTENTION DU VISITEUR, seule autorité (même règle que les éditions de surface,
   * `surfaceEditionsBlock` : un compteur de demandes, la plus récente possède le changement). Chaque geste
   * (échelle, choix, recherche, lien, Retour ou Suivant, choix d'une voisine) en prend un nouveau ; toute
   * suite d'une attente vérifie qu'elle le possède encore avant de cadrer, d'annoncer, de montrer ou
   * d'écrire l'adresse.
   */
  let intent = 0;
  /** La vue est fermée : plus rien ne se crée, ne se cadre, ne s'annonce ni ne s'écrit. */
  let disposed = false;
  const owns = (token: number): boolean => !disposed && token === intent;
  /** Annule tous les téléchargements de la session à sa fermeture. */
  const lifecycle = new AbortController();
  /**
   * Les téléchargements de coquilles appartiennent à la COQUILLE, pas à l'intention qui les a lancés : deux
   * intentions qui ont besoin de la même coquille (100 pc puis 50 pc, qui partagent celle de 50) partagent
   * son téléchargement. Une coquille dont plus aucune intention n'a besoin est annulée.
   */
  const shellLoads = new Map<
    number,
    { promise: Promise<void>; controller: AbortController; done: boolean }
  >();

  // ---- le DOM : commandes en tête du volet, fiche sous celle du système
  const box = el('section', 'sv-volume', 'stellar-volume');
  box.setAttribute('aria-labelledby', 'stellar-volume-title');
  const heading = el('h3', 'sv-heading', 'stellar-volume-title');
  const scales = el('div', 'sv-volume-scales');
  scales.setAttribute('role', 'group');
  const scaleButtons = VOLUME_SCALES_PC.map((pc) => {
    const b = el('button', 'sv-button sv-volume-scale');
    b.type = 'button';
    b.dataset['pc'] = String(pc);
    b.addEventListener('click', () => void setScale(pc));
    scales.append(b);
    return b;
  });
  const status = el('p', 'sv-note sv-volume-status', 'stellar-volume-status');
  status.setAttribute('aria-live', 'off');
  const filterLabel = el('label', 'sv-volume-label');
  filterLabel.htmlFor = 'stellar-volume-filter';
  const filterSelect = el(
    'select',
    'sv-volume-filter',
    'stellar-volume-filter'
  );
  const searchLabel = el('label', 'sv-volume-label');
  searchLabel.htmlFor = 'stellar-volume-search';
  const search = el('input', 'sv-volume-search', 'stellar-volume-search');
  search.type = 'search';
  search.autocomplete = 'off';
  const results = el(
    'ul',
    'sv-list sv-volume-results',
    'stellar-volume-results'
  );
  const filters = el('div', 'sv-volume-tools');
  filters.hidden = true;
  filters.append(filterLabel, filterSelect, searchLabel, search, results);
  const coverage = el('p', 'sv-note sv-volume-coverage');
  coverage.hidden = true;
  box.append(heading, scales, status, filters, coverage);
  host.side.prepend(box);

  const card = el('div', 'sv-card sv-volume-card', 'stellar-volume-card');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'stellar-volume-card-title');
  card.hidden = true;
  const cardTitle = el('h3', 'sv-heading', 'stellar-volume-card-title');
  const facts = el('dl', 'exo-facts');
  const notes = el('div', 'sv-notes');
  const exploreButton = el(
    'button',
    'sv-button sv-explore',
    'stellar-volume-explore'
  );
  exploreButton.type = 'button';
  exploreButton.hidden = true;
  card.append(cardTitle, facts, notes, exploreButton);
  host.systemCard.after(card);

  // ---- noms 2D : les cercles d'échelle du volume et l'étoile choisie, dans une couche à eux. La vue
  // reconstruit ses propres noms (`replaceChildren`, à l'ouverture et au changement de langue) : partager
  // son conteneur effaçait ceux-ci (constaté : le nom de l'étoile choisie avait disparu).
  const layer = el('div', 'sv-labels sv-volume-labels');
  layer.setAttribute('aria-hidden', 'true');
  host.labels.after(layer);
  const ringLabels = VOLUME_RINGS_PC.map((pc) => {
    const node = el('span', 'sv-label sv-label--ring');
    node.style.display = 'none';
    node.dataset['pc'] = String(pc);
    layer.append(node);
    return node;
  });
  const starLabel = el('span', 'sv-label sv-label--star sv-label--volume');
  starLabel.style.display = 'none';
  layer.append(starLabel);

  const url = (file: string): string => `${VOLUME_BASE}${file}`;

  /** Un fichier JSON d'un fournisseur ; `null` s'il est illisible (sa part manque, le reste tourne). */
  const optionalJson = <T>(file: string): Promise<T | null> =>
    fetcher(url(file), { signal: lifecycle.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .catch((error: unknown) => {
        if (!disposed) Logger.warn(`[stellarVolume] ${file} illisible`, error);
        return null;
      });

  /**
   * L'index des fournisseurs, puis les petits fichiers dont l'assemblage a besoin, SANS effet de bord :
   * une arrivée tardive après la fermeture ne crée rien. Un fournisseur désactivé n'est pas lu.
   */
  const loadManifest = (): Promise<VolumeManifest> =>
    (manifestRequest ??= fetcher(url('index.json'), {
      signal: lifecycle.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<VolumeIndex>;
      })
      .then(async (index) => {
        const P = index.providers;
        const on = (p: { enabled?: boolean }): boolean => p.enabled !== false;
        const [missing, hygComplement, nasa, crossmatch] = await Promise.all([
          on(P.gcnsMissing)
            ? optionalJson<MissingFile>(P.gcnsMissing.file)
            : null,
          on(P.hyg)
            ? optionalJson<HygComplementFile>(P.hyg.complement.file)
            : null,
          on(P.nasa) ? optionalJson<NasaHostsFile>(P.nasa.file) : null,
          optionalJson<CrossmatchFile>(index.crossmatch.structure.file),
        ]);
        if (disposed) throw new Error('vue fermée');
        const built = assembleVolume({
          index,
          gcns: on(P.gcns),
          missing,
          hygComplement,
          nasa,
          crossmatch,
        });
        if (built.missingParts.length > 0)
          Logger.warn(
            `[stellarVolume] fournisseurs absents : ${built.missingParts.join(', ')}`
          );
        assembly = built;
        hygNameFiles = on(P.hyg)
          ? { names: P.hyg.names.file, pairs: index.crossmatch.names.file }
          : null;
        manifest = built.manifest;
        return built.manifest;
      })
      .catch((error: unknown) => {
        // Un refus n'est pas retenu : le geste suivant réessaie.
        manifestRequest = null;
        throw error;
      }));

  /** La couche du volume dans la scène, créée par une intention vivante seulement. */
  const ensureVolume = (m: VolumeManifest): StellarVolume | null => {
    if (disposed) return null;
    if (!volume) {
      volume = new StellarVolume(m.flags, m.epochYear);
      volume.setYears(host.yearsFromJ2000());
      host.scene.scene.add(volume.group);
    }
    return volume;
  };

  const loadShell = (k: number, m: VolumeManifest): Promise<void> => {
    const known = shellLoads.get(k);
    if (known) return known.promise;
    const entry = m.shells[k]!;
    const built = assembly!;
    const file = built.gcnsShellFile(k);
    const controller = new AbortController();
    const record = {
      controller,
      done: false,
      promise: (file
        ? fetcher(url(file), { signal: controller.signal }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          })
        : Promise.resolve(null)
      )
        .then((buffer) => {
          // Une coquille arrivée est gardée (revenir à cette échelle sera immédiat) ; ce que la scène
          // en MONTRE reste décidé par l'intention courante (`setRadius`). L'assemblage y ajoute les
          // absentes de Gaia et les hôtes, et en retire les doublons du voisinage.
          if (disposed) return;
          ensureVolume(m)?.addShell(
            decodeShell(built.shellBuffer(k, buffer), m, entry)
          );
          record.done = true;
        })
        .catch((error: unknown) => {
          shellLoads.delete(k);
          throw error;
        }),
    };
    // Le rejet est suivi par l'intention qui attend ; celui d'un téléchargement que personne n'attend
    // plus (annulé) ne doit pas remonter comme une promesse rejetée non traitée.
    record.promise.catch(() => {});
    shellLoads.set(k, record);
    return record.promise;
  };

  /** Annule les téléchargements en cours dont la nouvelle intention n'a pas besoin. */
  const cancelUnneeded = (needed: readonly number[]): void => {
    for (const [k, load] of shellLoads) {
      if (load.done || needed.includes(k)) continue;
      load.controller.abort();
      shellLoads.delete(k);
    }
  };

  /**
   * Les noms : ceux que l'assemblage connaît déjà (absentes de Gaia, hôtes) et ceux de HYG, par la table
   * de correspondance de Galaxy. Un refus rend `null` (jamais retenu : le geste suivant relit).
   */
  const loadNames = (): Promise<Record<string, VolumeNameEntry> | null> =>
    (namesRequest ??= (async () => {
      const built =
        assembly ??
        (await loadManifest().then(
          () => assembly,
          () => null
        ));
      if (!built || disposed) {
        namesRequest = null;
        return null;
      }
      if (!hygNameFiles) {
        names = built.baseNames;
        return names;
      }
      const [hygNames, pairs] = await Promise.all([
        optionalJson<HygNamesFile>(hygNameFiles.names),
        optionalJson<CrossmatchNamesFile>(hygNameFiles.pairs),
      ]);
      if (!hygNames || !pairs) {
        namesRequest = null;
        return null;
      }
      const result = built.withHygNames(hygNames, pairs);
      names = result.names;
      namedByHyg = result.fromHyg;
      return names;
    })());

  /** Les détails d'une étoile ; un refus rend `failed` (jamais retenu : un nouveau choix réessaie). */
  const loadDetail = async (
    index: number
  ): Promise<{ detail: VolumeDetail | null; failed: boolean }> => {
    const m = manifest;
    const source = assembly?.detailSource(index) ?? null;
    if (!m || !source) return { detail: null, failed: true };
    if (source.kind === 'known')
      return { detail: source.detail, failed: false };
    let buffer = details.get(source.file);
    if (!buffer) {
      try {
        const res = await fetcher(url(source.file), {
          signal: lifecycle.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffer = await res.arrayBuffer();
        details.set(source.file, buffer);
      } catch (error: unknown) {
        if (!disposed) Logger.warn('[stellarVolume] détails illisibles', error);
        return { detail: null, failed: true };
      }
    }
    return {
      detail: decodeDetail(buffer, source.local, m.detailBytes),
      failed: false,
    };
  };

  const radiusOf = (s: VolumeScale): number => s;

  /** Le nom affiché d'une étoile du volume : nom du catalogue, sinon « Gaia DR3 n », sinon un repère. */
  const nameOf = (index: number): string => {
    const entry = names?.[String(index)];
    if (entry) return entry[0];
    if (detail?.sourceId && selected === index)
      return t('vol.gaiaName', { id: detail.sourceId });
    return t('vol.unnamed', { n: String(index) });
  };

  const renderStatus = (state: 'idle' | 'loading' | 'failed'): void => {
    for (const b of scaleButtons) {
      const pc = Number(b.dataset['pc']) as VolumeScale;
      b.textContent = t('vol.scaleButton', { pc: String(pc) });
      b.setAttribute(
        'aria-label',
        t('vol.scaleLabel', {
          pc: String(pc),
          ly: fixed(parsecsToLightYears(pc), 0),
        })
      );
      b.setAttribute('aria-pressed', String(pc === scale));
    }
    box.dataset['state'] = state;
    box.dataset['scale'] = String(scale);
    if (state === 'loading')
      status.textContent = t('vol.loading', { pc: String(scale) });
    else if (state === 'failed')
      status.textContent = t('vol.failed', { pc: String(scale) });
    else if (scale === 5) status.textContent = t('vol.neighbourhoodOnly');
    else
      status.textContent = t('vol.loaded', {
        count: new Intl.NumberFormat(getLocale()).format(
          volume?.visibleCount ?? 0
        ),
        pc: String(scale),
      });
    filters.hidden = scale === 5;
    coverage.hidden = scale === 5;
  };

  const renderTexts = (): void => {
    heading.textContent = t('vol.heading');
    filterLabel.textContent = t('vol.filter');
    filterSelect.replaceChildren(
      ...VOLUME_FILTERS.map((f) => {
        const o = el('option');
        o.value = f;
        o.textContent = t(`vol.filter.${f}`);
        o.selected = f === filter;
        return o;
      })
    );
    searchLabel.textContent = t('vol.search');
    search.placeholder = t('vol.searchPlaceholder');
    coverage.textContent = t('vol.coverage');
    exploreButton.textContent = t('sx.open');
    VOLUME_RINGS_PC.forEach((pc, k) => {
      ringLabels[k]!.textContent = t('st.ring', {
        pc: String(pc),
        ly: fixed(parsecsToLightYears(pc), 0),
      });
    });
    renderStatus(box.dataset['state'] === 'loading' ? 'loading' : 'idle');
    renderCard();
  };

  /** L'étoile choisie est-elle montrée à cette échelle ? */
  const shownAt = (index: number, radiusPc: number): boolean => {
    const at = volume?.shellOf(index);
    return !!at && at.shell.maxPc <= radiusPc;
  };

  /** Retire le choix d'une étoile du volume : sélection, fiche, nom et adresse ensemble. */
  const dropSelection = (): void => {
    if (selected < 0) return;
    selected = -1;
    detail = null;
    detailFailed = false;
    volume?.select(-1);
    renderCard();
  };

  /**
   * Change d'échelle pour l'intention `token` : charge les coquilles nécessaires (en partageant celles qui
   * sont déjà en route), annule celles dont plus personne n'a besoin, cadre. Une étoile choisie qui n'est
   * plus montrée à la nouvelle échelle est retirée (scène, fiche, nom, adresse).
   */
  const setScaleFor = async (
    next: VolumeScale,
    token: number
  ): Promise<boolean> => {
    if (!owns(token)) return false;
    const previous = scale;
    scale = next;
    host.controls.maxDistance = Math.max(
      host.scene.extentPc * 6,
      radiusOf(next) * 3.2
    );
    if (host.scene.camera.far < radiusOf(next) * 8) {
      host.scene.camera.far = radiusOf(next) * 8;
      host.scene.camera.updateProjectionMatrix();
    }
    host.frameOn(
      [0, 0, 0],
      next === 5 ? host.scene.extentPc * 2.1 : radiusOf(next) * 2.1
    );
    if (next === 5) {
      cancelUnneeded([]);
      volume?.setRadius(5);
      dropSelection();
      renderStatus('idle');
      host.syncAddress();
      host.layout();
      return true;
    }
    if (manifest) cancelUnneeded(shellsFor(radiusOf(next), manifest));
    if (selected >= 0 && !shownAt(selected, radiusOf(next))) dropSelection();
    renderStatus('loading');
    host.layout();
    try {
      const m = await loadManifest();
      if (!owns(token)) return false;
      const needed = shellsFor(radiusOf(next), m);
      cancelUnneeded(needed);
      if (!ensureVolume(m)) return false;
      for (const k of needed) {
        await loadShell(k, m);
        if (!owns(token)) return false;
        // Chaque coquille arrivée se montre tout de suite : la plus proche d'abord.
        volume?.setRadius(Math.min(radiusOf(next), m.shells[k]!.maxPc));
      }
      volume?.setRadius(radiusOf(next));
      volume?.setFilter(filter);
      renderStatus('idle');
      getAnnouncer().announce(status.textContent ?? '');
      host.syncAddress();
      host.layout();
      return true;
    } catch (error: unknown) {
      if (!owns(token)) return false;
      Logger.warn('[stellarVolume] coquille illisible', error);
      // L'échelle revient à la plus grande coquille réellement posée.
      const loaded = volume?.loadedShells ?? [];
      const reached = (
        loaded.length
          ? (VOLUME_SCALES_PC.filter(
              (pc) => pc <= loaded[loaded.length - 1]!.maxPc
            ).pop() ?? 5)
          : 5
      ) as VolumeScale;
      scale = reached === next ? previous : reached;
      volume?.setRadius(radiusOf(scale));
      if (selected >= 0 && !shownAt(selected, radiusOf(scale))) dropSelection();
      renderStatus('failed');
      getAnnouncer().announce(status.textContent ?? '');
      host.syncAddress();
      host.layout();
      return false;
    }
  };
  const setScale = (next: VolumeScale): Promise<boolean> =>
    setScaleFor(next, ++intent);

  // ---- la fiche
  function renderCard(): void {
    if (selected < 0 || !volume) {
      card.hidden = true;
      host.systemCard.hidden = false;
      return;
    }
    const at = volume.shellOf(selected);
    if (!at) return;
    const { shell, local } = at;
    const flags = manifest!.flags;
    const f = shell.flags[local]!;
    card.hidden = false;
    host.systemCard.hidden = true;
    cardTitle.textContent = nameOf(selected);
    const d = epochDistancePc(shell, local);
    const ly = parsecsToLightYears(d);
    const rows: HTMLElement[] = [];
    // Distance : la médiane du GCNS et son intervalle, ou 1/parallaxe d'Hipparcos ou de SIMBAD, dite telle.
    let distanceText: string;
    if (f & flags.hyg)
      distanceText = t('vol.distanceHyg', {
        pc: fixed(d, 2),
        ly: fixed(ly, 1),
      });
    else if (f & flags.simbadOnly)
      distanceText = t('vol.distanceSimbad', {
        pc: fixed(d, 2),
        ly: fixed(ly, 1),
      });
    else if (detail?.distanceBelowPc != null && detail.distanceAbovePc != null)
      distanceText = t('vol.distanceGcns', {
        pc: fixed(d, 2),
        ly: fixed(ly, 1),
        lo: fixed(d - detail.distanceBelowPc, 2),
        hi: fixed(d + detail.distanceAbovePc, 2),
      });
    else {
      const rel = relativeDistanceErrorOf(shell, local);
      distanceText =
        rel === null
          ? t('vol.distancePlain', { pc: fixed(d, 2), ly: fixed(ly, 1) })
          : t('vol.distanceRel', {
              pc: fixed(d, 2),
              ly: fixed(ly, 1),
              pct: fixed(rel * 100, 1),
            });
    }
    rows.push(...fact(t('st.distSun'), distanceText));
    const p = volume.positionOf(selected)!;
    rows.push(
      ...fact(
        t('st.distAtDate'),
        t('nb.card.distanceValue', {
          ly: fixed(parsecsToLightYears(distanceFromSunPc(p)), 2),
        })
      )
    );
    const galactic = [p[0], -p[2], p[1]] as const;
    rows.push(
      ...fact(
        t('st.position'),
        t('st.positionValue', {
          x: fixed(galactic[0], 2),
          y: fixed(galactic[1], 2),
          z: fixed(galactic[2], 2),
        })
      )
    );
    const mag = magnitudeOf(shell, local);
    rows.push(
      ...fact(
        t('vol.magnitude'),
        mag === null
          ? t('vol.notPublished')
          : t(f & flags.hyg ? 'vol.magV' : 'vol.magG', { m: fixed(mag, 1) })
      )
    );
    if (mag !== null)
      rows.push(
        ...fact(
          t('vol.absMagnitude'),
          t('vol.absMagValue', { m: fixed(absoluteMagnitude(mag, d), 1) })
        )
      );
    const colour = colourIndexOf(shell, local, flags);
    rows.push(
      ...fact(
        t('vol.colour'),
        colour === null
          ? t('vol.notPublished')
          : t(colour.kind === 'b-v' ? 'vol.colourBV' : 'vol.colourBpRp', {
              c: fixed(colour.value, 2),
            })
      )
    );
    const spectral = spectralOf(names?.[String(selected)]);
    rows.push(
      ...fact(t('nb.card.spectral'), spectral ?? t('vol.notPublished'))
    );
    if (detail?.parallaxMas != null)
      rows.push(
        ...fact(
          t('vol.parallax'),
          detail.parallaxErrorMas != null
            ? t('vol.parallaxValue', {
                p: number(detail.parallaxMas, 6),
                e: number(detail.parallaxErrorMas, 2),
              })
            : t('vol.parallaxPlain', { p: number(detail.parallaxMas, 5) })
        )
      );
    // La vitesse : tangentielle calculée du mouvement propre, radiale publiée (ou absente, dite).
    if (!(f & flags.simbadOnly)) {
      const v = shell.velocities;
      const k = local * 3;
      const r = [
        p[0] / distanceFromSunPc(p),
        p[1] / distanceFromSunPc(p),
        p[2] / distanceFromSunPc(p),
      ];
      const vr = v[k]! * r[0]! + v[k + 1]! * r[1]! + v[k + 2]! * r[2]!;
      const vt = Math.hypot(
        v[k]! - vr * r[0]!,
        v[k + 1]! - vr * r[1]!,
        v[k + 2]! - vr * r[2]!
      );
      const kms = (pcPerYear: number): number =>
        pcPerYear / (31_557_600 / 3.085677581491367e13);
      rows.push(
        ...fact(
          t('vol.tangential'),
          t('vol.tangentialValue', { v: fixed(kms(vt), 1) })
        )
      );
      rows.push(
        ...fact(
          t('vol.radial'),
          f & flags.radialVelocity
            ? detail?.radialVelocityErrorKms != null
              ? t('vol.radialValue', {
                  v: fixed(kms(vr), 1),
                  e: fixed(detail.radialVelocityErrorKms, 1),
                })
              : t('vol.radialPlain', { v: fixed(kms(vr), 1) })
            : t('vol.notPublished')
        )
      );
    }
    if (detail?.ruwe != null)
      rows.push(
        ...fact(
          t('vol.quality'),
          t('vol.qualityValue', {
            ruwe: fixed(detail.ruwe, 2),
            p:
              detail.astrometryProbability != null
                ? fixed(detail.astrometryProbability * 100, 0)
                : '?',
          })
        )
      );
    if (
      detail?.whiteDwarfProbability != null &&
      detail.whiteDwarfProbability >= 0.05
    )
      rows.push(
        ...fact(
          t('vol.whiteDwarf'),
          t('vol.whiteDwarfValue', {
            p: fixed(detail.whiteDwarfProbability * 100, 0),
          })
        )
      );
    const exo = hostOf(names?.[String(selected)]);
    const hostName = exo?.host ?? null;
    if (exo)
      rows.push(
        ...fact(
          t('vol.exoplanets'),
          t('vol.exoplanetsValue', {
            count: String(exo.planets),
            host: exo.host,
          })
        )
      );
    facts.replaceChildren(...rows);
    exploreButton.hidden = !(hostName && host.openSystem);
    exploreButton.dataset['host'] = hostName ?? '';
    const lines = [
      f & flags.hyg
        ? t('vol.origin.hyg')
        : f & flags.simbadOnly
          ? t('vol.origin.simbad')
          : t('vol.origin.gcns', { id: detail?.sourceId ?? '…' }),
    ];
    // Un nom venu de HYG garde sa source et SA licence, distincte de celle du GCNS.
    if (namedByHyg.has(selected)) lines.push(t('vol.nameHyg'));
    if (!(f & flags.radialVelocity) && !(f & flags.simbadOnly))
      lines.push(t('vol.noRadial'));
    if (f & flags.simbadOnly) lines.push(t('vol.noMotion'));
    if (detailFailed) lines.push(t('vol.dataUnavailable'));
    lines.push(t('vol.symbolic'));
    notes.replaceChildren(
      ...lines.map((line) => {
        const node = el('p', 'sv-note');
        node.textContent = line;
        return node;
      })
    );
  }
  exploreButton.addEventListener('click', () => {
    const name = exploreButton.dataset['host'];
    if (name) host.openSystem?.(name);
  });

  const selectFor = async (
    index: number,
    announce: boolean,
    token: number
  ): Promise<void> => {
    if (!owns(token)) return;
    selected = index;
    detail = null;
    detailFailed = false;
    volume?.select(index);
    if (index >= 0) host.deselectSystem();
    renderCard();
    host.layout();
    host.syncAddress();
    if (index < 0) return;
    const [, d] = await Promise.all([loadNames(), loadDetail(index)]);
    if (!owns(token) || selected !== index) return;
    detail = d.detail;
    detailFailed = d.failed;
    renderCard();
    host.syncAddress();
    if (announce) {
      const at = volume?.shellOf(index);
      const ly = at
        ? parsecsToLightYears(epochDistancePc(at.shell, at.local))
        : 0;
      getAnnouncer().announce(
        t('st.selectedAnnounce', { name: nameOf(index), ly: fixed(ly, 1) })
      );
    }
  };
  const select = (index: number, announce = true): Promise<void> =>
    selectFor(index, announce, ++intent);

  // ---- recherche par nom
  let searchAt = 0;
  const renderResults = (): void => {
    const q = search.value;
    if (!names || q.trim().length < 2) {
      results.replaceChildren();
      return;
    }
    const loadedEnd =
      volume?.loadedShells.reduce(
        (end, s) => Math.max(end, s.start + s.count),
        0
      ) ?? 0;
    const hits = searchNames(names, q, 12);
    if (!hits.length) {
      const li = el('li', 'sv-note');
      li.textContent = t('vol.searchNone');
      results.replaceChildren(li);
      return;
    }
    results.replaceChildren(
      ...hits.map((index) => {
        const li = el('li');
        const b = el('button', 'sv-star');
        b.type = 'button';
        b.dataset['index'] = String(index);
        b.textContent = names![String(index)]![0];
        b.addEventListener('click', () => void focusStar(index));
        if (index >= loadedEnd) b.dataset['farther'] = '1';
        li.append(b);
        return li;
      })
    );
  };
  const showNamesFailure = (): void => {
    const li = el('li', 'sv-note');
    li.textContent = t('vol.dataUnavailable');
    results.replaceChildren(li);
  };
  search.addEventListener(
    'focus',
    () =>
      void loadNames().then((n) => {
        if (disposed) return;
        if (n) renderResults();
        else if (search.value.trim().length >= 2) showNamesFailure();
      })
  );
  search.addEventListener('input', () => {
    const mine = ++searchAt;
    void loadNames().then((n) => {
      if (disposed || mine !== searchAt) return;
      if (n) renderResults();
      else showNamesFailure();
    });
  });

  /** Choisit une étoile par son rang : charge l'échelle qui la contient, la sélectionne, la cadre. */
  const focusStarFor = async (index: number, token: number): Promise<void> => {
    let m = manifest;
    if (!m) {
      try {
        m = await loadManifest();
      } catch {
        if (!owns(token)) return;
        renderStatus('failed');
        getAnnouncer().announce(status.textContent ?? '');
        return;
      }
    }
    if (!owns(token)) return;
    const shellIndex = m.shells.findIndex(
      (s) => index >= s.start && index < s.start + s.count
    );
    if (shellIndex < 0) return;
    const need =
      VOLUME_SCALES_PC.find((pc) => pc >= m.shells[shellIndex]!.maxPc) ?? 100;
    if (scale < need && !(await setScaleFor(need, token))) return;
    if (!owns(token)) return;
    if (filter !== 'all') {
      filter = 'all';
      filterSelect.value = 'all';
      volume?.setFilter('all');
    }
    await selectFor(index, true, token);
    if (!owns(token)) return;
    const p = volume?.positionOf(index);
    if (p) host.frameOn(p, Math.max(2, distanceFromSunPc(p) * 0.35));
  };
  const focusStar = (index: number): Promise<void> =>
    focusStarFor(index, ++intent);

  filterSelect.addEventListener('change', () => {
    filter = filterSelect.value as VolumeFilter;
    volume?.setFilter(filter);
    if (selected >= 0) {
      const at = volume?.shellOf(selected);
      const f = at ? at.shell.flags[at.local]! : 0;
      const m = manifest!;
      const keep =
        filter === 'all' ||
        (filter === 'whiteDwarfs' && f & m.flags.whiteDwarf) ||
        (filter === 'exoplanetHosts' && f & m.flags.exoplanetHost) ||
        (filter === 'radialVelocity' && f & m.flags.radialVelocity);
      if (!keep) void select(-1);
    }
  });

  renderTexts();

  return {
    get scale() {
      return scale;
    },
    pick(x, y, width, height, radiusPx) {
      if (!volume || scale === 5) return -1;
      host.scene.camera.updateMatrixWorld();
      return (
        volume.pick(host.scene.camera, x, y, width, height, radiusPx)?.index ??
        -1
      );
    },
    select,
    clearSelection() {
      // Choisir une voisine est une intention : un lien encore en chargement ne la remplacera pas.
      intent++;
      dropSelection();
    },
    setYears(years) {
      volume?.setYears(years);
      if (selected >= 0) renderCard();
    },
    setScale,
    frame(width, height) {
      if (!volume) return;
      volume.setPixelRatio(host.renderer.getPixelRatio());
      // Ce que la scène TRACE, publié à chaque image (comme `data-scene-moving`) : une coquille arrivée
      // après qu'on a changé d'échelle se verrait ici, même si l'échelle affichée et l'adresse disent juste.
      const shown = String(volume.visibleCount);
      if (box.dataset['visible'] !== shown) box.dataset['visible'] = shown;
      VOLUME_RINGS_PC.forEach((pc, k) => {
        const node = ringLabels[k]!;
        const s =
          pc <= scale
            ? host.scene.projectVector(
                new THREE.Vector3(0, 0, pc),
                width,
                height
              )
            : null;
        if (!s || s.x < 0 || s.x > width || s.y < 0 || s.y > height) {
          node.style.display = 'none';
          return;
        }
        node.style.display = '';
        node.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y - 8)}px)`;
      });
      const p = selected >= 0 ? volume.positionOf(selected) : null;
      const s = p
        ? host.scene.projectVector(new THREE.Vector3(...p), width, height)
        : null;
      if (!s || s.x < 0 || s.x > width || s.y < 0 || s.y > height) {
        starLabel.style.display = 'none';
      } else {
        starLabel.textContent = nameOf(selected);
        starLabel.style.display = '';
        starLabel.style.transform = `translate(${Math.round(s.x + 10)}px, ${Math.round(s.y - 8)}px)`;
        starLabel.dataset['sx'] = String(Math.round(s.x));
        starLabel.dataset['sy'] = String(Math.round(s.y));
      }
    },
    address() {
      const out: VolumeAddress = {};
      if (scale !== 5) out.vol = scale;
      if (selected >= 0) {
        const entry = names?.[String(selected)];
        const check = detail?.sourceId ?? (entry ? starSlug(entry[0]) : null);
        if (check) out.vstar = volumeStarToken(selected, check);
      }
      return out;
    },
    async applyAddress(address) {
      // Une adresse (lien, Retour, Suivant) est une intention comme une autre : un geste plus récent la
      // remplace, même au milieu de son chargement.
      const token = ++intent;
      const wanted = (VOLUME_SCALES_PC as readonly number[]).includes(
        address.vol ?? 5
      )
        ? ((address.vol ?? 5) as VolumeScale)
        : 5;
      if (wanted !== scale) await setScaleFor(wanted, token);
      if (!owns(token)) return;
      if (!address.vstar) {
        if (selected >= 0) await selectFor(-1, false, token);
        return;
      }
      const star = parseVolumeStarToken(address.vstar);
      const m = manifest ?? (await loadManifest().catch(() => null));
      if (!owns(token)) return;
      if (!star || !m || star.index >= m.count) {
        getAnnouncer().announce(t('vol.unknownStar'));
        return;
      }
      // Le rang est vérifié par l'identifiant Gaia ou le nom qu'il porte : un fichier regénéré ne
      // désigne jamais une AUTRE étoile en silence.
      const [n, d] = await Promise.all([loadNames(), loadDetail(star.index)]);
      if (!owns(token)) return;
      const entry = n?.[String(star.index)];
      const ok =
        (d.detail?.sourceId != null && d.detail.sourceId === star.check) ||
        (entry != null && starSlug(entry[0]) === star.check);
      if (!ok) {
        getAnnouncer().announce(
          t(d.failed && !entry ? 'vol.dataUnavailable' : 'vol.unknownStar')
        );
        host.syncAddress();
        return;
      }
      await focusStarFor(star.index, token);
    },
    rerender: renderTexts,
    dispose() {
      disposed = true;
      intent++;
      lifecycle.abort();
      for (const load of shellLoads.values()) load.controller.abort();
      shellLoads.clear();
      volume?.dispose();
      volume = null;
      box.remove();
      card.remove();
      layer.remove();
    },
  };
}
