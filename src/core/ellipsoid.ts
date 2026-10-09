/**
 * LE GLOBE EST L'ELLIPSOÏDE PUBLIÉ, PAS UNE SPHÈRE (ligne 45.3, lot 1, 2026-10-09).
 *
 * Module PUR. Une figure est donnée par ses trois demi-axes RAPPORTÉS au rayon de rendu du corps
 * (`a` vers le méridien origine, `b` vers 90° Est, `c` le long du pôle nord), lus dans le noyau PCK
 * de NAIF par le relevé des faits (`config/bodyFigure.ts`). Saturne y est aplatie de 9,8 %,
 * Jupiter de 6,5 %, la Terre de 0,3 %.
 *
 * LE CHOIX QUI COMPTE : on ne met pas le maillage à l'échelle par axe, on pousse chaque sommet LE
 * LONG DE SA DIRECTION jusqu'à l'ellipsoïde. Toute l'application passe d'une latitude et d'une
 * longitude à une position par une DIRECTION depuis le centre (`frames.geographicToLocalDirection`,
 * `surfacePointToWorld`, les carreaux, le point subsolaire) : c'est une latitude PLANÉTOCENTRIQUE.
 * Étirer le maillage aurait déplacé chaque texel vers une latitude « paramétrique », jusqu'à 3° à
 * 45° de latitude sur Saturne, et décalé les carreaux et les marqueurs de la texture qu'ils
 * recouvrent. Pousser le long de la direction garde toutes ces correspondances exactes.
 *
 * Repère LOCAL du `_meshGroup` (cf. `frames.geographicToLocalDirection`) : la longitude 0 sur +X,
 * 90° Est sur −Z, le pôle nord sur +Y. Donc `a` porte sur X, `b` sur Z, `c` sur Y.
 */

/** Demi-axes rapportés au rayon de rendu. Une sphère vaut `{ a: 1, b: 1, c: 1 }`. */
export interface Figure {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/**
 * Rayon de l'ellipsoïde dans la direction locale (x, y, z), rapporté au rayon de rendu. La
 * direction n'a pas besoin d'être unitaire : seul son sens compte.
 */
export function figureRadius(
  figure: Figure,
  x: number,
  y: number,
  z: number
): number {
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) return 1;
  const ux = x / length;
  const uy = y / length;
  const uz = z / length;
  return (
    1 /
    Math.sqrt(
      (ux / figure.a) ** 2 + (uz / figure.b) ** 2 + (uy / figure.c) ** 2
    )
  );
}

/**
 * Normale SORTANTE de l'ellipsoïde au point de direction (x, y, z), unitaire. Ce n'est pas la
 * direction elle-même : sur Saturne, à 45° de latitude, l'écart dépasse 5°, et l'éclairage le
 * montrerait au terminateur.
 */
export function figureNormal(
  figure: Figure,
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): { x: number; y: number; z: number } {
  const r = figureRadius(figure, x, y, z);
  const length = Math.hypot(x, y, z) || 1;
  // Point de l'ellipsoïde, puis gradient de x²/a² + y²/c² + z²/b².
  const px = (x / length) * r;
  const py = (y / length) * r;
  const pz = (z / length) * r;
  const gx = px / figure.a ** 2;
  const gy = py / figure.c ** 2;
  const gz = pz / figure.b ** 2;
  const g = Math.hypot(gx, gy, gz) || 1;
  out.x = gx / g;
  out.y = gy / g;
  out.z = gz / g;
  return out;
}

/** Une figure qui ne s'écarte de la sphère nulle part (les trois demi-axes égaux à 1). */
export function isSphere(figure: Figure): boolean {
  return figure.a === 1 && figure.b === 1 && figure.c === 1;
}

/**
 * Pousse chaque sommet d'un tableau de positions sur l'ellipsoïde de rayon `radius × figure`, le
 * long de sa direction, et réécrit les normales. Les UV ne bougent pas : la texture reste en
 * latitude planétocentrique. `positions` et `normals` sont des triplets (x, y, z) à plat, comme
 * les attributs d'une `BufferGeometry`.
 */
export function deformToFigure(
  positions: Float32Array | number[],
  normals: Float32Array | number[] | null,
  radius: number,
  figure: Figure
): void {
  const n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    const length = Math.hypot(x, y, z);
    if (!(length > 0)) continue;
    const r = (radius * figureRadius(figure, x, y, z)) / length;
    positions[i] = x * r;
    positions[i + 1] = y * r;
    positions[i + 2] = z * r;
    if (normals) {
      figureNormal(figure, x, y, z, n);
      normals[i] = n.x;
      normals[i + 1] = n.y;
      normals[i + 2] = n.z;
    }
  }
}
