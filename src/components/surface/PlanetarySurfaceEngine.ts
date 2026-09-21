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
  tilesCovering,
  type TileIndex,
} from '@/core/tilePyramid';
import { tileUrl } from '@/core/tileUrl';
import { screenPixelsPerKm } from '@/core/surfaceApproach';
import type { SurfaceTileset } from '@/config/surfaceTilesets';
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
  /** Intervalle décrit par la mosaïque. */
  acquired: { from: number; to: number };
  publishedPixelsPerDegree: number;
}

/**
 * Le moteur ne travaille qu'une fois la cible assez grosse à l'écran. 6 rayons apparents :
 * au-delà, l'image livrée du corps suffit largement et un carreau ne couvrirait que quelques
 * pixels. C'est aussi ce qui garantit que survoler un corps de loin ne demande rien.
 */
export const TILE_ENGINE_ENTER_RADII = 6;

/** Récupération d'une tuile : isolée pour que les tests puissent la remplacer. */
export type TileFetcher = (
  url: string,
  signal: AbortSignal
) => Promise<ImageBitmap>;

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

export class PlanetarySurfaceEngine {
  private _host: SurfaceHost | null = null;
  private _tileset: SurfaceTileset | null = null;
  private _radiusKm = 0;

  private readonly _tiles = new Map<string, SurfaceTile>();
  private readonly _pending = new Map<string, AbortController>();
  private readonly _queue: TileIndex[] = [];
  private readonly _failed = new Set<string>();

  private _state: SurfaceImageryState | null = null;

  private readonly _budget: TileBudget;
  private readonly _fetchTile: TileFetcher;
  private readonly _onState: (state: SurfaceImageryState | null) => void;
  private readonly _onImageryWidthChanged: () => void;

  private readonly _cameraLocal = new THREE.Vector3();
  private readonly _bodyWorld = new THREE.Vector3();

  constructor(options: {
    budget: TileBudget;
    onState?: (state: SurfaceImageryState | null) => void;
    onImageryWidthChanged?: () => void;
    fetchTile?: TileFetcher;
  }) {
    this._budget = options.budget;
    this._fetchTile = options.fetchTile ?? defaultFetcher;
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

  attach(host: SurfaceHost, tileset: SurfaceTileset, radiusKm: number): void {
    if (this._host === host && this._tileset === tileset) return;
    this.detach();
    this._host = host;
    this._tileset = tileset;
    this._radiusKm = radiusKm;
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
    this._publishState(tileset, level, tiles.length);
  }

  private _publishState(
    tileset: SurfaceTileset,
    level: number,
    requested: number
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
      acquired: tileset.acquired,
      publishedPixelsPerDegree: tileset.publishedPixelsPerDegree,
    };
    if (
      this._state &&
      this._state.level === next.level &&
      this._state.painted === next.painted &&
      this._state.requested === next.requested &&
      this._state.tilesetId === next.tilesetId
    )
      return;
    this._state = next;
    this._onState(next);
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
      });
      tile.setTexture(texture);
      host.attachSpinningChild(tile.mesh);
      this._tiles.set(key, tile);
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
