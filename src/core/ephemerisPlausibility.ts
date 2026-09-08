import * as THREE from 'three';
import type { CelestialBodyConfig } from '@/types';

/**
 * Garde-fous de PLAUSIBILITE d'une position issue d'une source numerique.
 *
 * Un fichier Horizons/SPK peut etre absent, perime, ou avoir ete genere avec un mauvais
 * centre : dans tous ces cas il repond quand meme, avec une position fausse et aucune erreur.
 * Ces deux fonctions sont le seul filet entre une telle reponse et la scene.
 *
 * Module a part entiere, et pas un detail d'`OrbitalMechanics` : elles sont consommees par le
 * resolveur de position ET par un test offline qui balaie les binaires committes. Leur nom de
 * fichier de test (`ephemerisPlausibility.test.ts`) les designait deja comme un module
 * autonome bien avant qu'elles en aient un.
 */

/**
 * Les éléments orbitaux relatifs servent aussi de borne de cohérence pour une source précise.
 * Une éphéméride enfant-parent valide ne peut pas s'éloigner durablement de son orbite publiée,
 * ni s'en rapprocher. Cette vérification protège notamment les anciens fichiers Horizons
 * générés avec le Soleil comme centre, puis interprétés à tort comme des vecteurs
 * parent-relative.
 */
const RELATIVE_EPHEMERIS_TOLERANCE = 2;
const HELIOCENTRIC_DISTANCE_MIN_FACTOR = 0.5;
const HELIOCENTRIC_DISTANCE_MAX_FACTOR = 2;

/** Exportée pour être réutilisée par un test offline sur les fichiers Horizons committés. */
export function isPlausibleRelativePosition(
  position: THREE.Vector3,
  cfg: CelestialBodyConfig
): boolean {
  const elements = cfg.relativeOrbitalElements;
  if (!elements) return true;
  const distanceAU = position.length();
  const apoapsisAU = elements.semiMajorAxisAU * (1 + elements.eccentricity);
  const periapsisAU = elements.semiMajorAxisAU * (1 - elements.eccentricity);
  // Les DEUX bornes, et la basse n'est pas décorative : elle est celle qui manquait.
  // Une position qui s'effondre vers la planète est tout aussi fausse qu'une qui s'en
  // échappe, mais elle passait sans être vue — c'est ainsi qu'Encelade a pu se promener
  // entre 1/11 et 1 fois son rayon orbital pendant des mois, sous un garde-fou qui ne
  // regardait que le haut.
  return (
    distanceAU >= periapsisAU / RELATIVE_EPHEMERIS_TOLERANCE &&
    distanceAU <= apoapsisAU * RELATIVE_EPHEMERIS_TOLERANCE
  );
}

/**
 * Vérifie qu'une position précise reste à la distance attendue du Soleil. Les fichiers
 * Horizons optionnels peuvent être absents, obsolètes ou avoir été générés avec un mauvais
 * centre ; dans ce cas, Astronomy Engine/Kepler fournit une trajectoire cohérente plutôt
 * qu'une orbite visuelle épaissie par des points provenant de plusieurs rayons.
 */
/** Exportée pour être réutilisée par un test offline sur les fichiers Horizons committés. */
export function isPlausibleHeliocentricPosition(
  position: THREE.Vector3,
  cfg: CelestialBodyConfig
): boolean {
  const expectedDistanceAU = cfg.realData?.distanceAU;
  if (!expectedDistanceAU || expectedDistanceAU <= 0) return true;
  const distanceAU = position.length();
  return (
    distanceAU >= expectedDistanceAU * HELIOCENTRIC_DISTANCE_MIN_FACTOR &&
    distanceAU <= expectedDistanceAU * HELIOCENTRIC_DISTANCE_MAX_FACTOR
  );
}
