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
import { propagateTwoBody } from './twoBodyPropagation';
import type { BodyDynamics } from '@/config/gravity';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';
import Logger from '@/utils/Logger';

const J2000_JD = 2_451_545;
const UNIX_EPOCH_JD = 2_440_587.5;
const MS_PER_DAY = 86_400_000;
const COMPONENTS_PER_SAMPLE = 6;

/**
 * En dessous de ce nombre d'echantillons par revolution, l'interpolation cubique n'est plus
 * fiable et on passe par la dynamique (cf. `_keplerianBetweenSamples`).
 *
 * Cinq, et la valeur vient d'une MESURE des deux branches sur les fichiers reellement
 * livres, pas d'une regle du pouce. Variation de rayon sur une orbite quasi circulaire
 * (1,000 = parfaitement ronde), Hermite puis dynamique :
 *
 *   ech/orbite   corps        Hermite   dynamique
 *      0,34      Encelade     11,376      1,006
 *      0,69      Dione         2,405      1,005
 *      1,47      Triton        2,750      1,000
 *      2,18      Titania       1,188      1,002
 *      3,37      Oberon        1,035      1,004
 *      3,99      Titan         1,076      1,059   <- 1,059 = son excentricite reelle
 *      5,04      Styx          1,117      1,169   <- la dynamique devient moins bonne
 *      9,55      Hydre         1,059      1,110
 *
 * Le croisement se lit directement : la dynamique domine tant que la cubique n'a pas de
 * quoi decrire un tour, puis passe DERRIERE elle. La raison est physique et vaut la peine
 * d'etre notee — les quatre petites lunes de Pluton n'ont pas un mouvement a deux corps
 * autour du centre de Pluton : elles orbitent le barycentre Pluton-Charon, et Pluton
 * oscille de 2 100 km autour de lui. Une fois l'echantillonnage assez fin pour decrire
 * cette oscillation, la cubique la suit, la conique osculatrice ne le peut pas.
 *
 * Le seuil ne concerne QUE le choix de l'interpolation : les echantillons, eux, restent les
 * memes dans les deux branches.
 */
const MIN_SAMPLES_PER_ORBIT_FOR_HERMITE = 5;

// Vecteurs de travail : `_samplePosition` est appele par corps a chaque recalcul de
// positions, on evite d'y allouer.
const _stateR = new THREE.Vector3();
const _stateV = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _backward = new THREE.Vector3();

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
  /** Body name when the binary is sampled relative to a parent instead of the Sun. */
  center?: string;
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
  /**
   * Masse centrale et periode de ce corps, quand le catalogue les connait.
   * Absent = interpolation cubique seule, comme avant.
   */
  dynamics?: BodyDynamics;
}

function isManifest(value: unknown): value is HorizonsManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<HorizonsManifest>;
  const bodies = manifest.bodies;
  return (
    manifest.version === 1 &&
    manifest.frame === 'ECLIPTIC_J2000' &&
    manifest.center === 'SUN' &&
    manifest.units === 'AU-D' &&
    typeof bodies === 'object' &&
    bodies !== null &&
    Object.values(bodies).every(isManifestBody)
  );
}

