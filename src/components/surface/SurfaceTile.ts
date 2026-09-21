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
 * Pas de décalage radial, et c'est délibéré : la sphère de base est INSCRITE (64 segments,
 * 2,09 km de flèche sur la Lune, mesuré en 9B), donc un carreau finement subdivisé passe
 * naturellement au-dessus d'elle presque partout. `polygonOffset` couvre le reste sans déplacer
 * un seul sommet — déplacer la géométrie reviendrait à afficher une altitude inventée, ce que
 * l'invariant du lot interdit.
 */
import * as THREE from 'three';

import {
  tileBounds,
  type TileIndex,
  type TileMatrixShape,
} from '@/core/tilePyramid';

const DEG_TO_RAD = Math.PI / 180;

/** Segments par carreau : la courbure d'un carreau est faible, 8 suffisent et coûtent peu. */
export const TILE_SEGMENTS = 8;

export class SurfaceTile {
  readonly mesh: THREE.Mesh;
  /** Niveau de la pyramide : le moteur s'en sert pour retirer un niveau une fois le suivant complet. */
  readonly level: number;
  private readonly _geometry: THREE.SphereGeometry;
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
  }) {
    this._releaseMaterial = params.releaseMaterial;
    this.level = params.index.level;
    const bounds = tileBounds(params.index, params.shape);
    const phiStart = (bounds.west + 180) * DEG_TO_RAD;
    const phiLength = (bounds.east - bounds.west) * DEG_TO_RAD;
    const thetaStart = (90 - bounds.north) * DEG_TO_RAD;
    const thetaLength = (bounds.north - bounds.south) * DEG_TO_RAD;

    this._geometry = new THREE.SphereGeometry(
      params.radius,
      TILE_SEGMENTS,
      TILE_SEGMENTS,
      phiStart,
      phiLength,
      thetaStart,
      thetaLength
    );
    this._material = params.material;
    // Le carreau et la sphère qu'il recouvre occupent la MÊME surface : on décale la
    // profondeur écrite, jamais la géométrie — un décalage radial serait une altitude
    // inventée, ce que l'invariant du lot interdit.
    //
    // Le décalage CROÎT avec le niveau, parce que deux niveaux se recouvrent le temps qu'un
    // changement de niveau s'achève (le moteur garde l'ancien jusque-là, pour que le sol ne
    // disparaisse pas) : le plus fin doit gagner, sans quoi les deux se disputeraient le même
    // plan de profondeur.
    this._material.polygonOffset = true;
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
