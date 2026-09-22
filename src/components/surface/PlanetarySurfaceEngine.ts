/**
 * MOTEUR D'IMAGERIE DE SURFACE — le quadtree, le budget et les chargements annulables
 * (lot 9, phase 9C). Aucune hauteur : la phase 9D s'en charge, et le plan interdit d'employer
 * une image de relief comme géométrie.
 *
 * Il ne connaît AUCUN nom de corps, aucun gabarit et aucun niveau : tout vient de la fiche
 * (`config/surfaceTilesets.ts` → `src/registry/products/tilesets/*.json`). C'est le test de la
 * décision 3 du plan, que la phase 9E rejouera en ajoutant Mars par une fiche seule.
 *
 * Trois propriétés qui ne sont pas des détails :
 *
 *  - **il prend la caméra qu'on lui passe**, jamais `CameraSystem` : `AnimationSystem` n'appelle
 *    pas `CameraSystem.update()` pendant une session WebXR, et un moteur qui en dépendrait s'y
 *    figerait ;
 *  - **il annule ce qu'il a demandé** dès qu'un carreau sort du champ ou que la cible change
 *    (`AbortController`), parce qu'un vol d'approche traverse des dizaines de cadrages et que
 *    Trek ne publie aucune limite de débit ;
 *  - **éteint, il ne demande rien du tout** : `attach` n'est appelé que par la couche UI, et
 *    `detach` annule la file avant de détruire les carreaux.
 *
 * DEUX DÉFAUTS MESURÉS le 2026-09-21, corrigés ici, et tous deux invisibles à la relecture :
 *
 *  1. **une boucle de rétroaction entre le plancher d'approche et le niveau servi.** La finesse
 *     déclarée au corps venait du niveau COURAMMENT peint : les carreaux arrivent, le plancher
 *     descend, la caméra descend, le niveau monte, les carreaux du niveau précédent sont jetés,
 *     la finesse retombe à zéro, le plancher remonte et repousse la caméra. Mesuré : altitude
 *     alternant entre 128,0 et 32,0 km à chaque image, et 47 tuiles redemandées par seconde,
 *     indéfiniment. La finesse déclarée est donc celle du niveau MAXIMAL de la fiche, qui ne
 *     dépend d'aucune image : « jusqu'où puis-je descendre » est une propriété de la SOURCE,
 *     pas de l'image courante ;
 *  2. **le changement de niveau vidait tout d'un coup.** Le sol disparaissait le temps du
 *     rechargement, et chaque aller-retour de niveau redemandait la couverture entière. Les
 *     carreaux d'un autre niveau sont maintenant retirés SEULEMENT quand le nouveau niveau est
 *     complet.
 */
import * as THREE from 'three';

import {
  coverageTileCount,
  groundResolutionKm,
  levelForGroundResolution,
  oversamplingFactor,
  pyramidWidthPx,
  tileBounds,
  tileIndexAt,
  tileMatrix,
  tilesCovering,
  type TileIndex,
} from '@/core/tilePyramid';
import { tileUrl } from '@/core/tileUrl';
import { screenPixelsPerKm } from '@/core/surfaceApproach';
import {
  heightTileFor,
  heightWindow,
  patchSegments,
  type HeightCoverageEntry,
} from '@/core/heightPyramid';
import {
  decodeHeightTile,
  heightMetresAt,
  type HeightTile,
} from '@/core/heightTile';
import type { PatchHeights } from '@/core/tilePatch';
import type { SurfaceTileset } from '@/config/surfaceTilesets';
import {
  heightTilePath,
  type HeightManifest,
  type SurfaceHeightSet,
} from '@/config/surfaceHeights';
import Logger from '@/utils/Logger';

import { SurfaceTile } from './SurfaceTile';

/** Ce que le moteur demande d'un corps. Plus petit qu'un `CelestialObject`, et c'est écrit. */
export interface SurfaceHost {
  readonly name: string;
  /** Rayon LOCAL des couches, avant le facteur d'échelle de scène. */
  readonly layerRadius: number;
  readonly group: THREE.Object3D;
  attachSpinningChild(object: THREE.Object3D): void;
  createSurfaceOverlayMaterial(): THREE.Material;
  releaseSurfaceOverlayMaterial(material: THREE.Material): void;
  worldPointToGeographic(worldPoint: THREE.Vector3): {
    latitudeDeg: number;
    longitudeDeg: number;
  };
  setStreamedImageryWidth(widthPx: number): boolean;
  /** Finesse de la texture LIVRÉE du corps, en pixels sur 360°. */
  shippedSurfaceWidthPx(): number;
  /**
   * Met la sphère LIVRÉE du corps à une fraction de son rayon, ou la rétablit (1).
   *
   * C'est ce qui permet au relief de se voir : les hauteurs sont rapportées au rayon de
   * référence du modèle d'élévation, et la moitié de la Lune est SOUS ce rayon (les mers
   * descendent à 2 ou 3 km en dessous, le minimum mesuré est à 9,1 km). La sphère livrée
   * masquerait donc tous les fonds. On la descend au minimum MESURÉ du jeu de hauteurs :
   * elle reste une borne inférieure de la surface réelle, elle ne montre jamais rien que la
   * donnée ne porte pas, et elle est rétablie dès que le relief se retire.
   */
  setSurfaceShellScale(factor: number): void;
}

