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