function isManifestBody(value: unknown): value is HorizonsBodyManifest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<HorizonsBodyManifest>;
  const stepDays = body.stepDays;
  const sampleCount = body.sampleCount;
  return (
    typeof body.file === 'string' &&
    /^[a-z0-9-]+\.[a-f0-9]{12}\.bin$/i.test(body.file) &&
    typeof body.target === 'string' &&
    Number.isFinite(body.startJdTdb) &&
    typeof stepDays === 'number' &&
    Number.isFinite(stepDays) &&
    stepDays > 0 &&
    typeof sampleCount === 'number' &&
    Number.isInteger(sampleCount) &&
    sampleCount >= 2
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

export class HorizonsEphemerisService implements PreciseEphemerisProvider {
  private constructor(private readonly bodies: Map<string, LoadedBody>) {}

  /**
   * Charge le manifeste et les fichiers binaires. Une panne ou un asset absent ne bloque
   * jamais le boot : le service vide laisse OrbitalMechanics utiliser son fallback képlérien.
   */
  static async load(
    manifestUrl: string,
    /**
     * Masse centrale et periode de revolution de chaque corps, par nom. Injecte par la
     * couche de composition depuis le catalogue plutot qu'importe ici : ce service ne
     * connait que son manifeste et ses binaires, et reste testable sans le catalogue. Un
     * corps absent de la table retombe sur l'interpolation cubique.
     */
    bodyMu: Readonly<Record<string, BodyDynamics>> = {}
  ): Promise<HorizonsEphemerisService> {
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);

      const raw: unknown = await response.json();
      if (!isManifest(raw)) throw new Error('invalid manifest schema');

      const manifestAbsoluteUrl = new URL(manifestUrl, window.location.href);
      if (manifestAbsoluteUrl.origin !== window.location.origin) {
        throw new Error('manifest must use the application origin');
      }
      const baseUrl = new URL('.', manifestAbsoluteUrl);
      const loaded = await Promise.all(
        Object.entries(raw.bodies).map(async ([name, body]) => {
          const binaryUrl = new URL(body.file, baseUrl);
          if (binaryUrl.origin !== baseUrl.origin) {
            throw new Error(
              `${name}: binary asset must use the application origin`
            );
          }
          const binaryResponse = await fetch(binaryUrl);
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
          const dynamics = bodyMu[name];
          return [
            name,
            {
              manifest: body,
              samples: new Float64Array(buffer),
              ...(dynamics ? { dynamics } : {}),
            },
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
    return body ? this._samplePosition(body, date) : null;
  }
  /** Returns a precise child-minus-parent vector when both Horizons states are covered. */
  getParentRelativeAU(
    childName: string,
    parentName: string,
    date: Date
  ): THREE.Vector3 | null {
    // New manifests store satellite files directly in the parent frame. Keep accepting
    // legacy Sun-centered files below so existing deployments can update incrementally.
    const child = this.bodies.get(childName);
    if (child?.manifest.center === parentName) {
      return this._samplePosition(child, date);
    }
    const childPosition = this.getHeliocentricAU(childName, date);
    const parentPosition = this.getHeliocentricAU(parentName, date);
    if (!childPosition || !parentPosition) return null;
    return childPosition.sub(parentPosition);
  }

  private _samplePosition(body: LoadedBody, date: Date): THREE.Vector3 | null {
    const { startJdTdb, stepDays, sampleCount } = body.manifest;
    const samplePosition = (dateToJdTdb(date) - startJdTdb) / stepDays;
    const index = Math.floor(samplePosition);
    if (index < 0 || index >= sampleCount - 1) return null;

    const u = samplePosition - index;
    return (
      this._keplerianBetweenSamples(body, index, u) ??
      this._hermiteBetweenSamples(body, index, u)
    );
  }

  /**
   * Interpolation par la DYNAMIQUE, pour les corps que le pas d'echantillonnage ne resout
   * pas — un satellite dont la periode est plus courte que `stepDays`.
   *
   * Les echantillons Horizons sont des etats exacts (position ET vitesse) : ce n'est pas la
   * donnee qui manque, c'est l'interpolation qui ment. Une cubique de Hermite suppose un
   * mouvement lisse sur l'intervalle ; quand le corps y fait dix tours, elle trace une
   * courbe qui n'a plus aucun rapport avec l'orbite. Mesure avant correction, angle balaye
   * sur une periode reelle (360 deg attendus) : Phobos 2 deg, Mimas 17 deg, Encelade 101 deg
   * — et le rayon d'Encelade variait d'un facteur 11.
   *
   * On propage donc les deux etats qui encadrent la date le long de leur conique, l'un vers
   * l'avant et l'autre vers l'arriere, puis on fond les deux resultats. Chaque ancre reste
   * exacte a l'echantillon (le poids vaut 0 puis 1 aux extremites, avec une derivee nulle
   * des deux cotes) : aucune discontinuite tous les `stepDays`, et les perturbations
   * reelles restent portees par les ancres — on ne remplace pas les donnees par un modele,
   * on relie des donnees exactes par la bonne courbe.
   */
  private _keplerianBetweenSamples(
    body: LoadedBody,
    index: number,
    u: number
  ): THREE.Vector3 | null {
    const dynamics = body.dynamics;
    if (dynamics?.periodDays === undefined) return null;

    const { stepDays } = body.manifest;
    // Combien d'echantillons par revolution le fichier offre-t-il ? Au-dela du seuil la
    // cubique est adequate et on la laisse faire : les planetes et les sondes, dont la
    // periode se compte en annees, ne passent jamais par ici. Le critere porte sur la
    // periode CATALOGUE, stable, et non sur la periode osculatrice de l'etat courant
    // (cf. `BodyDynamics.periodDays`) : la branche doit etre la meme sur toute la
    // trajectoire d'un corps, sinon on raccorde deux interpolations differentes au milieu.
    if (dynamics.periodDays / stepDays >= MIN_SAMPLES_PER_ORBIT_FOR_HERMITE) {
      return null;
    }

    const mu = dynamics.mu;
    const values = body.samples;
    const a = index * COMPONENTS_PER_SAMPLE;
    const b = a + COMPONENTS_PER_SAMPLE;

    _stateR.set(values[a], values[a + 1], values[a + 2]);
    _stateV.set(values[a + 3], values[a + 4], values[a + 5]);

    const forward = propagateTwoBody(
      _stateR,
      _stateV,
      u * stepDays,
      mu,
      _forward
    );
    if (!forward) return null;

    _stateR.set(values[b], values[b + 1], values[b + 2]);
    _stateV.set(values[b + 3], values[b + 4], values[b + 5]);
    const backward = propagateTwoBody(
      _stateR,
      _stateV,
      -(1 - u) * stepDays,
      mu,
      _backward
    );
    if (!backward) return null;

    // Poids en smoothstep : vaut 0 en u = 0 et 1 en u = 1, derivee nulle aux deux bouts.
    // C'est ce qui rend le raccord C1 d'un intervalle au suivant.
    const weight = u * u * (3 - 2 * u);
    const x = forward.x + (backward.x - forward.x) * weight;
    const y = forward.y + (backward.y - forward.y) * weight;
    const z = forward.z + (backward.z - forward.z) * weight;
    return eclipticToScene(x, y, z);
  }

  /** Interpolation cubique de Hermite sur l'etat (position + vitesse) — cas general. */
  private _hermiteBetweenSamples(
    body: LoadedBody,
    index: number,
    u: number
  ): THREE.Vector3 {
    const { stepDays } = body.manifest;
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
