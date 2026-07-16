/**
 * Wrapper autour d'astronomy-engine.
 *
 * Fournit des positions en UA dans le système de coordonnées Three.js :
 *   - Plan XZ = plan écliptique (orbites des planètes)
 *   - Axe Y   = pôle nord écliptique (quasi-immobile)
 *
 * Conversion équatorial J2000 → écliptique → Three.js déléguée à `frames.ts`.
 * Les méthodes prennent l'enum `Body` d'astronomy-engine directement : le mapping
 * nom → Body vit désormais sur le catalogue des corps (`CelestialBodyConfig.astroBody`).
 */

import { Body, HelioVector, RotationAxis } from 'astronomy-engine';
import * as THREE from 'three';
import { equatorialToScene } from './frames';

export class EphemerisService {
  /**
   * Position héliocentrique d'un corps en UA, dans le repère Three.js.
   * Le Soleil (Body.Sun) retourne naturellement (0,0,0).
   */
  getHeliocentricAU(body: Body, date: Date): THREE.Vector3 {
    const vec = HelioVector(body, date);
    return equatorialToScene(vec.x, vec.y, vec.z);
  }

  /**
   * Position d'un corps en UA relative à son parent (satellites `frame: 'parentRelative'`),
   * dans le repère Three.js. Généralise l'ancien géocentrique à n'importe quel parent :
   * `helio(corps) − helio(parent)`. Pour la Lune (parent = Terre) le résultat est identique
   * au géocentrique d'astronomy-engine à la précision machine près.
   *
   * `equatorialToScene` étant linéaire, la soustraction commute avec la conversion : on la
   * fait donc directement en coordonnées scène.
   */
  getParentRelativeAU(body: Body, parentBody: Body, date: Date): THREE.Vector3 {
    return this.getHeliocentricAU(body, date).sub(this.getHeliocentricAU(parentBody, date));
  }

  /**
   * Direction du pôle nord de rotation d'un corps, dans le repère Three.js (vecteur unité).
   *
   * Utilise le modèle IAU 2015 (`RotationAxis`) : `axis.north` est le pôle nord du corps
   * exprimé en équatorial J2000 (EQJ) — le même repère que `HelioVector`. On le passe donc
   * dans le même `equatorialToScene` que les positions : comme c'est une rotation propre
   * (déterminant +1), elle s'applique telle quelle à une direction.
   *
   * Le résultat encode à la fois l'obliquité ET l'azimut réels de l'axe dans le plan
   * écliptique, y compris le décalage dû à l'inclinaison orbitale du corps.
   */
  getNorthPoleDirection(body: Body, date: Date): THREE.Vector3 {
    const axis = RotationAxis(body, date);
    return equatorialToScene(axis.north.x, axis.north.y, axis.north.z).normalize();
  }
}
