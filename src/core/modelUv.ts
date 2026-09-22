/**
 * Coordonnées de texture d'un modèle de forme, pour y DRAPER la carte équirectangulaire du corps.
 *
 * Un corps irrégulier qui a déjà une vraie texture (Phobos, Vesta) ne peut pas recevoir sa
 * couleur par sommet comme Bennu : ~30 000 sommets gardent à peine l'équivalent d'une carte de
 * 256 px, et la texture en porte des milliers. On donne donc au maillage les coordonnées de la
 * même projection que la sphère qu'il remplace, et il reçoit le même matériau : mêmes niveaux de
 * détail, mêmes ombres, même éclipse.
 *
 * Conventions, qui sont celles de la sphère (`THREE.SphereGeometry`) et des produits PDS passés
 * par `decimate-shape-model.mjs --z-up` :
 *   - pôle nord sur +Y ;
 *   - longitude 0 sur +X, longitudes positives vers l'EST, soit vers −Z ;
 *   - carte en projection cylindrique simple, planétocentrique, bord gauche à −180° :
 *     u = 0,5 + λ/360, v = 0,5 + φ/180 (v = 1 au nord, `flipY` par défaut de Three.js).
 * Une texture de convention différente se voit sur la sphère avant de se voir ici : les deux
 * reçoivent exactement la même carte.
 *
 * Les longitudes et latitudes se lisent depuis l'ORIGINE du fichier, qui est le centre du repère
 * lié au corps des produits PDS (le centre de masse), et non depuis le centroïde recalculé par
 * l'application : c'est dans ce repère que la carte a été projetée.
 *
 * Deux singularités de toute projection équirectangulaire posée sur un maillage :
 *   - la COUTURE à ±180° : un triangle qui l'enjambe relierait u ≈ 0,99 à u ≈ 0,01 et étalerait
 *     toute la carte à l'envers sur sa surface. On ajoute 1 aux coordonnées du bord gauche, et
 *     la texture doit être en `RepeatWrapping` horizontal pour les lire ;
 *   - les PÔLES : un sommet posé sur l'axe n'a pas de longitude. Il reçoit la moyenne de celles
 *     des deux autres sommets de son triangle, faute de quoi le triangle polaire tire un éventail
 *     de toute la largeur de la carte.
 * D'où une géométrie NON indexée : un sommet de couture ou de pôle doit pouvoir porter une
 * coordonnée différente dans chacun de ses triangles.
 */

/** En deçà (fraction du rayon), un sommet est considéré sur l'axe polaire. */
const POLE_AXIS_EPSILON = 1e-9;

export interface DrapedGeometry {
  /** Positions non indexées, trois sommets par triangle (x, y, z). */
  positions: Float32Array;
  /** Coordonnées de texture, deux par sommet, alignées sur `positions`. */
  uv: Float32Array;
}

function longitudeFraction(x: number, z: number): number | null {
  const horizontal = Math.hypot(x, z);
  if (horizontal < POLE_AXIS_EPSILON * Math.hypot(horizontal, 1)) return null;
  // Est vers −Z : λ = atan2(−z, x).
  return 0.5 + Math.atan2(-z, x) / (2 * Math.PI);
}

/**
 * Déplie un maillage indexé en triangles indépendants munis de leurs coordonnées de texture.
 * `positions` sont les sommets DANS le repère du fichier (origine = centre du corps).
 */
export function drapeEquirectangular(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>
): DrapedGeometry {
  const triangleCount = Math.floor(indices.length / 3);
  const out = new Float32Array(triangleCount * 9);
  const uv = new Float32Array(triangleCount * 6);
  const us: (number | null)[] = [0, 0, 0];
  const vs = [0, 0, 0];

  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k]! * 3;
      const x = positions[i]!;
      const y = positions[i + 1]!;
      const z = positions[i + 2]!;
      out.set([x, y, z], t * 9 + k * 3);
      const r = Math.hypot(x, y, z);
      vs[k] =
        r > 0
          ? 0.5 + Math.asin(Math.max(-1, Math.min(1, y / r))) / Math.PI
          : 0.5;
      us[k] = longitudeFraction(x, z);
    }

    // Couture : ramène les trois longitudes du même côté de ±180°.
    const known = us.filter((u): u is number => u !== null);
    if (known.length > 1 && Math.max(...known) - Math.min(...known) > 0.5) {
      for (let k = 0; k < 3; k++) {
        const u = us[k];
        if (u !== null && u < 0.5) us[k] = u + 1;
      }
    }
    // Pôles : moyenne des longitudes connues du triangle (déjà dépliées).
    const unwrapped = us.filter((u): u is number => u !== null);
    const mean =
      unwrapped.length > 0
        ? unwrapped.reduce((a, b) => a + b, 0) / unwrapped.length
        : 0.5;
    for (let k = 0; k < 3; k++) {
      uv[t * 6 + k * 2] = us[k] ?? mean;
      uv[t * 6 + k * 2 + 1] = vs[k]!;
    }
  }
  return { positions: out, uv };
}
