/**
 * UN CARREAU d'imagerie posé sur la surface d'un corps (lot 9, phase 9C).
 *
 * La géométrie est un morceau de la MÊME sphère que la couche `surface` : même rayon local,
 * même paramétrisation. C'est la décision 1 du plan du lot — un carreau est un enfant du groupe
 * qui porte la rotation diurne, il hérite donc de la translation, du pôle IAU et de la phase
 * recalée à chaque image, au lieu de recalculer une orientation parallèle. Le dépôt a déjà payé
 * quatre défauts pour avoir laissé deux couches décider d'une même grandeur.
 *
 * La correspondance angle → texture n'est pas choisie ici : c'est celle de
 * `frames.geographicToLocalDirection` (`phi = longitude + π`, `theta = 90° − latitude`), donc
 * celle de `THREE.SphereGeometry` et d'une équirectangulaire standard, et elle est MESURÉE
 * depuis le lot 8 contre quatre épicentres publiés de l'USGS. Une tuile WMTS a sa ligne 0 au
 * nord et sa colonne 0 à −180° : son bord haut tombe donc sur `thetaStart` et son bord gauche
 * sur `phiStart`, ce que les UV de `SphereGeometry` rendent sans conversion.
 *
 * Sans hauteurs, aucun décalage radial, et c'est délibéré : la sphère de base est INSCRITE
 * (64 segments, 2,09 km de flèche sur la Lune, mesuré en 9B), donc un carreau finement
 * subdivisé passe naturellement au-dessus d'elle presque partout. `polygonOffset` couvre le
 * reste sans déplacer un seul sommet — déplacer la géométrie sans mesure reviendrait à
 * afficher une altitude inventée, ce que l'invariant du lot interdit.
 *
 * AVEC des hauteurs (lot 9, phase 9D), les sommets sont déplacés radialement par des altitudes
 * MESURÉES, cuites depuis un modèle d'élévation publié. Le carreau gagne alors une jupe, et sa
 * géométrie vient du module pur `core/tilePatch.ts`, où elle est testée.
 */
import * as THREE from 'three';

import { buildTilePatch, type PatchHeights } from '@/core/tilePatch';
import {
  tileBounds,
  type TileIndex,
  type TileMatrixShape,
} from '@/core/tilePyramid';

/** Segments par carreau SANS relief : la courbure d'un carreau est faible, 8 suffisent. */
export const TILE_SEGMENTS = 8;

export class SurfaceTile {
  readonly mesh: THREE.Mesh;
  /** Niveau de la pyramide : le moteur s'en sert pour retirer un niveau une fois le suivant complet. */
  readonly level: number;
  /** Le carreau porte-t-il des hauteurs mesurées ? Lu par le bandeau et par l'e2e. */
  readonly hasHeights: boolean;
  private readonly _geometry: THREE.BufferGeometry;
  private readonly _material: THREE.Material;
  private _texture: THREE.Texture | null = null;
  private readonly _releaseMaterial?: (material: THREE.Material) => void;

  constructor(params: {
    index: TileIndex;
    /** Rayon LOCAL des couches du corps (`CelestialObject.layerRadius`). */
    radius: number;
    /** Forme de la matrice, pour retrouver l'emprise du carreau. */
    shape: TileMatrixShape;
    /**
     * Matériau fourni par le corps, pour s'éclairer comme sa surface. UN PAR CARREAU : il porte
     * la carte du carreau, et un matériau partagé n'afficherait que la dernière image posée.
     */
    material: THREE.Material;
    /** Rendu au corps avant destruction, pour qu'il cesse de l'éclairer chaque frame. */
    releaseMaterial?: (material: THREE.Material) => void;
    /** Hauteurs mesurées du carreau, couronne comprise (`core/tilePatch.ts`). */
    heights?: PatchHeights;
    /** Profondeur de la jupe, en unités locales. N'a de sens qu'avec des hauteurs. */
    skirtDepth?: number;
  }) {
    this._releaseMaterial = params.releaseMaterial;
    this.level = params.index.level;
    this.hasHeights = params.heights !== undefined;
    const bounds = tileBounds(params.index, params.shape);

    const patch = buildTilePatch({
      bounds,
      radius: params.radius,
      segments: params.heights?.segments ?? TILE_SEGMENTS,
      ...(params.heights ? { heights: params.heights } : {}),
      ...(params.heights && params.skirtDepth
        ? { skirtDepth: params.skirtDepth }
        : {}),
    });
    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(patch.positions, 3)
    );
    this._geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(patch.normals, 3)
    );
    this._geometry.setAttribute('uv', new THREE.BufferAttribute(patch.uvs, 2));
    this._geometry.setIndex(new THREE.BufferAttribute(patch.indices, 1));
    this._geometry.computeBoundingSphere();
    this._material = params.material;
    // Le carreau et la sphère qu'il recouvre occupent la MÊME surface : on décale la
    // profondeur écrite, jamais la géométrie — un décalage radial serait une altitude
    // inventée, ce que l'invariant du lot interdit.
    //
    // Le décalage CROÎT avec le niveau, parce que deux niveaux se recouvrent le temps qu'un
    // changement de niveau s'achève (le moteur garde l'ancien jusque-là, pour que le sol ne
    // disparaisse pas) : le plus fin doit gagner, sans quoi les deux se disputeraient le même
    // plan de profondeur.
    //
    // AVEC des hauteurs, ce décalage est retiré, et c'est une mesure qui l'a décidé : la
    // sphère livrée est alors descendue sous le relief (cf. `setSurfaceShellScale`), donc plus
    // rien ne se dispute ce plan de profondeur ; en revanche le décalage s'applique AUSSI à la
    // jupe, qui pend sous le bord du carreau, et la tirer vers la caméra dessinait une ligne
    // sombre le long de CHAQUE carreau — un carrelage sur toute la vue, vu à l'écran le
    // 2026-09-21 et invisible autrement.
    this._material.polygonOffset = !this.hasHeights;
    this._material.polygonOffsetFactor = -1 - this.level;
    this._material.polygonOffsetUnits = -1 - this.level;
    this.mesh = new THREE.Mesh(this._geometry, this._material);
    this.mesh.name = `tile_${params.index.level}_${params.index.row}_${params.index.column}`;
    // Le carreau n'est montré qu'une fois son image décodée : un carreau blanc au-dessus de
    // la surface serait pire que l'absence de carreau.
    this.mesh.visible = false;
    this.mesh.renderOrder = 1 + this.level;
  }

  /** Pose l'image décodée et rend le carreau visible. */
  setTexture(texture: THREE.Texture): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    // Le bord d'un carreau touche celui du voisin : répéter y ramènerait le pixel opposé.
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this._texture = texture;
    const material = this._material as THREE.MeshStandardMaterial;
    material.map = texture;
    material.needsUpdate = true;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this._geometry.dispose();
    this._texture?.dispose();
    this._texture = null;
    this._releaseMaterial?.(this._material);
    this._material.dispose();
  }
}
