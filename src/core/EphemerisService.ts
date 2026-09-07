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

import {
  Body,
  HelioVector,
  JupiterMoons,
  RotationAxis,
} from 'astronomy-engine';
import * as THREE from 'three';
import type { JupiterMoonKey } from '@/types';
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
    return this.getHeliocentricAU(body, date).sub(
      this.getHeliocentricAU(parentBody, date)
    );
  }

  /**
   * Position jovicentrique d'une des quatre lunes galiléennes, en UA et dans le repère
   * Three.js. astronomy-engine fournit directement ces vecteurs relatifs au centre de Jupiter.
   */
  getJupiterMoonRelativeAU(moon: JupiterMoonKey, date: Date): THREE.Vector3 {
    const vector = JupiterMoons(date)[moon];
    return equatorialToScene(vector.x, vector.y, vector.z);
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
    return equatorialToScene(
      axis.north.x,
      axis.north.y,
      axis.north.z
    ).normalize();
  }

  /**
   * Direction du MOMENT CINÉTIQUE DE SPIN d'un corps, dans le repère Three.js (vecteur
   * unité). C'est autour de ce vecteur, et en main droite, que le corps tourne réellement —
   * la grandeur dont le rendu a besoin, là où `getNorthPoleDirection` ne donne qu'un repère
   * cartographique.
   *
   * Les deux ne coïncident pas toujours, et c'est tout l'enjeu : le rapport WGCCRE 2015
   * n'emploie pas la même convention pour tout le monde. Pour les planètes et leurs
   * satellites, le « nord » est le pôle situé du côté nord du plan invariable, quel que soit
   * le sens de rotation : Vénus et Uranus tournent donc en main GAUCHE autour de leur nord
   * IAU. Pour les planètes naines, astéroïdes et comètes, c'est au contraire la règle de la
   * main droite qui définit le pôle : le nord de Pluton pointe sous l'écliptique et sa
   * rotation est bien directe autour de lui.
   *
   * On ne peut donc PAS déduire le sens d'une obliquité « > 90° » : le critère dirait vrai
   * pour Vénus et Uranus, et faux pour Pluton. On lit le sens à sa source — celui de la
   * dérivée de l'angle de méridien W, positif en main droite —, ce qui couvre les deux
   * conventions sans avoir à savoir laquelle s'applique.
   *
   * Mémorisé par corps : le sens de rotation d'un corps ne change pas, et cette méthode est
   * appelée pour chaque corps à chaque recalcul de positions.
   */
  getSpinAxisDirection(body: Body, date: Date): THREE.Vector3 {
    const north = this.getNorthPoleDirection(body, date);
    return this._spinsRightHanded(body) ? north : north.multiplyScalar(-1);
  }

  private readonly _rightHanded = new Map<Body, boolean>();

  /**
   * Le corps tourne-t-il en main droite autour de son pôle nord WGCCRE ? Lu sur le signe de
   * dW/dt. La base de 100 s est un compromis borné des deux côtés : assez courte pour
   * qu'aucun corps ne puisse faire un tour complet (Jupiter, le plus rapide du catalogue,
   * n'avance que d'un degré) et lever l'ambiguïté modulo 360°, assez longue pour que l'écart
   * domine très largement la troncature sur W (Vénus, la plus lente, avance encore de 1,7e-3
   * degré, contre ~1e-9 de bruit).
   */
  private _spinsRightHanded(body: Body): boolean {
    const cached = this._rightHanded.get(body);
    if (cached !== undefined) return cached;

    const epoch = new Date('2000-01-01T12:00:00Z');
    const w1 = RotationAxis(body, epoch).spin;
    const w2 = RotationAxis(body, new Date(epoch.getTime() + 100_000)).spin;
    const advance = ((((w2 - w1) % 360) + 540) % 360) - 180;
    const rightHanded = advance > 0;
    this._rightHanded.set(body, rightHanded);
    return rightHanded;
  }
}
