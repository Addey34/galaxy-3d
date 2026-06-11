/**
 * Wrapper autour d'astronomy-engine.
 *
 * Fournit des positions en UA dans le système de coordonnées Three.js :
 *   - Plan XZ = plan écliptique (orbites des planètes)
 *   - Axe Y   = pôle nord écliptique (quasi-immobile)
 *
 * Conversion : équatorial J2000 → écliptique → Three.js (XZ plane).
 */

import { Body, HelioVector, GeoVector, RotationAxis } from 'astronomy-engine';
import * as THREE from 'three';

// Obliquité de l'écliptique (inclinaison de l'axe terrestre) — 23.4394°
const OBLIQUITY_RAD = 23.4394 * (Math.PI / 180);
const COS_OBL = Math.cos(OBLIQUITY_RAD);
const SIN_OBL = Math.sin(OBLIQUITY_RAD);

// Mapping nom de corps → enum Body
const BODY_MAP: Record<string, Body | undefined> = {
  sun:     Body.Sun,
  mercury: Body.Mercury,
  venus:   Body.Venus,
  earth:   Body.Earth,
  moon:    Body.Moon,
  mars:    Body.Mars,
  jupiter: Body.Jupiter,
  saturn:  Body.Saturn,
  uranus:  Body.Uranus,
  neptune: Body.Neptune,
};

export class EphemerisService {
  /**
   * Position héliocentrique d'un corps en UA, dans le repère Three.js.
   * Retourne (0,0,0) pour le Soleil.
   * Retourne null si le corps est inconnu.
   */
  getHeliocentricAU(bodyName: string, date: Date): THREE.Vector3 | null {
    if (bodyName === 'sun') return new THREE.Vector3(0, 0, 0);

    const body = BODY_MAP[bodyName];
    if (!body) return null;

    const vec = HelioVector(body, date);
    return this._toScene(vec.x, vec.y, vec.z);
  }

  /**
   * Position géocentrique de la Lune en UA (relative au centre de la Terre).
   * À utiliser pour positionner la Lune dans le référentiel local de la Terre.
   */
  getMoonGeocentricAU(date: Date): THREE.Vector3 {
    const vec = GeoVector(Body.Moon, date, false);
    return this._toScene(vec.x, vec.y, vec.z);
  }

  /**
   * Direction du pôle nord de rotation d'un corps, dans le repère Three.js (vecteur unité).
   *
   * Utilise le modèle IAU 2015 (`RotationAxis`) : `axis.north` est le pôle nord du corps
   * exprimé en équatorial J2000 (EQJ) — **le même repère que `HelioVector`**. On le passe
   * donc dans le même `_toScene` que les positions : comme c'est une rotation propre
   * (déterminant +1), elle s'applique telle quelle à une direction (pas de translation).
   *
   * Le résultat encode à la fois l'obliquité ET l'azimut réels de l'axe dans le plan
   * écliptique, y compris le décalage dû à l'inclinaison orbitale du corps — ce qu'une
   * simple obliquité relative au plan orbital ne peut pas capturer. Retourne null si inconnu.
   */
  getNorthPoleDirection(bodyName: string, date: Date): THREE.Vector3 | null {
    const body = BODY_MAP[bodyName];
    if (!body) return null;
    const axis = RotationAxis(body, date);
    return this._toScene(axis.north.x, axis.north.y, axis.north.z).normalize();
  }

  /**
   * Convertit un vecteur équatorial J2000 (AU) vers le repère Three.js.
   *
   * Étape 1 — rotation obliquité : équatorial → écliptique
   *   ex =  x
   *   ey =  y·cos(ε) + z·sin(ε)   (dans le plan écliptique)
   *   ez = -y·sin(ε) + z·cos(ε)   (perpendiculaire, ≈ 0 pour les planètes)
   *
   * Étape 2 — mapping Three.js (plan XZ = plan écliptique, +Y = nord écliptique) :
   *   Three.X = ex,  Three.Y = ez,  Three.Z = -ey
   *
   * Le -ey est ESSENTIEL : sans lui le mapping est une réflexion (déterminant -1)
   * qui inverse le sens des orbites (rétrograde vu de +Y) et les met en miroir.
   * Avec -ey c'est une rotation propre (déterminant +1) : orbites progrades
   * (sens anti-horaire vu de +Y), cohérentes avec la convention de spin
   * (rotation.y += rotationSpeed > 0 = prograde).
   */
  private _toScene(x: number, y: number, z: number): THREE.Vector3 {
    const ex =  x;
    const ey =  y * COS_OBL + z * SIN_OBL;
    const ez = -y * SIN_OBL + z * COS_OBL;
    return new THREE.Vector3(ex, ez, -ey);
  }
}