/** Un jeu de hauteurs prêt à l'emploi : la fiche, et son manifeste déjà lu. */
export interface AttachedHeights {
  set: SurfaceHeightSet;
  manifest: HeightManifest;
}

/** Budget d'un profil de qualité : « ne pas charger » vaut mieux que « charger puis optimiser ». */
export interface TileBudget {
  /** Carreaux du niveau courant affichés au plus. */
  maxTiles: number;
  /** Requêtes simultanées vers le service. */
  maxConcurrentLoads: number;
}

/** Ce que le bandeau de provenance affiche, et ce que l'e2e mesure. */
export interface SurfaceImageryState {
  body: string;
  tilesetId: string;
  title: string;
  mission: string;
  instrument: string;
  credit: string;
  /** Niveau réellement servi. */
  level: number;
  /** Finesse servie, en mètres par pixel au sol à l'équateur. */
  groundResolutionM: number;
  /** Largeur de la mosaïque à ce niveau, en pixels sur 360°. */
  widthPx: number;
  /** > 1 : le niveau agrandit la mosaïque publiée. */
  oversampling: number;
  /** Carreaux demandés et carreaux effectivement peints, au niveau courant. */
  requested: number;
  painted: number;
  /** Carreaux posés TOUS niveaux confondus : plus grand que `painted` pendant un changement. */
  attached: number;
  /** Intervalle décrit par la mosaïque. */
  acquired: { from: number; to: number };
  publishedPixelsPerDegree: number;
  /** Relief RÉELLEMENT posé sous les carreaux peints, ou `null` s'il n'y en a pas. */
  relief: SurfaceReliefState | null;
}

/** Ce que le bandeau dit du relief, quand il y en a un sous les carreaux peints. */
export interface SurfaceReliefState {
  setId: string;
  title: string;
  credit: string;
  /** Niveau de hauteurs servi (le plus fin employé par les carreaux peints). */
  level: number;
  /** Finesse des hauteurs servies, en mètres au sol à l'équateur. */
  groundResolutionM: number;
  /** Nom publié de l'aire, quand le relief vient d'une aire nommée. */
  areaName: string | null;
  /** Intervalle d'acquisition du modèle d'élévation. */
  acquired: { from: number; to: number };
  /**
   * Altitude MESURÉE du sol sous la caméra, en mètres au-dessus du rayon de référence, ou
   * `null` si la tuile qui la porte n'est pas encore là.
   *
   * Ce n'est pas une décoration : le plancher d'approche est une altitude au-dessus du RAYON DE
   * RÉFÉRENCE, pas au-dessus du sol. Au-dessus d'un massif, la caméra descend donc plus près du
   * sol que le plancher ne le laisse croire, et `?debug-surface` doit pouvoir le dire.
   */
  groundElevationM: number | null;
}

/**
 * Le moteur ne travaille qu'une fois la cible assez grosse à l'écran. 6 rayons apparents :
 * au-delà, l'image livrée du corps suffit largement et un carreau ne couvrirait que quelques
 * pixels. C'est aussi ce qui garantit que survoler un corps de loin ne demande rien.
 */
export const TILE_ENGINE_ENTER_RADII = 6;

/**
 * Segments du maillage d'un carreau PORTANT DU RELIEF. 32 par côté, soit 2 048 triangles par
 * carreau et 131 072 pour une couverture de 64 : les sommets tombent alors exactement sur des
 * échantillons de hauteur (division par puissance de deux), donc deux carreaux voisins gardent
 * le même bord et aucune hauteur n'est interpolée.
 */
export const MAX_TILE_SEGMENTS = 32;

/**
 * Tuiles de hauteurs gardées en mémoire au plus. Une vue en emploie de une à quatre (une tuile
 * de socle couvre 256 carreaux du niveau 8), et chacune pèse 132 Ko : 32 plafonnent le cache à
 * environ 4 Mo tout en couvrant largement les allers-retours d'une descente.
 */
const MAX_CACHED_HEIGHT_TILES = 32;

/** Récupération d'une tuile : isolée pour que les tests puissent la remplacer. */
export type TileFetcher = (
  url: string,
  signal: AbortSignal
) => Promise<ImageBitmap>;

/** Récupération d'une tuile de hauteurs : isolée pour la même raison. */
export type HeightFetcher = (
  url: string,
  signal: AbortSignal
) => Promise<ArrayBuffer>;

