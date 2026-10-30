/**
 * LE SERVICE DE DONNÉES DE GALAXY, côté client (lot 46, 2026-10-12). Module PUR, sans DOM ni
 * réseau : il lit le manifeste et les champs que `services/galaxy-data/ingest.py` publie, et les
 * rend dans la convention des grilles météo (`ScalarGrid`).
 *
 * Pourquoi un service : les couches de modèle interrogeaient Open-Meteo depuis le navigateur, et
 * l'API gratuite compte son quota PAR ADRESSE IP (5 000 appels par heure, une grille mondiale
 * de 4° en coûte des milliers). Le service récupère le modèle GFS de la NOAA UNE fois par cycle
 * et le sert à tous, au pas de 1°.
 *
 * Au-delà des analyses GFS, le même service sert l'ARCHIVE ERA5 (1940 à environ une semaine avant
 * aujourd'hui), construite à la demande par `services/galaxy-data/era5.py` depuis la copie publique
 * ARCO-ERA5 : le manifeste en déclare la couverture (`archive`).
 *
 * Le FORMAT est celui de `ingest.py` (« GXF1 ») : signature, longueur de l'en-tête JSON, en-tête,
 * puis int16 LE bande après bande ; valeur = brut × scale + offset, −32768 = absente.
 */
import type { ScalarGrid } from './meteoGrid';
import { PROVIDER_NAMES } from './providerNames';

/** L'origine du service ; la CSP (`firebase.json`) et la page de confidentialité la citent. */
export const GALAXY_DATA_ORIGIN = 'https://galaxy-data.adrianguichard.dev';
export const GALAXY_DATA_MANIFEST = `${GALAXY_DATA_ORIGIN}/gfs/manifest.json`;

const MISSING = -32768;
const HOUR_MS = 3_600_000;

export interface GalaxyDataManifest {
  format: 'GXF1';
  generated: string;
  source: { name: string; url: string; licence: string };
  stepHours: number;
  path: string;
  fields: Record<string, { unit: string; bands: number }>;
  times: Record<
    string,
    { cycle: string; kind: 'analysis' | 'forecast'; fields: string[] }
  >;
  /** Absent quand la source de l'archive n'a pas répondu au dernier passage. */
  archive?: GalaxyDataArchive;
}

/** Une plage d'archive, instants `AAAAMMJJHH` INCLUSIFS. */
interface GalaxyDataArchiveRange {
  from: string;
  to: string;
  path: string;
}

interface GalaxyDataArchive {
  era5: GalaxyDataArchiveRange;
  era5t: GalaxyDataArchiveRange;
  stepHours: number;
  fields: string[];
}

export type GalaxyDataArchiveVersion = 'era5' | 'era5t';

/** Le nom affiché par le badge : ERA5T est la version PRÉLIMINAIRE, et le badge le dit. */
export const ARCHIVE_PROVIDER: Record<GalaxyDataArchiveVersion, string> = {
  era5: PROVIDER_NAMES.era5,
  era5t: PROVIDER_NAMES.era5t,
};

export interface GxfHeader {
  field: string;
  bands: number;
  unit: string;
  scale: number;
  offset: number;
  nLon: number;
  nLat: number;
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  validTime: string;
  /** Champs GFS seulement : une réanalyse n'a ni cycle ni échéance. */
  cycle?: string;
  lead?: number;
  kind: 'analysis' | 'forecast' | 'reanalysis';
  product?: GalaxyDataArchiveVersion;
  source: string;
}

/** `AAAAMMJJHH` → instant UTC. */
export function stampToMs(stamp: string): number {
  return Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10))
  );
}

/**
 * L'instant du manifeste le plus proche de la scène, qui porte TOUS les champs demandés, à au
 * plus un demi-pas : au-delà, la donnée décrirait un autre moment que celui de la scène, et
 * l'appelant passe à une autre source plutôt que de l'afficher sous cette date.
 */
export function pickGalaxyDataTime(
  manifest: GalaxyDataManifest,
  sceneMs: number,
  fields: readonly string[]
): { stamp: string; cycle: string; kind: 'analysis' | 'forecast' } | null {
  const halfStep = (manifest.stepHours * HOUR_MS) / 2;
  let best: { stamp: string; gap: number } | null = null;
  for (const [stamp, entry] of Object.entries(manifest.times)) {
    if (!fields.every((f) => entry.fields.includes(f))) continue;
    const gap = Math.abs(stampToMs(stamp) - sceneMs);
    if (gap <= halfStep && (!best || gap < best.gap)) best = { stamp, gap };
  }
  if (!best) return null;
  const entry = manifest.times[best.stamp]!;
  return { stamp: best.stamp, cycle: entry.cycle, kind: entry.kind };
}

/** `AAAAMMJJHH` d'un instant UTC. */
export function msToStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-T:]/g, '').slice(0, 10);
}

/**
 * Le champ d'ARCHIVE de la scène : l'heure la plus proche (ERA5 est horaire, donc à au plus une
 * demi-heure de la scène), si la couverture déclarée la contient et porte TOUS les champs. ERA5
 * passe AVANT les analyses GFS là où les deux existent : c'est une réanalyse, horaire, et la
 * référence de ce qui s'est passé ; GFS ne fait que le pont des derniers jours.
 */
