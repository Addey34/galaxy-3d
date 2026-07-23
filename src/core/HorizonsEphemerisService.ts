/**
 * Éphémérides précalculées depuis NASA/JPL Horizons.
 *
 * Chaque corps est stocké comme une suite régulière de vecteurs héliocentriques
 * écliptiques J2000 `[x,y,z,vx,vy,vz]` en UA et UA/jour. Entre deux échantillons,
 * une interpolation cubique de Hermite utilise positions ET vitesses : le mouvement
 * reste continu et suit la trajectoire numérique Horizons sans requête réseau par frame.
 */
import * as THREE from 'three';
import { MakeTime } from 'astronomy-engine';
import { eclipticToScene } from './frames';
import Logger from '@/utils/Logger';

const J2000_JD = 2_451_545;
const UNIX_EPOCH_JD = 2_440_587.5;
const MS_PER_DAY = 86_400_000;
const COMPONENTS_PER_SAMPLE = 6;

/** Dates d'effet et valeurs TT−UTC (TAI−UTC + 32,184 s). */
const TT_MINUS_UTC: readonly [number, number][] = [
  [Date.UTC(1972, 0, 1), 42.184],
  [Date.UTC(1972, 6, 1), 43.184],
  [Date.UTC(1973, 0, 1), 44.184],
  [Date.UTC(1974, 0, 1), 45.184],
  [Date.UTC(1975, 0, 1), 46.184],
  [Date.UTC(1976, 0, 1), 47.184],
  [Date.UTC(1977, 0, 1), 48.184],
  [Date.UTC(1978, 0, 1), 49.184],
  [Date.UTC(1979, 0, 1), 50.184],
  [Date.UTC(1980, 0, 1), 51.184],
  [Date.UTC(1981, 6, 1), 52.184],
  [Date.UTC(1982, 6, 1), 53.184],
  [Date.UTC(1983, 6, 1), 54.184],
  [Date.UTC(1985, 6, 1), 55.184],
  [Date.UTC(1988, 0, 1), 56.184],
  [Date.UTC(1990, 0, 1), 57.184],
  [Date.UTC(1991, 0, 1), 58.184],
  [Date.UTC(1992, 6, 1), 59.184],
  [Date.UTC(1993, 6, 1), 60.184],
  [Date.UTC(1994, 6, 1), 61.184],
  [Date.UTC(1996, 0, 1), 62.184],
  [Date.UTC(1997, 6, 1), 63.184],
  [Date.UTC(1999, 0, 1), 64.184],
  [Date.UTC(2006, 0, 1), 65.184],
  [Date.UTC(2009, 0, 1), 66.184],
  [Date.UTC(2012, 6, 1), 67.184],
  [Date.UTC(2015, 6, 1), 68.184],
  [Date.UTC(2017, 0, 1), 69.184],
];

interface HorizonsBodyManifest {
  file: string;
  target: string;
  startJdTdb: number;
  stepDays: number;
  sampleCount: number;
}

interface HorizonsManifest {
  version: 1;
  source: string;
  generatedAt: string;
  frame: 'ECLIPTIC_J2000';
  center: 'SUN';
  units: 'AU-D';
  bodies: Record<string, HorizonsBodyManifest>;
}

interface LoadedBody {
  manifest: HorizonsBodyManifest;
  samples: Float64Array;
}

function isManifest(value: unknown): value is HorizonsManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<HorizonsManifest>;
  return (
    manifest.version === 1 &&
    manifest.frame === 'ECLIPTIC_J2000' &&
    manifest.center === 'SUN' &&
    manifest.units === 'AU-D' &&
    typeof manifest.bodies === 'object' &&
    manifest.bodies !== null
  );
}

function dateToJdTdb(date: Date): number {
  const utcMs = date.getTime();
  // Avant l'introduction des secondes intercalaires, le modèle UT1→TT d'Astronomy Engine
  // est plus approprié. Après 1972, on reproduit l'échelle UTC utilisée par Horizons.
  if (utcMs < TT_MINUS_UTC[0][0]) return J2000_JD + MakeTime(date).tt;

  let ttMinusUtcSeconds = TT_MINUS_UTC[0][1];
  for (const [effectiveMs, offset] of TT_MINUS_UTC) {
    if (utcMs < effectiveMs) break;
    ttMinusUtcSeconds = offset;
  }
  const jdTt = utcMs / MS_PER_DAY + UNIX_EPOCH_JD + ttMinusUtcSeconds / 86_400;
  // Approximation standard TDB−TT (amplitude < 1,7 ms), suffisante bien en dessous du km.
  const meanAnomaly =
    (357.53 + 0.985_600_3 * (jdTt - J2000_JD)) * (Math.PI / 180);
  const tdbMinusTtSeconds =
    0.001_657 * Math.sin(meanAnomaly) + 0.000_022 * Math.sin(2 * meanAnomaly);
  return jdTt + tdbMinusTtSeconds / 86_400;
}

export class HorizonsEphemerisService {
  private constructor(private readonly bodies: Map<string, LoadedBody>) {}

  /**
   * Charge le manifeste et les fichiers binaires. Une panne ou un asset absent ne bloque
   * jamais le boot : le service vide laisse OrbitalMechanics utiliser son fallback képlérien.
   */
  static async load(manifestUrl: string): Promise<HorizonsEphemerisService> {
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);

      const raw: unknown = await response.json();
      if (!isManifest(raw)) throw new Error('invalid manifest schema');

      const baseUrl = new URL('.', new URL(manifestUrl, window.location.href));
      const loaded = await Promise.all(
        Object.entries(raw.bodies).map(async ([name, body]) => {
          const binaryResponse = await fetch(new URL(body.file, baseUrl));
          if (!binaryResponse.ok)
            throw new Error(`${name} HTTP ${binaryResponse.status}`);
          const buffer = await binaryResponse.arrayBuffer();
          const expectedBytes =
            body.sampleCount *
            COMPONENTS_PER_SAMPLE *
            Float64Array.BYTES_PER_ELEMENT;
          if (buffer.byteLength !== expectedBytes) {
            throw new Error(
              `${name}: ${buffer.byteLength} bytes, expected ${expectedBytes}`
            );
          }
          return [
            name,
            { manifest: body, samples: new Float64Array(buffer) },
          ] as const;
        })
      );

      Logger.success(
        `[HorizonsEphemerisService] Loaded ${loaded.length} precise ephemerides`
      );
      return new HorizonsEphemerisService(new Map(loaded));
    } catch (error) {
      Logger.warn(
        '[HorizonsEphemerisService] Precise data unavailable; using Kepler fallback',
        error
      );
      return new HorizonsEphemerisService(new Map());
    }
  }

  /**
   * Renvoie la position héliocentrique précise en UA dans le repère Three.js, ou `null`
   * si le corps/la date est hors couverture.
   */
  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null {
    const body = this.bodies.get(name);
    if (!body) return null;

    const { startJdTdb, stepDays, sampleCount } = body.manifest;
    const samplePosition = (dateToJdTdb(date) - startJdTdb) / stepDays;
    const index = Math.floor(samplePosition);
    if (index < 0 || index >= sampleCount - 1) return null;

    const u = samplePosition - index;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const a = index * COMPONENTS_PER_SAMPLE;
    const b = a + COMPONENTS_PER_SAMPLE;
    const values = body.samples;

    const interpolate = (axis: number): number =>
      h00 * values[a + axis] +
      h10 * stepDays * values[a + 3 + axis] +
      h01 * values[b + axis] +
      h11 * stepDays * values[b + 3 + axis];

    return eclipticToScene(interpolate(0), interpolate(1), interpolate(2));
  }
}
