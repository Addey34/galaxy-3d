/**
 * LA COUCHE DE BÂTIMENTS (lot 63, étape C.3b) : charge les tuiles proches de la visée, en fait des
 * maillages (`core/buildingMesh.ts`) et les pose sur le sol RENDU du corps.
 *
 * Trois propriétés qui ne sont pas des détails :
 *
 *  - **le sol est mesuré sur ce qui est dessiné**, par un rayon lancé le long de la verticale du
 *    lieu contre les maillages de surface déjà posés. La Terre est rendue comme un ellipsoïde
 *    déplacé par des hauteurs : retrouver ce sol par les datums, c'est se tromper de plusieurs
 *    kilomètres sans rien voir (le moteur l'a déjà payé, lot 48). Une tuile dont le sol n'est pas
 *    encore posé reste INVISIBLE, elle n'est pas posée au hasard ;
 *  - **il demande peu et ne redemande pas** : un plafond de tuiles (palier d'appareil), une requête
 *    annulable par tuile, un échec retenu, rien du tout tant que `update` n'est pas appelé ;
 *  - **il est enfant du groupe du corps** (`attachSpinningChild`), comme les carreaux de surface :
 *    il hérite de la translation, du pôle et de la rotation au lieu d'en recalculer une parallèle.
 *
 * Il ne connaît aucun corps : l'hôte dit son rayon local, et `radiusKm` fait le pont vers les
 * mètres du maillage.
 */
import * as THREE from 'three';

import { buildBuildingMesh } from '@/core/buildingMesh';
import {
  meshRotationAt,
  metresPerDegree,
  tilesAround,
} from '@/core/buildingPlacement';
import { originColour } from '@/core/buildingOriginStyle';
import {
  decodeBuildingTile,
  dequantizeFromTile,
  type BuildingTileIdentity,
} from '@/core/buildingTile';
import { geographicToLocalDirection } from '@/core/frames';
import type { BuildingSetManifest } from '@/config/buildingSets';
import type { SurfaceHost } from './PlanetarySurfaceEngine';

/** Ce que la couche demande d'un corps : le moteur de surface en demande déjà autant. */
export type BuildingHost = Pick<
  SurfaceHost,
  'name' | 'layerRadius' | 'group' | 'attachSpinningChild'
>;

export type BuildingTileFetcher = (
  url: string,
  signal: AbortSignal
) => Promise<ArrayBuffer>;

export interface BuildingBudget {
  /** Plafond de tuiles posées ; au-delà, on garde les plus proches de la visée. */
  maxTiles: number;
  /** Anneaux de tuiles autour de celle de la visée (0 = la seule tuile de la visée). */
  rings: number;
}

/**
 * Budgets PROVISOIRES par palier d'appareil. Ce ne sont pas des mesures : l'étape C.5 les remplace
 * par ce que `pnpm perf:measure` rend, et tant qu'elle n'est pas faite ces valeurs ne sont que de
 * quoi faire tourner le premier rendu. Les écrire d'avance comme définitives serait deviner.
 */
export const PROVISIONAL_BUILDING_BUDGET: Readonly<
  Record<'low' | 'medium' | 'high', BuildingBudget>
> = {
  low: { maxTiles: 4, rings: 1 },
  medium: { maxTiles: 9, rings: 1 },
  high: { maxTiles: 25, rings: 2 },
};

export interface BuildingLayerState {
  /** Tuiles posées, visibles ou non. */
  loaded: number;
  /** Tuiles en vol. */
  pending: number;
  /** Tuiles retenues comme échouées (jamais redemandées). */
  failed: number;
  /** Tuiles chargées dont le sol rendu n'est pas encore mesurable : invisibles. */
  waitingForGround: number;
  /** Bâtiments visibles, toutes tuiles posées sur le sol confondues. */
  buildings: number;
  /** Origines de hauteur présentes parmi les bâtiments visibles (la légende n'affiche que celles-là). */
  origins: number[];
}

interface Entry {
  id: BuildingTileIdentity;
  mesh: THREE.Mesh;
  buildings: number;
  origins: number[];
  centre: { latitudeDeg: number; longitudeDeg: number };
  grounded: boolean;
  lastGroundedAt: number;
}

/** Re-mesure du sol d'une tuile posée : le relief se raffine à mesure que des carreaux arrivent. */
const REGROUND_INTERVAL_MS = 1500;

const key = (t: BuildingTileIdentity): string =>
  `${t.zoom}/${t.column}/${t.row}`;

const defaultFetcher: BuildingTileFetcher = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
};

