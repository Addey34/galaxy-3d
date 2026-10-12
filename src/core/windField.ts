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
    const uv = windToUV(speed.values[i]!, direction.values[i]!);
    u[i] = uv.u;
    v[i] = uv.v;
  }
  const { step, latMin, lonMin, nLat, nLon } = speed;
  return { step, latMin, lonMin, nLat, nLon, u, v };
}

function wrapLon(lon: number): number {
  const l = (((lon + 180) % 360) + 360) % 360;
  return l - 180;
}

/**
 * Échantillonne le champ (interpolation bilinéaire) à une position quelconque. Longitude
 * enroulée sur ±180 ; latitude clampée aux bornes de la grille. Renvoie u/v en km/h.
 */
export function sampleWind(
  grid: WindGrid,
  lat: number,
  lon: number
): { u: number; v: number } {
  const { step, latMin, lonMin, nLat, nLon, u, v } = grid;
  const clampedLat = Math.max(
    latMin,
    Math.min(latMin + (nLat - 1) * step, lat)
  );
  const fLat = (clampedLat - latMin) / step;
  const fLon = (wrapLon(lon) - lonMin) / step;

  const r0 = Math.floor(fLat);
  const r1 = Math.min(r0 + 1, nLat - 1);
  const c0 = Math.floor(fLon);
  const c1 = (c0 + 1) % nLon; // wrap en longitude
  const tr = fLat - r0;
  const tc = fLon - c0;

  const idx = (r: number, c: number) => r * nLon + (((c % nLon) + nLon) % nLon);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const u0 = lerp(u[idx(r0, c0)], u[idx(r0, c1)], tc);
  const u1 = lerp(u[idx(r1, c0)], u[idx(r1, c1)], tc);
  const v0 = lerp(v[idx(r0, c0)], v[idx(r0, c1)], tc);
  const v1 = lerp(v[idx(r1, c0)], v[idx(r1, c1)], tc);

  return { u: lerp(u0, u1, tr), v: lerp(v0, v1, tr) };
}
