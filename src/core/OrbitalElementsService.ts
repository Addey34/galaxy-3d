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
import { Body, HelioVector } from 'astronomy-engine';
// Convention d'échelle de temps (ΔT) installée dans astronomy-engine : cf. timeScale.ts.
import './timeScale';
import { eclipticToScene, equatorialToScene } from './frames';
import { keplerianPositionEcliptic, type OrbitalElements } from './kepler';

export class OrbitalElementsService {
  /**
   * Position héliocentrique d'un corps en UA, dans le repère Three.js, propagée depuis ses
   * éléments orbitaux à la date donnée.
   *
   * Des éléments `barycentric` donnent une position par rapport au barycentre : on y ajoute
   * le barycentre vu du Soleil (astronomy-engine, ~4 µs l'appel), pris à `frameDate`. Pour
   * la POSITION du corps, `frameDate` est la date elle-même. Pour une LIGNE d'orbite, on
   * passe la date affichée : l'ellipse barycentrique est tracée autour du Soleil tel qu'il
   * est maintenant, le corps tombe exactement dessus, et 4 096 points ne coûtent qu'un appel
   * (17 ms par corps sinon). Le décalage reste sous 0,01 UA, invisible à 40 UA.
   */
  getHeliocentricAU(
    elements: OrbitalElements,
    date: Date,
    frameDate: Date = date
  ): THREE.Vector3 {
    const p = keplerianPositionEcliptic(elements, date);
    const position = eclipticToScene(p.x, p.y, p.z);
    if (!elements.barycentric) return position;
    const ssb = HelioVector(Body.SSB, frameDate);
    return position.add(equatorialToScene(ssb.x, ssb.y, ssb.z));
  }
}