const defaultFetcher: TileFetcher = async (url, signal) => {
  const response = await fetch(url, {
    signal,
    mode: 'cors',
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`tuile ${response.status} : ${url}`);
  }
  // `imageOrientation: 'flipY'` n'est PAS cosmétique : Three.js ignore `Texture.flipY` pour un
  // ImageBitmap (l'orientation doit être décidée à la création, pas à l'envoi au GPU). Sans
  // cela le carreau afficherait son image tête en bas, donc le mauvais hémisphère, sans la
  // moindre erreur.
  return createImageBitmap(await response.blob(), {
    imageOrientation: 'flipY',
  });
};

const defaultHeightFetcher: HeightFetcher = async (url, signal) => {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`hauteurs ${response.status} : ${url}`);
  }
  return response.arrayBuffer();
};

export class PlanetarySurfaceEngine {
  private _host: SurfaceHost | null = null;
  private _tileset: SurfaceTileset | null = null;
  private _radiusKm = 0;

  private readonly _tiles = new Map<string, SurfaceTile>();
  private readonly _pending = new Map<string, AbortController>();
  private readonly _queue: TileIndex[] = [];
  private readonly _failed = new Set<string>();

  private _state: SurfaceImageryState | null = null;

  /** Jeu de hauteurs attaché, s'il y en a un pour ce corps. */
  private _heights: AttachedHeights | null = null;
  private readonly _heightTiles = new Map<string, HeightTile>();
  private readonly _heightPending = new Map<string, Promise<HeightTile>>();
  private readonly _heightFailed = new Set<string>();
  /**
   * Les tuiles de hauteurs sont PARTAGÉES par des dizaines de carreaux d'imagerie (une tuile de
   * socle couvre 256 carreaux au niveau 8). Leur annulation ne peut donc pas suivre celle d'un
   * carreau : elle suit l'attachement.
   */
  private _heightAbort: AbortController | null = null;
  private _shellScaled = false;
  /** Relief effectivement posé, par carreau peint : ce que le bandeau publie. */
  private readonly _relief = new Map<
    string,
    { level: number; entry: HeightCoverageEntry }
  >();

  private readonly _budget: TileBudget;
  private readonly _fetchTile: TileFetcher;
  private readonly _fetchHeights: HeightFetcher;
  private readonly _onState: (state: SurfaceImageryState | null) => void;
  private readonly _onImageryWidthChanged: () => void;

  private readonly _cameraLocal = new THREE.Vector3();
  private readonly _bodyWorld = new THREE.Vector3();

  constructor(options: {
    budget: TileBudget;
    onState?: (state: SurfaceImageryState | null) => void;
    onImageryWidthChanged?: () => void;
    fetchTile?: TileFetcher;
    fetchHeights?: HeightFetcher;
  }) {
    this._budget = options.budget;
    this._fetchTile = options.fetchTile ?? defaultFetcher;
    this._fetchHeights = options.fetchHeights ?? defaultHeightFetcher;
    this._onState = options.onState ?? (() => undefined);
    this._onImageryWidthChanged =
      options.onImageryWidthChanged ?? (() => undefined);
  }

  get state(): SurfaceImageryState | null {
    return this._state;
  }

  /** Corps couvert aujourd'hui, ou `null`. */
  get attachedBody(): string | null {
    return this._host?.name ?? null;
  }

  attach(
    host: SurfaceHost,
    tileset: SurfaceTileset,
    radiusKm: number,
    heights: AttachedHeights | null = null
  ): void {
    if (
      this._host === host &&
      this._tileset === tileset &&
      this._heights?.set === heights?.set
    )
      return;
    this.detach();
    this._host = host;
    this._tileset = tileset;
    this._radiusKm = radiusKm;
    this._heights = heights;
    this._heightAbort = heights ? new AbortController() : null;
  }

  /**
   * Déclare au corps, UNE FOIS et pour de bon, la finesse que la source rend atteignable.
   *
   * Deux règles, chacune payée par une mesure :
   *  - c'est le niveau MAXIMAL de la fiche, pas celui peint à cette image, sinon plancher et
   *    niveau s'entraînent l'un l'autre (défaut 1 du docblock de tête) ;
   *  - mais seulement APRÈS qu'un carreau a été peint pour de bon. Annoncer la descente sur la
   *    foi d'une fiche laisserait un visiteur hors ligne, ou face à un service en panne,
   *    descendre seize fois plus bas que ce que son écran peut montrer : à 8 km d'altitude, la
   *    texture 8k livrée vaut 1 024 pixels d'écran par texel, c'est-à-dire du gris uniforme
   *    (relevé de la phase 9B).
   *
   * Le verrou ne se relâche qu'au détachement, ce qui le rend MONOTONE : une tuile qui
   * disparaît du champ ne referme pas le plancher sous la caméra.
   */
  private _declareImageryWidth(): void {
    const host = this._host;
    const tileset = this._tileset;
    if (!host || !tileset || this._tiles.size === 0) return;
    if (
      host.setStreamedImageryWidth(
        pyramidWidthPx(tileset.maxLevel, tileset.matrix)
      )
    )
      this._onImageryWidthChanged();
  }

