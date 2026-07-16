/**
 * Source de position pour les corps définis par des éléments orbitaux képlériens plutôt
 * que par une éphéméride astronomy-engine (astéroïdes, comètes, géocroiseurs, planètes
 * naines, lunes mineures).
 *
 * Symétrique de `EphemerisService` : même contrat (`getHeliocentricAU(…, date) → Vector3`
 * dans le repère Three.js), afin qu'`OrbitalMechanics` traite les deux sources de façon
 * uniforme. Le calcul képlérien pur vit dans `kepler.ts` (testé) ; ici on ne fait que le
 * relier au repère de la scène via `frames.eclipticToScene`.
 */
import * as THREE from 'three';
import { eclipticToScene } from './frames';
import { keplerianPositionEcliptic, type OrbitalElements } from './kepler';

export class OrbitalElementsService {
  /**
   * Position héliocentrique d'un corps en UA, dans le repère Three.js, propagée depuis ses
   * éléments orbitaux à la date donnée.
   */
  getHeliocentricAU(elements: OrbitalElements, date: Date): THREE.Vector3 {
    const p = keplerianPositionEcliptic(elements, date);
    return eclipticToScene(p.x, p.y, p.z);
  }
}
