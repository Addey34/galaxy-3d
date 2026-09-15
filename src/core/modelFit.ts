/**
 * Mise à l'échelle d'un modèle de forme sur le rayon du catalogue.
 *
 * Un .glb arrive dans l'unité de son auteur — kilomètres pour un produit scientifique, unités
 * arbitraires pour un export d'atelier. La scène n'a pas à le savoir : on mesure le corps et on
 * le ramène au rayon déclaré. C'est aussi ce qui empêche un modèle mal exporté de faire
 * soudain mille fois la taille de sa planète.
 *
 * Pur et testé ici plutôt qu'en ligne dans `CelestialObject` — la géométrie se vérifie sans
 * navigateur, et ce calcul a déjà été faux une fois (voir `boundingRadius`).
 */

/**
 * Plus grande distance entre un centre et un nuage de points.
 *
 * PIÈGE, payé une fois : `THREE.Box3.getBoundingSphere()` ne renvoie PAS cela. Elle renvoie la
 * sphère circonscrite à la BOÎTE englobante, dont le rayon vaut la demi-diagonale — soit √3
 * fois le rayon réel pour un corps à peu près rond. Un modèle mis à l'échelle avec cette
 * valeur sort 42 % trop petit, et rien ne le signale : il a simplement l'air d'être à la bonne
 * taille tant qu'on ne le compare pas à la sphère qu'il remplace.
 *
 * @param positions coordonnées à plat `[x, y, z, x, y, z, …]`
 * @param centre point de référence, `[x, y, z]`
 */
export function boundingRadius(
  positions: ArrayLike<number>,
  centre: readonly [number, number, number]
): number {
  let maxSquared = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const dx = positions[i]! - centre[0];
    const dy = positions[i + 1]! - centre[1];
    const dz = positions[i + 2]! - centre[2];
    const squared = dx * dx + dy * dy + dz * dz;
    if (squared > maxSquared) maxSquared = squared;
  }
  return Math.sqrt(maxSquared);
}

/**
 * Facteur d'échelle amenant un corps de rayon `measured` au rayon `target`.
 * Renvoie `null` si l'un des deux est nul ou absurde — l'appelant garde alors sa sphère plutôt
 * que d'afficher un corps de taille infinie ou nulle.
 */
export function fitScale(measured: number, target: number): number | null {
  if (!Number.isFinite(measured) || !Number.isFinite(target)) return null;
  if (measured <= 0 || target <= 0) return null;
  return target / measured;
}

/**
 * Volume et centroïde volumique d'un maillage triangulé FERMÉ (théorème de divergence : somme
 * des tétraèdres origine-triangle). Le centroïde est le centre de masse d'un corps homogène —
 * c'est ce point, et non le centre de la boîte englobante, que l'éphéméride positionne. Pour
 * un corps allongé et bosselé comme Éros, les deux diffèrent de plusieurs centaines de mètres.
 *
 * Le volume est SIGNÉ : positif si les triangles sont orientés vers l'extérieur. On en rend la
 * valeur absolue, l'orientation des fichiers publiés n'étant pas garantie.
 *
 * @param index triplets d'indices, ou `null` pour un maillage non indexé (triangles consécutifs)
 */
export function meshVolume(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null
): { volume: number; centroid: [number, number, number] } {
  const count = index ? index.length : positions.length / 3;
  const at = (k: number): number => (index ? index[k]! : k) * 3;
  let volume = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = at(t);
    const b = at(t + 1);
    const c = at(t + 2);
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const bx = positions[b]!;
    const by = positions[b + 1]!;
    const bz = positions[b + 2]!;
    const qx = positions[c]!;
    const qy = positions[c + 1]!;
    const qz = positions[c + 2]!;
    const v =
      (ax * (by * qz - bz * qy) -
        ay * (bx * qz - bz * qx) +
        az * (bx * qy - by * qx)) /
      6;
    volume += v;
    cx += (v * (ax + bx + qx)) / 4;
    cy += (v * (ay + by + qy)) / 4;
    cz += (v * (az + bz + qz)) / 4;
  }
  if (volume === 0) return { volume: 0, centroid: [0, 0, 0] };
  return {
    volume: Math.abs(volume),
    centroid: [cx / volume, cy / volume, cz / volume],
  };
}