  /** Vide tout : requêtes en vol, carreaux, état, et la finesse déclarée au corps. */
  detach(): void {
    const host = this._host;
    this._dropEverything();
    this._heightAbort?.abort();
    this._heightAbort = null;
    this._heights = null;
    this._heightTiles.clear();
    this._heightPending.clear();
    this._heightFailed.clear();
    this._host = null;
    this._tileset = null;
    this._radiusKm = 0;
    if (host?.setStreamedImageryWidth(0)) this._onImageryWidthChanged();
    if (this._state !== null) {
      this._state = null;
      this._onState(null);
    }
  }

  dispose(): void {
    this.detach();
  }

  /**
   * Une passe : choisir le niveau, la couverture, puis ne demander que la différence.
   *
   * `viewportHeightPx` vient du canevas rendu, pas de `window` : en capture et en XR ce ne sont
   * pas les mêmes, et le niveau servi doit suivre ce qui est réellement dessiné.
   */
  update(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    const host = this._host;
    const tileset = this._tileset;
    if (!host || !tileset || this._radiusKm <= 0) return;

    host.group.getWorldPosition(this._bodyWorld);
    const distanceUnits = camera.position.distanceTo(this._bodyWorld);
    // Rayon RENDU (le morph Éduc↔Explo le fait varier), d'où l'échelle courante : la même
    // arithmétique que `ui/surfaceProbe.ts`, et elle ne suppose pas le mode.
    const renderedRadius =
      (host.group.userData['radius'] as number | undefined) ?? host.layerRadius;
    if (renderedRadius <= 0) return;

    const radii = distanceUnits / renderedRadius;
    // Trop loin, ou caméra sous la surface : dans les deux cas il n'y a pas de sol à recouvrir.
    // Le second cas arrive à la toute première image, avant que le vol d'approche n'ait placé
    // la caméra, et demandait sinon une couverture entière au niveau maximal.
    if (radii > TILE_ENGINE_ENTER_RADII || radii <= 1) {
      this._clear();
      return;
    }

    const kmPerUnit = this._radiusKm / renderedRadius;
    const altitudeKm = distanceUnits * kmPerUnit - this._radiusKm;

    const pxPerKm = screenPixelsPerKm({
      altitudeKm,
      fovDeg: camera.fov,
      viewportHeightPx: Math.max(1, viewportHeightPx),
    });
    // Un pixel d'écran pour un pixel de mosaïque : au-delà on télécharge du détail que
    // l'écran ne peut pas montrer, en deçà on affiche une image agrandie.
    const targetKm = pxPerKm > 0 ? 1 / pxPerKm : Number.POSITIVE_INFINITY;

    const centre = host.worldPointToGeographic(
      this._cameraLocal.copy(camera.position)
    );

    // Demi-angle au sol réellement cadré, converti en degrés sur le corps. On prend le côté
    // le plus large du viewport : un écran large voit plus de sol que sa hauteur ne le dit.
    const halfSpanKm =
      altitudeKm *
      Math.tan((camera.fov * Math.PI) / 360) *
      Math.max(1, camera.aspect);
    const halfAngleDeg = Math.min(
      90,
      ((halfSpanKm / this._radiusKm) * 180) / Math.PI
    );

    // On ne descend au niveau que l'écran mérite que s'il TIENT dans le budget : mieux vaut
    // un niveau complet qu'une fraction du suivant, qui laisserait des trous dans le champ.
    let level = levelForGroundResolution(
      this._radiusKm,
      targetKm,
      { minLevel: tileset.minLevel, maxLevel: tileset.maxLevel },
      tileset.matrix
    );
    // Descendre d'un niveau n'aide que si cela réduit VRAIMENT le compte : sous un certain
    // angle la fenêtre vaut 5 x 5 à tous les niveaux, et la boucle dégringolait alors jusqu'au
    // niveau le plus grossier sans rien gagner (mesuré à 390 px : 5,3 km/px au lieu de 83 m/px).
    let count = coverageTileCount(level, centre, halfAngleDeg, tileset.matrix);
    while (level > tileset.minLevel && count > this._budget.maxTiles) {
      const coarser = coverageTileCount(
        level - 1,
        centre,
        halfAngleDeg,
        tileset.matrix
      );
      if (coarser >= count) break;
      level -= 1;
      count = coarser;
    }

    // NE JAMAIS RECOUVRIR LA SURFACE PAR PLUS GROSSIER QU'ELLE. Loin du corps, le budget fait
    // retomber le niveau sous la finesse de la texture livrée : peindre ces carreaux dégrade
    // la vue au lieu de l'améliorer. Mesuré le 2026-09-21 à 1 541 km d'altitude sur la Lune :
    // niveau 3 servi, 2,67 km/px, contre 1,33 km/px pour la texture 8k du catalogue.
    if (pyramidWidthPx(level, tileset.matrix) <= host.shippedSurfaceWidthPx()) {
      this._clear();
      return;
    }

    const tiles = tilesCovering(
      level,
      centre,
      halfAngleDeg,
      this._budget.maxTiles,
      tileset.matrix
    );

    const wanted = new Set(tiles.map(tileKey));
    // Les carreaux d'un AUTRE niveau restent en place tant que le nouveau n'est pas complet :
    // sans cela le sol disparaît à chaque changement de niveau (défaut 2 du docblock).
    const complete = tiles.every((index) => this._tiles.has(tileKey(index)));
    for (const [key, tile] of this._tiles) {
      if (tile.level === level ? !wanted.has(key) : complete) {
        tile.dispose();
        this._tiles.delete(key);
        this._relief.delete(key);
      }
    }
    for (const [key, controller] of this._pending) {
      if (!wanted.has(key)) {
        controller.abort();
        this._pending.delete(key);
      }
    }

    this._queue.length = 0;
    for (const index of tiles) {
      const key = tileKey(index);
      if (
        this._tiles.has(key) ||
        this._pending.has(key) ||
        this._failed.has(key)
      )
        continue;
      this._queue.push(index);
    }
    this._pump();

    this._declareImageryWidth();
    this._publishState(tileset, level, tiles.length, centre);
  }

