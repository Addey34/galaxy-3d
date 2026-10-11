/**
 * Propagation d'un état autour d'une planète APLATIE : gravité centrale plus le terme J2
 * (ligne 45.10, pas 2, 2026-10-11) — fonction pure, testée.
 *
 * Pourquoi. Entre deux ancres d'un segment, le service propage l'état le long de sa conique
 * (`twoBodyPropagation.ts`). Autour d'une planète géante, la conique ment au périapse : Juno
 * passe à 4 000 km des nuages de Jupiter, dont l'aplatissement (J2 = 0,0147) la dévie de
 * plusieurs milliers de km en quelques heures. Mesuré contre Horizons sur six mois de 2024 :
 * au pas de 12 h, 1,58 % de la distance à Jupiter en deux corps, 0,12 % avec J2.
 *
 * Intégration numérique (Runge-Kutta d'ordre 4) à pas VARIABLE : chaque pas vaut une fraction
 * fixe du temps caractéristique local √(r³/μ), donc court au périapse et long à l'apoapse.
 * Aucun contrôle d'erreur adaptatif : la fraction est mesurée par les tests.
 */
import * as THREE from 'three';

/** Ce qu'il faut savoir de l'aplatissement d'une planète, unités du service. */
export interface Oblateness {
  /** Coefficient zonal de degré 2, sans dimension. */
  readonly j2: number;
  /** Rayon de référence du coefficient (UA) : le rayon équatorial de la même source. */
  readonly radiusAU: number;
  /** Axe de rotation, vecteur unitaire dans le repère des échantillons (écliptique J2000). */
  readonly pole: { readonly x: number; readonly y: number; readonly z: number };
}

/** Fraction du temps caractéristique local √(r³/μ) prise à chaque pas. */
export const OBLATE_STEP_FRACTION = 0.02;
/** Garde-fou : au-delà, l'intégration abandonne et l'appelant retombe sur la conique. */
const MAX_STEPS = 20_000;

/** Accélération (UA/jour²) en `r` : centrale plus J2, écrite sans allocation. */
function acceleration(
  x: number,
  y: number,
  z: number,
  mu: number,
  ob: Oblateness,
  out: Float64Array
): void {
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2);
  const central = -mu / (r2 * r);
  // Projection sur l'axe de rotation : la « hauteur » au-dessus de l'équateur.
  const zp = x * ob.pole.x + y * ob.pole.y + z * ob.pole.z;
  const k = (1.5 * ob.j2 * mu * ob.radiusAU * ob.radiusAU) / (r2 * r2 * r);
  const f = (5 * zp * zp) / r2 - 1;
  out[0] = central * x + k * (f * x - 2 * zp * ob.pole.x);
  out[1] = central * y + k * (f * y - 2 * zp * ob.pole.y);
  out[2] = central * z + k * (f * z - 2 * zp * ob.pole.z);
}

const a1 = new Float64Array(3);
const a2 = new Float64Array(3);
const a3 = new Float64Array(3);
const a4 = new Float64Array(3);

/**
 * Avance un état (position UA, vitesse UA/jour, relatifs à la planète) de `deltaDays`, signé.
 * Renvoie `null` sur un état dégénéré ou une intégration trop longue.
 */
export function propagateOblate(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  deltaDays: number,
  mu: number,
  ob: Oblateness,
  out = new THREE.Vector3()
): THREE.Vector3 | null {
  if (!(mu > 0) || !(position.lengthSq() > 0)) return null;
  let x = position.x;
  let y = position.y;
  let z = position.z;
  let vx = velocity.x;
  let vy = velocity.y;
  let vz = velocity.z;
  const sign = deltaDays < 0 ? -1 : 1;
  let left = Math.abs(deltaDays);
  for (let n = 0; left > 0; n++) {
    if (n >= MAX_STEPS) return null;
    const r = Math.sqrt(x * x + y * y + z * z);
    const h = Math.min(
      left,
      OBLATE_STEP_FRACTION * Math.sqrt((r * r * r) / mu)
    );
    const s = sign * h;
    acceleration(x, y, z, mu, ob, a1);
    acceleration(
      x + (vx * s) / 2,
      y + (vy * s) / 2,
      z + (vz * s) / 2,
      mu,
      ob,
      a2
    );
    const v2x = vx + (a1[0] * s) / 2;
    const v2y = vy + (a1[1] * s) / 2;
    const v2z = vz + (a1[2] * s) / 2;
    acceleration(
      x + (v2x * s) / 2,
      y + (v2y * s) / 2,
      z + (v2z * s) / 2,
      mu,
      ob,
      a3
    );
    const v3x = vx + (a2[0] * s) / 2;
    const v3y = vy + (a2[1] * s) / 2;
    const v3z = vz + (a2[2] * s) / 2;
    acceleration(x + v3x * s, y + v3y * s, z + v3z * s, mu, ob, a4);
    const v4x = vx + a3[0] * s;
    const v4y = vy + a3[1] * s;
    const v4z = vz + a3[2] * s;
    x += (s / 6) * (vx + 2 * v2x + 2 * v3x + v4x);
    y += (s / 6) * (vy + 2 * v2y + 2 * v3y + v4y);
    z += (s / 6) * (vz + 2 * v2z + 2 * v3z + v4z);
    vx += (s / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
    vy += (s / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
    vz += (s / 6) * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
    left -= h;
  }
  return out.set(x, y, z);
}
