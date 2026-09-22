import { SQRT_K } from './ScaleService';
import type { CelestialBodyConfig } from '@/types';

/**
 * Echelle des orbites imbriquees en mode Educatif.
 *
 * Module a part car il est lu des DEUX cotes de la frontiere position / trace : par le calcul
 * de la position educative d'une lune et par le trace de sa ligne d'orbite. Les deux doivent
 * appliquer exactement le meme facteur, sinon la lune ne repose plus sur sa propre courbe.
 */

/** Marge visuelle minimale entre un parent et ses satellites en mode éducatif. */
export const EDUCATIVE_PARENT_GAP = 0.12;

/**
 * Échelle commune des orbites parentRelative d'un même parent.
 * Elle évite que les corps satellites soient cachés par le parent tout en
 * conservant leur ordre de distance réel.
 */
export function educationalParentOrbitScale(
  parent: CelestialBodyConfig | undefined
): number {
  if (!parent?.satellites) return 1;

  let scale = 1;
  for (const satellite of Object.values(parent.satellites)) {
    if (satellite.frame !== 'parentRelative') continue;
    const distanceAU = satellite.realData?.distanceAU;
    if (!distanceAU || distanceAU <= 0) continue;
    const rawRadius = Math.sqrt(distanceAU) * SQRT_K;
    const requiredRadius =
      parent.radius + satellite.radius + EDUCATIVE_PARENT_GAP;
    scale = Math.max(scale, requiredRadius / rawRadius);
  }
  return scale;
}

/**
 * Distance Éducatif (unités scène) d'un satellite SANS rayon à son parent : la même règle que
 * pour une lune, appliquée à un objet qui ne figure pas dans `parent.satellites`.
 *
 * Une lune y contribue par `educationalParentOrbitScale`, facteur commun calculé pour que la
 * plus proche sorte de la sphère agrandie du parent. Une sonde en orbite n'en fait pas partie,
 * et peut passer plus près que la lune la plus proche (Juno frôle Jupiter à chaque périjove,
 * sous l'orbite d'Amalthée) : on lui applique donc le même facteur, puis la même exigence
 * `parent.radius + rayon + EDUCATIVE_PARENT_GAP`, avec un rayon nul. L'ordre des distances
 * est conservé au-delà de la lune la plus proche ; en deçà, l'objet se pose à la surface
 * agrandie plutôt qu'à l'intérieur, là où la sphère Éducatif elle-même a déjà cessé d'être à
 * l'échelle.
 */
export function educationalSatelliteDistance(
  parent: CelestialBodyConfig,
  distanceAU: number
): number {
  const raw = Math.sqrt(Math.max(distanceAU, 0)) * SQRT_K;
  return Math.max(
    raw * educationalParentOrbitScale(parent),
    parent.radius + EDUCATIVE_PARENT_GAP
  );
}

/**
 * Distance réelle (UA) sous laquelle `educationalSatelliteDistance` pose un satellite sans
 * rayon sur la surface agrandie du parent : là où le facteur commun ne suffit plus à le sortir
 * de la sphère Éducatif.
 */
export function educationalSurfaceClampAU(parent: CelestialBodyConfig): number {
  const surface =
    (parent.radius + EDUCATIVE_PARENT_GAP) /
    (SQRT_K * educationalParentOrbitScale(parent));
  return surface * surface;
}
