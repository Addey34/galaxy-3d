/**
 * Champ de VENT mondial (composantes u/v) pour l'animation de particules. Module PUR
 * (pas de DOM/three/réseau) → unit-testable. La donnée vient du SOCLE MÉTÉO commun
 * (`fetchMeteoGrids`, 2026-10-12) : Open-Meteo, prévision ou archive ERA5 selon la date, vitesse
 * et direction dans la même requête ; on en dérive u (est) / v (nord). Le module avait ses
 * propres URL, qui demandaient toujours `forecast_days: 1` : une scène à J+3 recevait le vent
 * d'aujourd'hui à la même heure.
 *
 * Convention météo : `wind_direction` = direction D'OÙ VIENT le vent (0 = du Nord).
 * Le vecteur de déplacement de l'air est donc :
 *   u (vers l'est)  = -speed · sin(dir)
 *   v (vers le nord)= -speed · cos(dir)
 * (vent « du Nord », dir=0 → v = -speed, l'air va vers le Sud : correct.)
 */

import { DEG_TO_RAD as DEG2RAD } from './MathConstants';
import type { ScalarGrid } from './meteoGrid';

/** Grille régulière de vent échantillonnable. u/v en km/h, indexés [row*nLon + col]. */
export interface WindGrid {
  step: number;
  latMin: number; // latitude de la rangée 0
  lonMin: number; // longitude de la colonne 0
  nLat: number;
  nLon: number;
  u: Float32Array; // composante est (km/h)
  v: Float32Array; // composante nord (km/h)
}

/** Les deux variables qu'Open-Meteo sert pour le vent à 10 m, demandées dans la même requête. */
export const WIND_VARIABLES = ['wind_speed_10m', 'wind_direction_10m'] as const;

/** Convertit vitesse (km/h) + direction météo (°) en composantes u (est) / v (nord). */
export function windToUV(
  speed: number,
  directionDeg: number
): { u: number; v: number } {
  const r = directionDeg * DEG2RAD;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

/**
 * La grille u/v à partir des deux grilles scalaires du socle météo (`fetchMeteoGrids`), qui
 * décrivent la MÊME heure dans le même ordre de points. Deux grilles de géométrie différente
 * font échouer : elles ne viendraient pas de la même requête.
 */
export function windGridFromScalars(
  speed: ScalarGrid,
  direction: ScalarGrid
): WindGrid {
  if (
    speed.step !== direction.step ||
    speed.nLat !== direction.nLat ||
    speed.nLon !== direction.nLon ||
    speed.latMin !== direction.latMin ||
    speed.lonMin !== direction.lonMin
  )
    throw new Error('grilles de vitesse et de direction désaccordées');
  const n = speed.values.length;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = speed.values[i]!;
    const d = direction.values[i]!;
    // Vitesse absente ou négative : vent INCONNU (NaN), pas un calme. Une vitesse nulle est un
    // vrai calme même si la direction manque (elle n'a alors aucun sens) : u = v = 0. Une
    // vitesse non nulle sans direction valide est inconnue.
    if (!Number.isFinite(s) || s < 0 || (s !== 0 && !Number.isFinite(d))) {
      u[i] = NaN;
      v[i] = NaN;
    } else if (s === 0) {
      u[i] = 0;
      v[i] = 0;
    } else {
      const uv = windToUV(s, d);
      u[i] = uv.u;
      v[i] = uv.v;
    }
  }
  const { step, latMin, lonMin, nLat, nLon } = speed;
  return { step, latMin, lonMin, nLat, nLon, u, v };
}

/** Cellules où u ET v sont finis : la disponibilité RÉELLE du vent composé. */
export function countValidWind(grid: WindGrid): number {
  let count = 0;
  for (let i = 0; i < grid.u.length; i++)
    if (Number.isFinite(grid.u[i]!) && Number.isFinite(grid.v[i]!)) count++;
  return count;
}

/**
 * Refuse un champ de vent sans aucune cellule disponible. Deux grilles scalaires partiellement
 * valides, mais à disponibilités disjointes (vitesse là où la direction manque et inversement),
 * composent un champ entièrement inconnu : il ne doit pas être présenté comme disponible.
 */
export function assertUsableWind(grid: WindGrid): void {
  if (countValidWind(grid) === 0)
    throw new Error('champ de vent entièrement indisponible');
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function wrapLon(lon: number): number {
  const l = (((lon + 180) % 360) + 360) % 360;
  return l - 180;
}

/**
 * Échantillonne le champ (interpolation bilinéaire) à une position quelconque. Longitude
 * enroulée sur ±180 ; latitude clampée aux bornes de la grille. Renvoie u/v en km/h, dans `out`
 * s'il est fourni (la boucle des particules l'appelle des milliers de fois par image : un objet
 * neuf à chaque appel faisait l'essentiel de ses allocations).
 *
 * Valeurs ABSENTES : u et v valent NaN dès qu'une des cellules qui PÈSENT dans l'interpolation
 * (poids > 0) est invalide. Une cellule invalide à poids nul (point sur un nœud ou une rangée)
 * ne contamine pas. Aucune valeur n'est inventée ni reprise d'une voisine : l'appelant doit
 * traiter un NaN comme « vent inconnu » (ne pas déplacer, ne pas dessiner).
 */
export function sampleWind(
  grid: WindGrid,
  lat: number,
  lon: number,
  out: { u: number; v: number } = { u: 0, v: 0 }
): { u: number; v: number } {
  const { step, latMin, lonMin, nLat, nLon, u, v } = grid;
  const clampedLat = Math.max(
    latMin,
    Math.min(latMin + (nLat - 1) * step, lat)
  );
  const fLat = (clampedLat - latMin) / step;
  const fLon = (wrapLon(lon) - lonMin) / step;

  const r0 = Math.floor(fLat);
  const tr = fLat - r0;
  const r1 = tr === 0 ? r0 : Math.min(r0 + 1, nLat - 1);
  const c0 = Math.floor(fLon);
  const tc = fLon - c0;
  // Poids nul : on relit la même cellule, pour qu'un voisin invalide ne passe pas dans `lerp`.
  const c1 = tc === 0 ? c0 : (c0 + 1) % nLon; // wrap en longitude

  // Quatre indices de cellule, calculés une fois. Ni fermeture ni objet : cette fonction est
  // appelée par chaque particule de vent à chaque image (deux fermetures par appel faisaient
  // l'essentiel des allocations de la couche).
  const cw0 = ((c0 % nLon) + nLon) % nLon;
  const cw1 = ((c1 % nLon) + nLon) % nLon;
  const i00 = r0 * nLon + cw0;
  const i01 = r0 * nLon + cw1;
  const i10 = r1 * nLon + cw0;
  const i11 = r1 * nLon + cw1;

  const u0 = lerp(u[i00], u[i01], tc);
  const u1 = lerp(u[i10], u[i11], tc);
  const v0 = lerp(v[i00], v[i01], tc);
  const v1 = lerp(v[i10], v[i11], tc);

  const ru = lerp(u0, u1, tr);
  const rv = lerp(v0, v1, tr);
  const ok = Number.isFinite(ru) && Number.isFinite(rv);
  out.u = ok ? ru : NaN;
  out.v = ok ? rv : NaN;
  return out;
}
