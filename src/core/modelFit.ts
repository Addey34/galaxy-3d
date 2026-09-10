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
