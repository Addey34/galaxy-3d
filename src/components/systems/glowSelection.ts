/**
 * QUI BRILLE, ET COMBIEN — le contrat de sélection du halo lumineux (`GlowPass`).
 *
 * Avant, le halo sélectionnait ses sources par LUMINANCE : tout pixel au-dessus d'un seuil
 * bavait. Le fond de ciel en faisait partie — un JPEG dont les étoiles sont des blocs de
 * compression 8×8 —, et le halo en reprenait la forme : des carrés lumineux. La sélection est
 * désormais DÉCLARATIVE, par calques Three.js :
 *
 *   - `GLOW_LAYER` : ce qui émet un halo (Soleil, étoiles ponctuelles, lumières de ville) ;
 *   - `OCCLUDER_LAYER` : ce qui peut le CACHER (surfaces des corps, modèles de forme). Il est
 *     dessiné en noir dans la passe de halo, pour que le Soleil ne rayonne pas à travers la
 *     Lune pendant une éclipse ni une étoile à travers une planète.
 *
 * Le fond de ciel n'est sur aucun des deux : il ne brille plus, par construction.
 *
 * Chaque source déclare aussi son INTENSITÉ. Un réglage unique ne pouvait pas convenir à la
 * fois au Soleil — un grand disque très lumineux — et à une ville : mesuré, régler les villes
 * sur leur lueur d'avant faisait un halo solaire 2,6 fois plus fort. Une intensité distincte
 * = un calque de classe distinct (à partir de `FIRST_CLASS_LAYER`), que `GlowPass` rend et
 * pondère séparément.
 *
 * Faire briller un nouvel élément = un appel `markGlowSource(objet, intensité)` là où on le
 * crée. Rien d'autre à toucher : ni seuil à régler, ni passe à modifier. Les calques
 * s'AJOUTENT au calque 0 : l'objet reste rendu normalement dans la scène.
 */
import type * as THREE from 'three';

/** Calque de toutes les sources de halo, quelle que soit leur intensité. */
export const GLOW_LAYER = 1;

/** Calque des objets qui peuvent masquer un halo (dessinés en noir dans la passe de halo). */
export const OCCLUDER_LAYER = 2;

/** Premier calque attribué aux classes d'intensité (Three.js en offre 32). */
const FIRST_CLASS_LAYER = 3;
const LAST_CLASS_LAYER = 31;

/** Intensité → calque de classe. Une intensité = une classe, attribuée à la demande. */
const classLayers = new Map<number, number>();

/** Une classe d'intensité : le calque qui la sélectionne et le gain qu'on lui applique. */
export interface GlowClass {
  layer: number;
  gain: number;
}

/**
 * Déclare `object` source de halo d'intensité `gain` (1 = référence), sans le retirer du
 * rendu normal. Deux sources de même intensité partagent une classe.
 */
export function markGlowSource<T extends THREE.Object3D>(
  object: T,
  gain = 1
): T {
  if (!(gain > 0)) throw new RangeError(`intensité de halo invalide : ${gain}`);
  let layer = classLayers.get(gain);
  if (layer === undefined) {
    layer = FIRST_CLASS_LAYER + classLayers.size;
    if (layer > LAST_CLASS_LAYER)
      throw new RangeError('trop d’intensités de halo distinctes (29 au plus)');
    classLayers.set(gain, layer);
  }
  object.layers.enable(GLOW_LAYER);
  object.layers.enable(layer);
  return object;
}

/** Déclare `object` capable de masquer un halo, sans le retirer du rendu normal. */
export function markGlowOccluder<T extends THREE.Object3D>(object: T): T {
  object.layers.enable(OCCLUDER_LAYER);
  return object;
}

/** Classes d'intensité déclarées jusqu'ici, par gain croissant. */
export function glowClasses(): GlowClass[] {
  return [...classLayers.entries()]
    .map(([gain, layer]) => ({ gain, layer }))
    .sort((a, b) => a.gain - b.gain);
}

/** Vrai si `object` émet un halo. */
export function isGlowSource(object: THREE.Object3D): boolean {
  return (object.layers.mask & (1 << GLOW_LAYER)) !== 0;
}

/** Intensité de halo de `object`, ou 0 s'il n'en émet pas. */
export function glowGainOf(object: THREE.Object3D): number {
  for (const [gain, layer] of classLayers)
    if ((object.layers.mask & (1 << layer)) !== 0) return gain;
  return 0;
}

/** Vrai si `object` peut masquer un halo. */
export function isGlowOccluder(object: THREE.Object3D): boolean {
  return (object.layers.mask & (1 << OCCLUDER_LAYER)) !== 0;
}