export function pickGalaxyDataArchive(
  manifest: GalaxyDataManifest,
  sceneMs: number,
  fields: readonly string[]
): {
  stamp: string;
  version: GalaxyDataArchiveVersion;
  urls: Record<string, string>;
} | null {
  const archive = manifest.archive;
  if (!archive || !fields.every((f) => archive.fields.includes(f))) return null;
  const stepMs = archive.stepHours * HOUR_MS;
  const stamp = msToStamp(Math.round(sceneMs / stepMs) * stepMs);
  for (const version of ['era5', 'era5t'] as const) {
    const range = archive[version];
    if (stamp < range.from || stamp > range.to) continue;
    const urls = Object.fromEntries(
      fields.map((field) => [
        field,
        `${GALAXY_DATA_ORIGIN}/${range.path
          .replace('{time}', stamp)
          .replace('{field}', field)}`,
      ])
    );
    return { stamp, version, urls };
  }
  return null;
}

/** Le chemin d'un champ, tel que le manifeste le déclare (`gfs/{validTime}/{cycle}/{field}.bin`). */
export function galaxyDataFieldUrl(
  manifest: GalaxyDataManifest,
  stamp: string,
  cycle: string,
  field: string
): string {
  const path = manifest.path
    .replace('{validTime}', stamp)
    .replace('{cycle}', cycle)
    .replace('{field}', field);
  return `${GALAXY_DATA_ORIGIN}/${path}`;
}

/** Décode un champ GXF1 ; une valeur absente devient NaN. */
export function decodeGxf(buffer: ArrayBuffer): {
  header: GxfHeader;
  bands: Float32Array[];
} {
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'GXF1')
    throw new Error('champ GXF1 attendu');
  const view = new DataView(buffer);
  const length = view.getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + length))
  ) as GxfHeader;
  const count = header.nLon * header.nLat;
  const expected = 8 + length + 2 * count * header.bands;
  if (buffer.byteLength !== expected)
    throw new Error(
      `champ ${header.field} : ${buffer.byteLength} octets, ${expected} attendus`
    );
  const bands: Float32Array[] = [];
  let cursor = 8 + length;
  for (let b = 0; b < header.bands; b++) {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++, cursor += 2) {
      const raw = view.getInt16(cursor, true);
      values[i] = raw === MISSING ? NaN : raw * header.scale + header.offset;
    }
    bands.push(values);
  }
  return { header, bands };
}

/**
 * Une bande du service dans la convention de `ScalarGrid` (rangée 0 au SUD, colonne 0 à −180°),
 * par réindexation EXACTE : la grille du service est régulière au pas de `dLon`, et chaque
 * nœud de la grille rendue en est un. `convert` passe de l'unité du service à celle de la couche.
 */
function gxfBandToScalarGrid(
  header: GxfHeader,
  band: Float32Array,
  convert: (value: number) => number = (v) => v
): ScalarGrid {
  const step = Math.abs(header.dLon);
  if (Math.abs(Math.abs(header.dLat) - step) > 1e-9)
    throw new Error(`grille non carrée : ${header.dLat} × ${header.dLon}`);
  const nLat = header.nLat;
  const nLon = header.nLon;
  const latMin = Math.min(header.lat0, header.lat0 + header.dLat * (nLat - 1));
  const values = new Float32Array(nLat * nLon);
  for (let r = 0; r < nLat; r++) {
    const lat = latMin + r * step;
    const sourceRow = Math.round((lat - header.lat0) / header.dLat);
    for (let c = 0; c < nLon; c++) {
      const lon = -180 + c * step;
      const sourceCol =
        ((Math.round((lon - header.lon0) / header.dLon) % nLon) + nLon) % nLon;
      const value = band[sourceRow * nLon + sourceCol]!;
      values[r * nLon + c] = Number.isNaN(value) ? NaN : convert(value);
    }
  }
  return { step, latMin, lonMin: -180, nLat, nLon, values };
}

/**
 * Les variables Open-Meteo que le service sait rendre, et comment. Le vent est servi en u/v
 * (m/s) : vitesse et direction s'en DÉDUISENT, dans la convention météo d'Open-Meteo (direction
 * d'où vient le vent, 0 = du nord), pour que la couche n'ait qu'une forme de donnée.
 */
export const GALAXY_DATA_VARIABLES: Record<
  string,
  { field: string; compose: (bands: Float32Array[], i: number) => number }
> = {
  temperature_2m: { field: 't2m', compose: (b, i) => b[0]![i]! - 273.15 },
  pressure_msl: { field: 'prmsl', compose: (b, i) => b[0]![i]! / 100 },
  relative_humidity_2m: { field: 'rh2m', compose: (b, i) => b[0]![i]! },
  cloud_cover: { field: 'tcc', compose: (b, i) => b[0]![i]! },
  precipitation: { field: 'prate', compose: (b, i) => b[0]![i]! },
  wind_speed_10m: {
    field: 'wind10m',
    compose: (b, i) => Math.hypot(b[0]![i]!, b[1]![i]!) * 3.6,
  },
  wind_direction_10m: {
    field: 'wind10m',
    compose: (b, i) => {
      // u, v : vers où va l'air. La direction météo est celle d'où il vient.
      const deg = (Math.atan2(-b[0]![i]!, -b[1]![i]!) * 180) / Math.PI;
      return (deg + 360) % 360;
    },
  },
};

/** Une variable composée sur toutes les bandes d'un champ, réindexée comme une `ScalarGrid`. */
export function composeVariable(
  variable: string,
  decoded: { header: GxfHeader; bands: Float32Array[] }
): ScalarGrid {
  const spec = GALAXY_DATA_VARIABLES[variable];
  if (!spec) throw new Error(`variable sans champ du service : ${variable}`);
  const count = decoded.header.nLon * decoded.header.nLat;
  const composed = new Float32Array(count);
  for (let i = 0; i < count; i++) composed[i] = spec.compose(decoded.bands, i);
  return gxfBandToScalarGrid(decoded.header, composed);
}