  private _publishState(
    tileset: SurfaceTileset,
    level: number,
    requested: number,
    centre: { latitudeDeg: number; longitudeDeg: number }
  ): void {
    let painted = 0;
    for (const tile of this._tiles.values())
      if (tile.level === level) painted += 1;

    const next: SurfaceImageryState = {
      body: tileset.body,
      tilesetId: tileset.id,
      title: tileset.title,
      mission: tileset.mission,
      instrument: tileset.instrument,
      credit: tileset.credit,
      level,
      groundResolutionM:
        groundResolutionKm(level, this._radiusKm, tileset.matrix) * 1000,
      widthPx: pyramidWidthPx(level, tileset.matrix),
      oversampling: oversamplingFactor(
        level,
        tileset.publishedPixelsPerDegree,
        tileset.matrix
      ),
      requested,
      painted,
      attached: this._tiles.size,
      acquired: tileset.acquired,
      publishedPixelsPerDegree: tileset.publishedPixelsPerDegree,
      relief: this._reliefState(level, centre),
    };
    if (
      this._state &&
      this._state.level === next.level &&
      this._state.painted === next.painted &&
      this._state.requested === next.requested &&
      this._state.attached === next.attached &&
      this._state.tilesetId === next.tilesetId &&
      this._state.relief?.level === next.relief?.level &&
      this._state.relief?.areaName === next.relief?.areaName
    )
      return;
    this._state = next;
    this._onState(next);
  }

  /**
   * Ce que le bandeau doit dire du relief : le niveau de hauteurs le plus FIN réellement posé
   * sous les carreaux du niveau peint, et l'aire nommée d'où il vient, s'il y en a une.
   *
   * On lit les carreaux POSÉS, jamais la fiche : annoncer un relief qu'un service en panne ou
   * un cache vide n'a pas rendu serait le même mensonge que d'annoncer une imagerie absente.
   */
  private _reliefState(
    level: number,
    centre: { latitudeDeg: number; longitudeDeg: number }
  ): SurfaceReliefState | null {
    const heights = this._heights;
    if (!heights || this._relief.size === 0) return null;
    let best: { level: number; entry: HeightCoverageEntry } | null = null;
    for (const [key, relief] of this._relief) {
      if (this._tiles.get(key)?.level !== level) continue;
      if (!best || relief.level > best.level) best = relief;
    }
    if (!best) return null;
    return {
      groundElevationM: this._groundElevationAt(centre, level),
      setId: heights.set.id,
      title: heights.set.title,
      credit: heights.set.credit,
      level: best.level,
      groundResolutionM: groundResolutionKm(best.level, this._radiusKm) * 1000,
      areaName: best.entry.areaName ?? null,
      acquired: heights.set.acquired,
    };
  }

  /** Jette carreaux et requêtes, sans détacher le corps ni toucher la finesse déclarée. */
  private _clear(): void {
    if (this._tiles.size === 0 && this._pending.size === 0 && !this._state)
      return;
    this._dropEverything();
    if (this._state !== null) {
      this._state = null;
      this._onState(null);
    }
  }