export class BuildingLayer {
  private readonly _host: BuildingHost;
  private readonly _radiusKm: number;
  private readonly _set: BuildingSetManifest;
  private readonly _origin: string;
  private readonly _budget: BuildingBudget;
  private readonly _fetch: BuildingTileFetcher;
  private readonly _now: () => number;
  private readonly _onChange: () => void;
  private readonly _material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
  private readonly _tiles = new Map<string, Entry>();
  private readonly _pending = new Map<string, AbortController>();
  private readonly _failed = new Set<string>();
  private readonly _raycaster = new THREE.Raycaster();
  /**
   * Le repère des bâtiments : UN groupe attaché au groupe qui tourne avec le corps, comme les
   * carreaux. Les directions géographiques sont dans CE repère (celui des couches), pas dans
   * celui de `host.group` : confondre les deux visait un autre lieu que celui de la tuile.
   */
  private readonly _root = new THREE.Group();
  private _disposed = false;

  constructor(options: {
    host: BuildingHost;
    radiusKm: number;
    set: BuildingSetManifest;
    /** Origine du service qui sert les tuiles (`GALAXY_DATA_ORIGIN`). */
    origin: string;
    budget: BuildingBudget;
    fetchTile?: BuildingTileFetcher;
    now?: () => number;
    onChange?: () => void;
  }) {
    this._host = options.host;
    this._radiusKm = options.radiusKm;
    this._set = options.set;
    this._origin = options.origin;
    this._budget = options.budget;
    this._fetch = options.fetchTile ?? defaultFetcher;
    this._now = options.now ?? (() => performance.now());
    this._onChange = options.onChange ?? (() => undefined);
    this._root.name = 'buildings';
    this._host.attachSpinningChild(this._root);
  }

  /** Le jeu servi : sa source, sa licence et son attribution, que l'écran doit montrer. */
  get set(): BuildingSetManifest {
    return this._set;
  }

  get setId(): string {
    return this._set.id;
  }

  get state(): BuildingLayerState {
    let waitingForGround = 0;
    let buildings = 0;
    const origins = new Set<number>();
    for (const entry of this._tiles.values()) {
      if (entry.grounded) {
        buildings += entry.buildings;
        for (const o of entry.origins) origins.add(o);
      } else waitingForGround++;
    }
    return {
      loaded: this._tiles.size,
      pending: this._pending.size,
      failed: this._failed.size,
      waitingForGround,
      buildings,
      origins: [...origins].sort((a, b) => a - b),
    };
  }

  /** À appeler à chaque image où la couche est active : demande, retire et pose. */
  update(aim: { latitudeDeg: number; longitudeDeg: number }): void {
    if (this._disposed) return;
    // Une tuile sans bâtiment n'existe pas sur le serveur : la demander ferait un 404 pour rien.
    const existing = this._set.tiles
      ? new Set(this._set.tiles.map((t) => `${t.column}/${t.row}`))
      : null;
    const wanted = tilesAround(
      aim.longitudeDeg,
      aim.latitudeDeg,
      this._set.zoom,
      this._budget.rings
    )
      .filter((t) => !existing || existing.has(`${t.column}/${t.row}`))
      .slice(0, this._budget.maxTiles);
    const wantedKeys = new Set(wanted.map(key));

    // Retrait : ce qui n'est plus voulu s'en va, et ce qui est en vol est annulé.
    for (const [k, entry] of this._tiles) {
      if (wantedKeys.has(k)) continue;
      this._removeEntry(k, entry);
    }
    for (const [k, controller] of this._pending) {
      if (wantedKeys.has(k)) continue;
      controller.abort();
      this._pending.delete(k);
    }

    for (const id of wanted) {
      const k = key(id);
      if (this._tiles.has(k) || this._pending.has(k) || this._failed.has(k))
        continue;
      this._load(id);
    }
    this._ground();
  }

  dispose(): void {
    this._disposed = true;
    for (const controller of this._pending.values()) controller.abort();
    this._pending.clear();
    for (const [k, entry] of this._tiles) this._removeEntry(k, entry);
    this._root.parent?.remove(this._root);
    this._material.dispose();
  }

  private _removeEntry(k: string, entry: Entry): void {
    entry.mesh.parent?.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    this._tiles.delete(k);
    this._onChange();
  }

  private _url(id: BuildingTileIdentity): string {
    return `${this._origin}/${this._set.directory}/${id.zoom}/${id.column}/${id.row}.bin`;
  }

