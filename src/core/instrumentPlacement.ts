/**
 * OÙ PEINDRE UN OBJET D'INSTRUMENT, DANS LES DEUX MODES ET PENDANT LE MORPH.
 *
 * Hors d'une phase de satellite (cf. `satellitePhases.ts`), c'est `scaleToScene` : la
 * compression radiale √r du Soleil en Éducatif, la vraie échelle en Explo. Pendant une phase,
 * la sonde est placée comme une lune de son corps : la position Éducatif du corps, plus le
 * vecteur relatif compressé par `educationalSatelliteDistance` (la règle des lunes). L'Explo
 * reste la vraie position, AU × SQRT_K, sans exception : c'est l'invariant du mode.
 *
 * Le morph interpole les deux positions, exactement comme `OrbitalMechanics` interpole celle
 * d'un corps : la sonde reste donc collée à sa planète pendant toute la transition.
 */
import * as THREE from 'three';
import { SQRT_K } from './ScaleService';
import { scaleToScene } from './overlayScale';
import { educationalSatelliteDistance } from './educationalScale';
import { activeSatelliteBody, type SatellitePhase } from './satellitePhases';
import type { CelestialBodyConfig } from '@/types';

/** Le corps dont l'objet est le satellite à cette date, et sa position héliocentrique (UA). */
export interface SatelliteFrame {
  parent: CelestialBodyConfig;
  parentHelioAU: THREE.Vector3;
}

const educ = new THREE.Vector3();
const rel = new THREE.Vector3();

/**
 * Position scène d'un objet d'instrument à `helioAU` (UA, repère scène), écrite dans `out`.
 * `frame` absent : objet héliocentrique. Le parent doit être un corps HÉLIOCENTRIQUE, dont la
 * position Éducatif est `scaleToScene(parentHelioAU, 0)` (facteur de parent 1, comme dans
 * `OrbitalMechanics._computeEducPos`).
 */
export function placeInstrument(
  out: THREE.Vector3,
  helioAU: THREE.Vector3,
  frame: SatelliteFrame | null,
  morph: number
): THREE.Vector3 {
  if (!frame) return scaleToScene(out, helioAU.x, helioAU.y, helioAU.z, morph);
  const { parent, parentHelioAU } = frame;
  rel.subVectors(helioAU, parentHelioAU);
  const distanceAU = rel.length();
  scaleToScene(educ, parentHelioAU.x, parentHelioAU.y, parentHelioAU.z, 0);
  if (distanceAU > 1e-15)
    educ.addScaledVector(
      rel,
      educationalSatelliteDistance(parent, distanceAU) / distanceAU
    );
  const t = THREE.MathUtils.clamp(morph, 0, 1);
  return out
    .copy(helioAU)
    .multiplyScalar(SQRT_K)
    .sub(educ)
    .multiplyScalar(t)
    .add(educ);
}

/** Place un objet d'instrument nommé à `helioAU`, pour une date et un état de morph. */
export type InstrumentPlacer = (
  out: THREE.Vector3,
  name: string,
  helioAU: THREE.Vector3,
  date: Date,
  morph: number
) => THREE.Vector3;

/**
 * Le placeur des sondes : cherche la phase de satellite active à `date` (cf.
 * `satellitePhases.ts`), lit la position du corps par `parentHelioAU` (la règle même qui le
 * dessine) et délègue à `placeInstrument`. Un objet sans phase, ou dont le corps n'a pas de
 * position à cette date, reste héliocentrique. La position d'un corps est gardée pour la date
 * courante : les ancres caméra et les marqueurs la demandent chacun à chaque image.
 */
export function spacecraftPlacer(
  missions: readonly {
    name: string;
    satelliteOf: readonly SatellitePhase[];
  }[],
  bodies: Readonly<Record<string, CelestialBodyConfig>>,
  parentHelioAU: (name: string, date: Date) => THREE.Vector3 | null
): InstrumentPlacer {
  const phases = new Map(missions.map((m) => [m.name, m.satelliteOf]));
  const cache = new Map<string, { ms: number; au: THREE.Vector3 | null }>();
  const parentAt = (body: string, date: Date): THREE.Vector3 | null => {
    const ms = date.getTime();
    const hit = cache.get(body);
    if (hit && hit.ms === ms) return hit.au;
    const au = parentHelioAU(body, date);
    cache.set(body, { ms, au });
    return au;
  };
  return (out, name, helioAU, date, morph) => {
    const body = activeSatelliteBody(phases.get(name) ?? [], date);
    const parent = body ? bodies[body] : undefined;
    const parentAU = body && parent ? parentAt(body, date) : null;
    return placeInstrument(
      out,
      helioAU,
      parent && parentAU ? { parent, parentHelioAU: parentAU } : null,
      morph
    );
  };
}