  private _dropEverything(): void {
    for (const controller of this._pending.values()) controller.abort();
    this._pending.clear();
    this._queue.length = 0;
    this._failed.clear();
    for (const tile of this._tiles.values()) tile.dispose();
    this._tiles.clear();
    this._relief.clear();
    // Plus un seul carreau de relief : la sphère livrée reprend sa taille, sinon le corps
    // resterait rétréci de son altitude minimale une fois les carreaux partis.
    if (this._shellScaled) {
      this._host?.setSurfaceShellScale(1);
      this._shellScaled = false;
    }
  }

  /**
   * Hauteurs d'un carreau, prêtes pour `core/tilePatch.ts`, ou `null`.
   *
   * Les altitudes sont converties en unités LOCALES du corps ici, parce que c'est ici qu'on
   * connaît les deux rayons : celui de la sphère RENDUE (le catalogue) et celui de la sphère de
   * référence du modèle d'élévation (le manifeste). Les confondre poserait le relief de la Lune
   * décalé de leur différence, silencieusement.
   */
  private async _reliefFor(imagery: TileIndex): Promise<{
    heights: PatchHeights;
    skirtDepth: number;
    level: number;
    entry: HeightCoverageEntry;
  } | null> {
    const heights = this._heights;
    const host = this._host;
    if (!heights || !host || this._radiusKm <= 0) return null;
    const source = heightTileFor(imagery, heights.manifest.coverage);
    if (!source) {
      // Le socle est global par construction : n'arriver ici signale une couverture
      // incomplète dans le manifeste, pas une situation normale.
      Logger.warn(
        `[Surface] aucune hauteur pour ${imagery.level}/${imagery.row}/${imagery.column}`
      );
      return null;
    }
    const window = heightWindow(
      imagery,
      source.index,
      heights.manifest.samples
    );
    if (!window) return null;
    const tile = await this._heightTile(source.index);
    if (!tile) return null;

    const segments = patchSegments(window.span, MAX_TILE_SEGMENTS);
    const step = window.span / segments;
    // Un carreau collé au bord de sa tuile de hauteurs a besoin de la VOISINE pour sa couronne,
    // sinon sa pente de bord est fausse et une ligne de lumière traverse l'écran. Les voisines
    // sont partagées par tous les carreaux du même bord : on les attend une fois.
    await this._loadNeighbours(source.index, window, tile.samples);
    const apron = segments + 3;
    const unitsPerKm = host.layerRadius / this._radiusKm;
    // Décalage de référentiel : le modèle rapporte ses altitudes à SON rayon, la sphère rendue
    // emploie celui du catalogue. Sur la Lune les deux valent 1737,4 km et le terme est nul ;
    // ailleurs il ne l'est pas, et il ne doit pas être oublié.
    const datumOffsetKm = heights.manifest.datumRadiusKm - this._radiusKm;
    const values = new Float32Array(apron * apron);
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let j = -1; j <= segments + 1; j += 1) {
      for (let i = -1; i <= segments + 1; i += 1) {
        const metres = this._sampleAcrossTiles(
          source.index,
          tile,
          window.x0 + i * step,
          window.y0 + j * step
        );
        const displacement = (datumOffsetKm + metres / 1000) * unitsPerKm;
        values[(j + 1) * apron + (i + 1)] = displacement;
        if (displacement < lowest) lowest = displacement;
        if (displacement > highest) highest = displacement;
      }
    }