  private _load(id: BuildingTileIdentity): void {
    const k = key(id);
    const controller = new AbortController();
    this._pending.set(k, controller);
    this._fetch(this._url(id), controller.signal)
      .then((bytes) => {
        if (this._disposed || controller.signal.aborted) return;
        // La confrontation d'identité refuse une tuile d'un autre endroit.
        const tile = decodeBuildingTile(bytes, id);
        this._place(id, tile);
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === 'AbortError') return;
        this._failed.add(k);
        this._onChange();
      })
      .finally(() => {
        // Une annulation a déjà retiré son entrée ; seule la complétion du bon contrôleur compte.
        if (this._pending.get(k) === controller) this._pending.delete(k);
      });
  }

  private _place(
    id: BuildingTileIdentity,
    tile: ReturnType<typeof decodeBuildingTile>
  ): void {
    // Les mètres par degré dépendent de la latitude du centre de la tuile.
    const [, centreLat] = dequantizeFromTile(32768, 32768, tile);
    const geometryData = buildBuildingMesh(tile, {
      ...metresPerDegree(centreLat, this._radiusKm * 1000),
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(geometryData.positions, 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(geometryData.normals, 3)
    );
    const colours = new Float32Array(geometryData.origins.length * 3);
    const colour = new THREE.Color();
    geometryData.origins.forEach((origin, i) => {
      colour.setHex(originColour(origin));
      colours.set([colour.r, colour.g, colour.b], 3 * i);
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this._material);
    mesh.userData['building'] = true;
    mesh.visible = false; // invisible jusqu'à ce que son sol soit mesuré
    mesh.scale.setScalar(this._host.layerRadius / (this._radiusKm * 1000));
    mesh.quaternion.copy(
      meshRotationAt(
        geometryData.centre.latitudeDeg,
        geometryData.centre.longitudeDeg
      )
    );
    this._root.add(mesh);
    this._tiles.set(key(id), {
      id,
      mesh,
      buildings: geometryData.stats.buildings,
      origins: [...new Set<number>(geometryData.origins)],
      centre: {
        latitudeDeg: geometryData.centre.latitudeDeg,
        longitudeDeg: geometryData.centre.longitudeDeg,
      },
      grounded: false,
      lastGroundedAt: -Infinity,
    });
    this._onChange();
  }

  /** Mesure le sol rendu sous chaque tuile et la pose ; re-mesure celles déjà posées. */
  private _ground(): void {
    const now = this._now();
    let measured = false;
    for (const entry of this._tiles.values()) {
      if (entry.grounded && now - entry.lastGroundedAt < REGROUND_INTERVAL_MS)
        continue;
      const radius = this._groundRadiusAt(
        entry.centre.latitudeDeg,
        entry.centre.longitudeDeg
      );
      if (radius === null) continue;
      geographicToLocalDirection(
        entry.centre.latitudeDeg,
        entry.centre.longitudeDeg,
        entry.mesh.position
      ).multiplyScalar(radius);
      if (!entry.grounded) {
        entry.grounded = true;
        entry.mesh.visible = true;
        measured = true;
      }
      entry.lastGroundedAt = now;
    }
    if (measured) this._onChange();
  }

  /**
   * Rayon LOCAL du sol rendu à un lieu, ou `null` quand aucun maillage de surface n'est posé là.
   * Le rayon part de loin, au-dessus du lieu, et descend vers le centre ; le premier maillage
   * touché est le plus haut, donc le sol qu'on voit (un carreau grossier sous un carreau fin ne
   * le cache pas, l'inverse n'a pas lieu d'être).
   */
  private _groundRadiusAt(
    latitudeDeg: number,
    longitudeDeg: number
  ): number | null {
    const group = this._root;
    this._host.group.updateMatrixWorld(true);
    const up = geographicToLocalDirection(latitudeDeg, longitudeDeg);
    const origin = up.clone().multiplyScalar(this._host.layerRadius * 1.5);
    const worldOrigin = group.localToWorld(origin.clone());
    const worldTarget = group.localToWorld(new THREE.Vector3(0, 0, 0));
    const direction = worldTarget.sub(worldOrigin).normalize();
    this._raycaster.set(worldOrigin, direction);
    this._raycaster.far = Infinity;
    // Les carreaux ne sont pas enfants directs du groupe (ils vivent dans le groupe qui tourne) :
    // on parcourt, et on ne retient que ceux que le moteur marque ET qu'il a déjà montrés.
    const surfaces: THREE.Mesh[] = [];
    this._host.group.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        object.userData['surfaceTile'] &&
        object.visible
      )
        surfaces.push(object);
    });
    const hits = this._raycaster.intersectObjects(surfaces, false);
    const first = hits[0];
    if (!first) return null;
    return group.worldToLocal(first.point.clone()).length();
  }
}
