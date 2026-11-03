/**
 * OÙ ÉCRIRE LE NOM D'UNE CONSTELLATION. Pur, sans DOM. Module à part de `constellations.ts` : celui-ci
 * est importé par le démarrage (`Starfield`), celui-là seulement par la couche des noms, chargée à la demande.
 */

/** Indices distincts des étoiles d'une figure, dans l'ordre de première apparition. */
export function distinctStars(lines: readonly (readonly number[])[]): number[] {
  const seen = new Set<number>();
  for (const line of lines) for (const i of line) seen.add(i);
  return [...seen];
}

/**
 * Direction (vecteur unitaire) où écrire le nom d'une constellation : la somme des directions de
 * ses étoiles, normalisée. Calculée sur les positions COURANTES du tampon (mouvement propre
 * inclus), donc le nom suit la figure. Rend `false` quand les directions s'annulent (figure qui
 * ferait le tour du ciel) : mieux vaut aucun nom qu'un nom posé au hasard.
 */
export function constellationAnchor(
  positions: ArrayLike<number>,
  indices: readonly number[],
  out: [number, number, number]
): boolean {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const i of indices) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const n = Math.hypot(x, y, z);
    if (n === 0) continue;
    sx += x / n;
    sy += y / n;
    sz += z / n;
  }
  const length = Math.hypot(sx, sy, sz);
  if (length < 0.05 * indices.length) return false;
  out[0] = sx / length;
  out[1] = sy / length;
  out[2] = sz / length;
  return true;
}