    // PROFONDEUR DE LA JUPE : le dénivelé du carreau, et rien de plus.
    //
    // Première version : descendre jusqu'à la sphère abaissée, pour ne jamais voir à travers.
    // Mesuré à l'écran le 2026-09-21 : sur la Lune cela fait des murs de dix kilomètres sous
    // CHAQUE carreau, et le bord de chacun se dessine en noir sur toute la vue — le sol
    // ressemblait à un carrelage. Une jupe n'a pas à combler le vide jusqu'au socle : elle
    // n'existe que pour boucher la fissure entre deux carreaux de niveaux voisins, et cette
    // fissure est bornée par le dénivelé du carreau lui-même.
    return {
      heights: { values, segments },
      skirtDepth: Math.max(0, highest - lowest),
      level: source.index.level,
      entry: source.entry,
    };
  }

  /** Charge les tuiles de hauteurs voisines dont la couronne d'un carreau de bord a besoin. */
  private async _loadNeighbours(
    index: TileIndex,
    window: { x0: number; y0: number; span: number },
    samples: number
  ): Promise<void> {
    const last = samples - 1;
    const columns: number[] = [0];
    const rows: number[] = [0];
    if (window.x0 === 0) columns.push(-1);
    if (window.x0 + window.span === last) columns.push(1);
    if (window.y0 === 0) rows.push(-1);
    if (window.y0 + window.span === last) rows.push(1);
    if (columns.length === 1 && rows.length === 1) return;

    const matrix = tileMatrix(index.level);
    const coverage = this._heights?.manifest.coverage ?? [];
    const wanted: TileIndex[] = [];
    for (const dRow of rows)
      for (const dColumn of columns) {
        if (dRow === 0 && dColumn === 0) continue;
        const row = index.row + dRow;
        if (row < 0 || row >= matrix.rows) continue;
        const neighbour = {
          level: index.level,
          row,
          column: (index.column + dColumn + matrix.columns) % matrix.columns,
        };
        // Une aire nommée s'arrête quelque part : au-delà de son emprise, la tuile n'a jamais
        // été cuite. La demander reviendrait à recevoir la page de l'application en HTTP 200,
        // donc un avertissement par carreau de bord pour rien. On ne demande que ce que le
        // manifeste DÉCLARE à ce niveau.
        if (heightTileFor(neighbour, coverage)?.index.level !== index.level)
          continue;
        wanted.push(neighbour);
      }
    await Promise.all(wanted.map((neighbour) => this._heightTile(neighbour)));
  }

  /**
   * Échantillon de hauteur, en traversant la frontière d'une tuile quand il le faut.
   *
   * La couronne d'un carreau collé au bord de sa tuile de hauteurs tombe DANS LA TUILE
   * VOISINE. Sans cette traversée, `heightMetresAt` borne sur le bord, la pente calculée là y
   * est fausse, et l'éclairage dessine une ligne nette sur toute la largeur de l'écran à chaque
   * frontière de tuile de socle — vu à l'écran le 2026-09-21, et invisible à la relecture.
   *
   * Les colonnes S'ENROULENT (l'antiméridien n'est pas un bord du corps), les lignes NON (il n'y
   * a rien au-delà d'un pôle). Faute de voisine chargée, on borne comme avant : une ligne de
   * lumière vaut mieux qu'une requête de plus au milieu du rendu.
   */
  private _sampleAcrossTiles(
    index: TileIndex,
    tile: HeightTile,
    x: number,
    y: number
  ): number {
    const last = tile.samples - 1;
    if (x >= 0 && x <= last && y >= 0 && y <= last)
      return heightMetresAt(tile, x, y);

    // La pyramide des hauteurs est celle du cuiseur (équirectangulaire 2:1, 257 échantillons),
    // pas celle de l'imagerie : c'est la forme par défaut de `core/tilePyramid.ts`.
    const matrix = tileMatrix(index.level);
    let column = index.column;
    let row = index.row;
    let localX = x;
    let localY = y;
    // Le bord d'une tuile EST la dernière colonne de sa voisine (registre GRILLE) : l'indice
    // global d'un échantillon vaut `colonne × (S − 1) + x`, donc l'échantillon −1 de l'une est
    // l'avant-dernier de l'autre, et le premier au-delà du bord est le DEUXIÈME de la suivante.
    // Un décalage d'un seul échantillon ici empire la couture au lieu de la supprimer — mesuré.
    if (x < 0) {
      column = (column - 1 + matrix.columns) % matrix.columns;
      localX = last + x;
    } else if (x > last) {
      column = (column + 1) % matrix.columns;
      localX = x - last;
    }
    if (y < 0) {
      if (row === 0) return heightMetresAt(tile, x, y);
      row -= 1;
      localY = last + y;
    } else if (y > last) {
      if (row >= matrix.rows - 1) return heightMetresAt(tile, x, y);
      row += 1;
      localY = y - last;
    }
    const neighbour = this._heightTiles.get(
      tileKey({ level: index.level, row, column })
    );
    if (!neighbour) return heightMetresAt(tile, x, y);
    return heightMetresAt(neighbour, localX, localY);
  }

  /**
   * Altitude du sol sous un point visé, lue dans les tuiles DÉJÀ chargées (jamais une requête
   * de plus : cette lecture sert un panneau de diagnostic, pas le rendu).
   */
  private _groundElevationAt(
    centre: { latitudeDeg: number; longitudeDeg: number },
    level: number
  ): number | null {
    const heights = this._heights;
    const tileset = this._tileset;
    if (!heights || !tileset) return null;
    const imagery = tileIndexAt(
      level,
      centre.latitudeDeg,
      centre.longitudeDeg,
      tileset.matrix
    );
    const source = heightTileFor(imagery, heights.manifest.coverage);
    if (!source) return null;
    const tile = this._heightTiles.get(tileKey(source.index));
    if (!tile) return null;
    const bounds = tileBounds(source.index);
    const x =
      ((centre.longitudeDeg - bounds.west) / (bounds.east - bounds.west)) *
      (tile.samples - 1);
    const y =
      ((bounds.north - centre.latitudeDeg) / (bounds.north - bounds.south)) *
      (tile.samples - 1);
    return heightMetresAt(tile, Math.round(x), Math.round(y));
  }

  /** Une tuile de hauteurs, du cache ou du réseau. `null` si elle a échoué. */
  private async _heightTile(index: TileIndex): Promise<HeightTile | null> {
    const heights = this._heights;
    if (!heights) return null;
    const key = tileKey(index);
    const cached = this._heightTiles.get(key);
    if (cached) return cached;
    if (this._heightFailed.has(key)) return null;
    let pending = this._heightPending.get(key);
    if (!pending) {
      const signal = this._heightAbort!.signal;
      const url = heightTilePath(heights.manifest, index);
      pending = this._fetchHeights(url, signal).then((bytes) =>
        decodeHeightTile(bytes, index)
      );
      this._heightPending.set(key, pending);
    }
    try {
      const tile = await pending;
      // Cache BORNÉ : une descente n'emploie qu'une poignée de tuiles, mais une session qui
      // approche le même corps vingt fois de suite finirait par garder le socle entier en
      // mémoire (512 tuiles de 132 Ko sur la Lune). La plus anciennement posée s'en va.
      if (this._heightTiles.size >= MAX_CACHED_HEIGHT_TILES) {
        const oldest = this._heightTiles.keys().next().value;
        if (oldest !== undefined) this._heightTiles.delete(oldest);
      }
      this._heightTiles.set(key, tile);
      return tile;
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        this._heightFailed.add(key);
        Logger.warn(
          `[Surface] hauteurs non chargées : ${(error as Error)?.message}`
        );
      }
      return null;
    } finally {
      this._heightPending.delete(key);
    }
  }

  /** Abaisse la sphère livrée au minimum mesuré du jeu, une seule fois par attachement. */
  private _applyShellScale(): void {
    const heights = this._heights;
    const host = this._host;
    if (!heights || !host || this._shellScaled || this._radiusKm <= 0) return;
    const dropKm =
      heights.manifest.datumRadiusKm -
      this._radiusKm +
      heights.manifest.minElevationMetres / 1000;
    const factor = (this._radiusKm + dropKm) / this._radiusKm;
    if (!(factor > 0) || factor >= 1) return;
    host.setSurfaceShellScale(factor);
    this._shellScaled = true;
  }

  private _pump(): void {
    while (
      this._pending.size < this._budget.maxConcurrentLoads &&
      this._queue.length > 0
    ) {
      void this._load(this._queue.shift()!);
    }
  }

  private async _load(index: TileIndex): Promise<void> {
    const tileset = this._tileset;
    const host = this._host;
    if (!tileset || !host) return;
    const key = tileKey(index);
    const controller = new AbortController();
    this._pending.set(key, controller);

    try {
      const url = tileUrl(tileset.service, index);
      const bitmap = await this._fetchTile(url, controller.signal);
      // La cible a pu changer pendant le vol : ne rien poser sur un corps qu'on a quitté, ni
      // un carreau qu'on vient d'abandonner.
      if (this._pending.get(key) !== controller || this._host !== host) {
        bitmap.close?.();
        return;
      }
      // Le relief est demandé APRÈS l'image : une tuile de hauteurs sert des dizaines de
      // carreaux, donc seul le premier attend le réseau. Un échec de hauteurs ne retire pas
      // l'imagerie — le carreau est alors posé plat, et le bandeau ne parle pas de relief.
      const relief = await this._reliefFor(index);
      if (this._pending.get(key) !== controller || this._host !== host) {
        bitmap.close?.();
        return;
      }
      const texture = new THREE.Texture();
      texture.image = bitmap;
      // L'image est déjà retournée dans le bitmap (cf. `defaultFetcher`) : ne pas la retourner
      // une seconde fois. Three ignore ce drapeau pour un ImageBitmap, on le pose pour que le
      // code dise la même chose que le GPU.
      texture.flipY = false;
      const tile = new SurfaceTile({
        index,
        radius: host.layerRadius,
        shape: tileset.matrix,
        material: host.createSurfaceOverlayMaterial(),
        releaseMaterial: (material) =>
          host.releaseSurfaceOverlayMaterial(material),
        ...(relief
          ? { heights: relief.heights, skirtDepth: relief.skirtDepth }
          : {}),
      });
      tile.setTexture(texture);
      host.attachSpinningChild(tile.mesh);
      this._tiles.set(key, tile);
      if (relief) {
        this._relief.set(key, { level: relief.level, entry: relief.entry });
        this._applyShellScale();
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      // Un échec se RETIENT : sans cela la même tuile serait redemandée à chaque frame, et
      // un service en panne recevrait soixante requêtes par seconde.
      this._failed.add(key);
      Logger.warn(`[Surface] tuile non chargée : ${(error as Error)?.message}`);
    } finally {
      if (this._pending.get(key) === controller) this._pending.delete(key);
      this._pump();
    }
  }
}

function tileKey(index: TileIndex): string {
  return `${index.level}/${index.row}/${index.column}`;
}
