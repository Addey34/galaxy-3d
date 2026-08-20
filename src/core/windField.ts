/**
 * Champ de VENT mondial (composantes u/v) pour l'animation de particules. Module PUR
 * (pas de DOM/three/réseau) → unit-testable. Source : Open-Meteo GFS
 * (`api.open-meteo.com/v1/gfs`), grille lat/lon en une requête, CORS ouvert, sans clé,
 * horaire. La réponse donne vitesse + direction ; on en dérive u (est) / v (nord).
 *
 * Convention météo : `wind_direction` = direction D'OÙ VIENT le vent (0 = du Nord).
 * Le vecteur de déplacement de l'air est donc :
 *   u (vers l'est)  = -speed · sin(dir)
 *   v (vers le nord)= -speed · cos(dir)
 * (vent « du Nord », dir=0 → v = -speed, l'air va vers le Sud : correct.)
 */

import { DEG_TO_RAD as DEG2RAD } from './MathConstants';

const OPEN_METEO_GFS = 'https://api.open-meteo.com/v1/gfs';
// Réanalyse ERA5 pour le VOYAGE TEMPS vers le passé (jusqu'à ~5 j avant le présent, retour
// jusqu'en 1940). Même schéma horaire vitesse+direction que le forecast GFS ; seule l'URL et
// la fenêtre temporelle (start_date=end_date=jour ciblé) changent. Cf. core/meteoTimeTravel.
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

export interface WindGridOptions {
  /** Pas de la grille en degrés (défaut 10 → 612 points, 1 requête). */
  step?: number;
  /** Latitude absolue maximale échantillonnée (défaut 80 : évite les pôles dégénérés). */
  maxLat?: number;
}

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

/** Génère les latitudes/longitudes de la grille (ordre lat croissant, lon croissant). */
export function windGridCoords(options: WindGridOptions = {}): {
  lats: number[];
  lons: number[];
} {
  const step = options.step ?? 10;
  const maxLat = options.maxLat ?? 80;
  const lats: number[] = [];
  const lons: number[] = [];
  for (let la = -maxLat; la <= maxLat + 1e-9; la += step) {
    for (let lo = -180; lo < 180 - 1e-9; lo += step) {
      lats.push(Number(la.toFixed(4)));
      lons.push(Number(lo.toFixed(4)));
    }
  }
  return { lats, lons };
}

/** URL Open-Meteo GFS pour la grille : vitesse + direction horaires. */
export function buildWindGridUrl(options: WindGridOptions = {}): string {
  const { lats, lons } = windGridCoords(options);
  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    hourly: 'wind_speed_10m,wind_direction_10m',
    forecast_days: '1',
  });
  return `${OPEN_METEO_GFS}?${params.toString()}`;
}

/**
 * URL archive ERA5 pour la grille de vent d'un JOUR passé (`isoDay` = `YYYY-MM-DD`).
 * `start_date`/`end_date` bornent la journée ; la réponse porte 24 valeurs horaires par
 * point, dont `parseWindGrid` sélectionne l'heure via `hourIndex`. Mêmes coordonnées de
 * grille que `buildWindGridUrl` → réponse dans le même ordre, parsing identique.
 */
export function buildWindArchiveUrl(
  isoDay: string,
  options: WindGridOptions = {}
): string {
  const { lats, lons } = windGridCoords(options);
  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    hourly: 'wind_speed_10m,wind_direction_10m',
    start_date: isoDay,
    end_date: isoDay,
  });
  return `${OPEN_METEO_ARCHIVE}?${params.toString()}`;
}

/** Convertit vitesse (km/h) + direction météo (°) en composantes u (est) / v (nord). */
export function windToUV(speed: number, directionDeg: number): { u: number; v: number } {
  const r = directionDeg * DEG2RAD;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

/**
 * Construit une `WindGrid` depuis la réponse Open-Meteo (tableau de points, un par coord,
 * dans le MÊME ordre que `windGridCoords`). `hourIndex` sélectionne l'heure de la journée.
 */
export function parseWindGrid(
  response: unknown,
  options: WindGridOptions = {},
  hourIndex = 0
): WindGrid {
  const step = options.step ?? 10;
  const maxLat = options.maxLat ?? 80;
  const nLat = Math.round((2 * maxLat) / step) + 1;
  const nLon = Math.round(360 / step);
  const u = new Float32Array(nLat * nLon);
  const v = new Float32Array(nLat * nLon);

  const points = Array.isArray(response) ? response : [];
  for (let i = 0; i < points.length && i < nLat * nLon; i++) {
    const p = points[i] as {
      hourly?: {
        wind_speed_10m?: number[];
        wind_direction_10m?: number[];
      };
    };
    const speed = p?.hourly?.wind_speed_10m?.[hourIndex] ?? 0;
    const dir = p?.hourly?.wind_direction_10m?.[hourIndex] ?? 0;
    const { u: uu, v: vv } = windToUV(speed, dir);
    u[i] = uu;
    v[i] = vv;
  }

  return { step, latMin: -maxLat, lonMin: -180, nLat, nLon, u, v };
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
  const clampedLat = Math.max(latMin, Math.min(latMin + (nLat - 1) * step, lat));
  const fLat = (clampedLat - latMin) / step;
  const fLon = (wrapLon(lon) - lonMin) / step;

  const r0 = Math.floor(fLat);
  const r1 = Math.min(r0 + 1, nLat - 1);
  const c0 = Math.floor(fLon);
  const c1 = (c0 + 1) % nLon; // wrap en longitude
  const tr = fLat - r0;
  const tc = fLon - c0;

  const idx = (r: number, c: number) => r * nLon + ((c % nLon) + nLon) % nLon;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const u0 = lerp(u[idx(r0, c0)], u[idx(r0, c1)], tc);
  const u1 = lerp(u[idx(r1, c0)], u[idx(r1, c1)], tc);
  const v0 = lerp(v[idx(r0, c0)], v[idx(r0, c1)], tc);
  const v1 = lerp(v[idx(r1, c0)], v[idx(r1, c1)], tc);

  return { u: lerp(u0, u1, tr), v: lerp(v0, v1, tr) };
}