/**
 * Rayon de la sphère de même volume — c'est le « rayon moyen » que publient les catalogues
 * (Éros 8,42 km, Bennu 0,242 km) et donc celui qu'il faut faire coïncider avec le rayon de la
 * sphère de repli.
 *
 * PIÈGE, payé une fois : le rayon MAXIMAL (`boundingRadius`) n'est pas un rayon moyen. Ajuster
 * le sommet le plus lointain sur le rayon catalogue affiche un corps allongé trop petit du
 * rapport R_max / R_équivalent — mesuré : 1,18 pour Bennu (livré 15 % trop petit), 2,09 pour
 * Éros, 2,00 pour Ida. Deux fois trop petit, ce serait une violation directe de l'invariant
 * Explo : les tailles physiques y sont vraies.
 */
export function volumeEquivalentRadius(volume: number): number {
  return Math.cbrt((3 * Math.abs(volume)) / (4 * Math.PI));
}

/**
 * Axe principal de PLUS GRANDE inertie d'un solide homogène délimité par le maillage, en
 * vecteur unitaire (signe arbitraire).
 *
 * Pourquoi il compte : un petit corps tourne, sauf exception, autour de cet axe (c'est l'état
 * de plus basse énergie à moment cinétique donné). Or la scène fait tourner chaque corps autour
 * de son Y LOCAL. Un fichier dont le pôle est ailleurs — la convention des produits PDS est Z
 * — ferait donc tourner le corps autour du mauvais axe, sans rien qui le signale.
 *
 * Méthode : covariance des tétraèdres origine-triangle (Σ V/20 · (Σ vᵢvᵢᵀ + (Σvᵢ)(Σvᵢ)ᵀ)),
 * ramenée au centroïde ; l'axe de plus grande inertie est le vecteur propre de PLUS PETITE
 * valeur propre de cette covariance. Diagonalisation de Jacobi 3×3.
 */
export function maxInertiaAxis(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null
): [number, number, number] {
  const { centroid } = meshVolume(positions, index);
  const count = index ? index.length : positions.length / 3;
  const at = (k: number): number => (index ? index[k]! : k) * 3;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const p = [at(t), at(t + 1), at(t + 2)].map((o) => [
      positions[o]! - centroid[0],
      positions[o + 1]! - centroid[1],
      positions[o + 2]! - centroid[2],
    ]);
    const [a, b, c] = p as [number[], number[], number[]];
    const v =
      (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
        a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
      6;
    total += v;
    const s = [0, 1, 2].map((k) => a[k]! + b[k]! + c[k]!);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        cov[i * 3 + j]! +=
          (v / 20) *
          (a[i]! * a[j]! + b[i]! * b[j]! + c[i]! * c[j]! + s[i]! * s[j]!);
  }
  if (total < 0) for (let i = 0; i < 9; i++) cov[i] = -cov[i]!;
  const { values, vectors } = jacobiEigen3(cov);
  const k = values.indexOf(Math.min(...values));
  return [vectors[k * 3]!, vectors[k * 3 + 1]!, vectors[k * 3 + 2]!];
}

/** Valeurs et vecteurs propres d'une matrice symétrique 3×3 (rotations de Jacobi). */
function jacobiEigen3(m: number[]): { values: number[]; vectors: number[] } {
  const a = [...m];
  // v stocke les vecteurs propres en COLONNES ; on les rend en lignes à la fin.
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1]! ** 2 + a[2]! ** 2 + a[5]! ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t =
        Math.sign(theta || 1) /
        (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!;
        const akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!;
        const aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!;
        const vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const vectors: number[] = [];
  for (let col = 0; col < 3; col++)
    vectors.push(v[col]!, v[3 + col]!, v[6 + col]!);
  return { values: [a[0]!, a[4]!, a[8]!], vectors };
}
