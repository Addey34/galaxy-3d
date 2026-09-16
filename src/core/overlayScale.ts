import * as THREE from 'three';
import { SQRT_K } from './ScaleService';

/**
 * ÉCHELLE DES COUCHES D'INSTRUMENT PENDANT LE MORPH ÉDUC↔EXPLO.
 *
 * Les corps 3D ne sautent pas d'un mode à l'autre : `OrbitalMechanics` interpole leur position
 * pendant 1,2 s (`scaleMorph`, 0 = Éducatif, 1 = Explo). Une couche 2D qui dessine ses marqueurs
 * à l'échelle Explo pendant ce temps-là part instantanément à sa position finale pendant que les
 * planètes glissent encore — les marqueurs se décollent des corps qu'ils annoncent.
 *
 * Les deux positions étant COLINÉAIRES (même direction, rayon compressé ou non), interpoler les
 * rayons revient exactement à interpoler les positions, ce que fait `OrbitalMechanics`.
 */
export function morphedSceneRadius(radiusAU: number, morph: number): number {
  if (!(radiusAU > 0)) return 0;
  const t = THREE.MathUtils.clamp(morph, 0, 1);
  const educ = Math.sqrt(radiusAU) * SQRT_K;
  const explo = radiusAU * SQRT_K;
  return educ + (explo - educ) * t;
}

/** UA (repère scène) → unités scène pour un morph donné, écrit dans `out`. */
export function scaleToScene(
  out: THREE.Vector3,
  x: number,
  y: number,
  z: number,
  morph: number
): THREE.Vector3 {
  const r = Math.hypot(x, y, z);
  if (r < 1e-12) return out.set(0, 0, 0);
  const k = morphedSceneRadius(r, morph) / r;
  return out.set(x * k, y * k, z * k);
}
