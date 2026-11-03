/**
 * SÉLECTION D'UN POINT DU CIEL : pur, sans DOM ni Three.js.
 *
 * Les repères du ciel (étoiles hôtes d'exoplanètes) sont à l'infini : les viser ne demande pas de
 * projeter 4 847 points à l'écran, il suffit de comparer des DIRECTIONS. Le rayon du clic part de
 * la caméra, les repères sont centrés sur elle : l'angle entre le rayon et la direction d'un
 * repère est donc l'écart exact vu depuis la caméra.
 */

/** Demi-angle (rad) que couvrent `pixels` pixels sur une image de `heightPx` pixels de haut. */
export function angularToleranceRad(
  fovDeg: number,
  heightPx: number,
  pixels: number
): number {
  if (heightPx <= 0) return 0;
  return ((fovDeg * Math.PI) / 180 / heightPx) * pixels;
}

/**
 * Indice du point le plus proche du rayon (vecteur unitaire `ray`), à moins de `maxAngleRad`, ou
 * -1. `positions` : triplets x, y, z de directions quelconques (non normalisées : c'est leur
 * direction qui compte, pas leur longueur).
 */
export function nearestDirection(
  positions: ArrayLike<number>,
  count: number,
  ray: readonly [number, number, number],
  maxAngleRad: number
): number {
  const minCos = Math.cos(maxAngleRad);
  let best = -1;
  let bestCos = minCos;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const length = Math.hypot(x, y, z);
    if (length === 0) continue;
    const cos = (x * ray[0] + y * ray[1] + z * ray[2]) / length;
    if (cos >= bestCos) {
      best = i;
      bestCos = cos;
    }
  }
  return best;
}

/**
 * Noms commençant par `query` d'abord, puis ceux qui la contiennent, sans casse ni espaces de
 * bord ; au plus `limit` résultats, sans doublon. Une requête de moins de 2 caractères ne rend rien
 * (la liste complète n'aide personne).
 */
export function searchNames(
  names: readonly string[],
  query: string,
  limit: number
): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) starts.push(name);
    else if (lower.includes(q)) contains.push(name);
    else continue;
    seen.add(name);
  }
  return [...starts, ...contains].slice(0, limit);
}
