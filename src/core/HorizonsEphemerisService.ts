/**
 * Éphémérides précalculées depuis NASA/JPL Horizons.
 *
 * Chaque corps est stocké comme une suite régulière de vecteurs héliocentriques
 * écliptiques J2000 `[x,y,z,vx,vy,vz]` en UA et UA/jour. Entre deux échantillons,
 * une interpolation cubique de Hermite utilise positions ET vitesses : le mouvement
 * reste continu et suit la trajectoire numérique Horizons sans requête réseau par frame.
 */
import * as THREE from 'three';
import { eclipticToScene } from './frames';
import { jdTdbFromDate } from './timeScale';
import { propagateTwoBody } from './twoBodyPropagation';
import type { BodyDynamics } from '@/config/gravity';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';
import Logger from '@/utils/Logger';

const COMPONENTS_PER_SAMPLE = 6;

/**
 * En dessous de ce nombre d'echantillons par revolution, on interpole par la dynamique
 * (cf. `_keplerianBetweenSamples`) plutot que par une cubique.
 *
 * Seuil MESURE contre JPL Horizons (`pnpm ephemeris:validate`, erreur moyenne sur 1900-2100),
 * en montant le seuil par paliers une fois retires les deux biais qui penalisaient la
 * dynamique (ballant de Pluton autour du barycentre, periode osculatrice sous J2) :
 *
 *   ech/orbite   corps        Hermite   dynamique
 *      5,04      Styx          149 km      89 km
 *      5,3       Hyperion    5 455 km      65 km
 *      9,55      Hydre          16 km      11 km
 *     19,8       Japet          47 km      39 km
 *     90         Nereide        50 km      12 km   (max 668 -> 22 : son perihelie, e = 0,75)
 *    172         Mars          2,93 km    3,05 km  <- la cubique repasse devant
 *
 * D'ou 100. L'ancien seuil de 5 avait ete mesure alors que la dynamique portait encore ces
 * deux biais : elle perdait sur Styx A CAUSE du ballant de Pluton, pas par nature. Les
 * planetes et les sondes (periodes en annees ou absentes du catalogue) restent en Hermite.
 *
 * Le seuil ne concerne QUE le choix de l'interpolation : les echantillons, eux, restent les
 * memes dans les deux branches.
 */
export const MIN_SAMPLES_PER_ORBIT_FOR_HERMITE = 100;

// Vecteurs de travail : `_samplePosition` est appele par corps a chaque recalcul de
// positions, on evite d'y allouer.
const _stateR = new THREE.Vector3();
const _stateV = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _backward = new THREE.Vector3();

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
  /** Cf. `_meanMotionScale` — calculé au premier besoin, une fois par corps. */
  meanMotionScale?: number;
  /** Série sans le ballant du compagnon (cf. `BodyDynamics.reflex`), construite au besoin. */
  withoutReflex?: LoadedBody | null;
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
    const reflex = body.dynamics?.reflex;
    if (reflex) {
      const smooth = this._withoutReflex(body);
      const companion = this.bodies.get(reflex.companion);
      if (smooth && companion) {
        const position = this._sampleGrid(smooth, date);
        const wobble = this._sampleGrid(companion, date);
        if (!position || !wobble) return null;
        return position.addScaledVector(wobble, reflex.factor);
      }
    }
    return this._sampleGrid(body, date);
  }

  /**
   * Copie du corps dont les échantillons ont perdu le ballant du compagnon :
   * X_lisse = X − facteur × compagnon, état par état (positions ET vitesses). `null` si le
   * compagnon manque ou n'a pas exactement la même grille : on ne mélange pas deux pas.
   */
  private _withoutReflex(body: LoadedBody): LoadedBody | null {
    if (body.withoutReflex !== undefined) return body.withoutReflex;
    const reflex = body.dynamics!.reflex!;
    const companion = this.bodies.get(reflex.companion);
    const m = body.manifest;
    const c = companion?.manifest;
    let result: LoadedBody | null = null;
    if (
      companion &&
      c &&
      c.startJdTdb === m.startJdTdb &&
      c.stepDays === m.stepDays &&
      c.sampleCount === m.sampleCount
    ) {
      const samples = new Float64Array(body.samples.length);
      for (let i = 0; i < samples.length; i++)
        samples[i] = body.samples[i] - reflex.factor * companion.samples[i];
      result = { manifest: m, samples, dynamics: body.dynamics };
    }
    body.withoutReflex = result;
    return result;
  }

  private _sampleGrid(body: LoadedBody, date: Date): THREE.Vector3 | null {
    const { startJdTdb, stepDays, sampleCount } = body.manifest;
    const samplePosition = (jdTdbFromDate(date) - startJdTdb) / stepDays;
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
    // Avant de remplir `_stateR`/`_stateV` : le calcul du facteur s'en sert aussi.
    const timeScale = this._meanMotionScale(body);
    const values = body.samples;
    const a = index * COMPONENTS_PER_SAMPLE;
    const b = a + COMPONENTS_PER_SAMPLE;

    _stateR.set(values[a], values[a + 1], values[a + 2]);
    _stateV.set(values[a + 3], values[a + 4], values[a + 5]);

    const forward = propagateTwoBody(
      _stateR,
      _stateV,
      u * stepDays * timeScale,
      mu,
      _forward
    );
    if (!forward) return null;

    _stateR.set(values[b], values[b + 1], values[b + 2]);
    _stateV.set(values[b + 3], values[b + 4], values[b + 5]);
    const backward = propagateTwoBody(
      _stateR,
      _stateV,
      -(1 - u) * stepDays * timeScale,
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

  /**
   * Facteur d'échelle du TEMPS de propagation : période osculatrice médiane du fichier /
   * période sidérale moyenne du catalogue, pour les corps qui le déclarent
   * (`BodyDynamics.meanMotionPropagation`, cf. `config/gravity.ts`). 1 sinon.
   *
   * Autour d'une planète aplatie (J2), l'état osculateur surestime le demi-grand axe, donc la
   * période : la conique propagée parcourt la bonne ellipse au mauvais rythme (Mimas : 5 355
   * ppm, ~4° de phase au milieu d'un intervalle de 4 jours). On la fait avancer au rythme
   * moyen, sans toucher à sa géométrie. Un facteur CONSTANT, la médiane du fichier : le
   * rapport état par état corrige aussi le bruit à courte période et dégradait tout le monde.
   */
  private _meanMotionScale(body: LoadedBody): number {
    if (body.meanMotionScale !== undefined) return body.meanMotionScale;
    const dynamics = body.dynamics;
    let scale = 1;
    if (dynamics?.meanMotionPropagation && dynamics.periodDays !== undefined) {
      const values = body.samples;
      const count = body.manifest.sampleCount;
      const r = new THREE.Vector3();
      const v = new THREE.Vector3();
      const ratios: number[] = [];
      for (let k = 0; k < 257; k++) {
        const i = Math.floor((k * (count - 1)) / 256) * COMPONENTS_PER_SAMPLE;
        r.set(values[i], values[i + 1], values[i + 2]);
        v.set(values[i + 3], values[i + 4], values[i + 5]);
        const energy = v.lengthSq() / 2 - dynamics.mu / r.length();
        if (!(energy < 0)) continue;
        const a = -dynamics.mu / (2 * energy);
        ratios.push(
          (2 * Math.PI * Math.sqrt((a * a * a) / dynamics.mu)) /
            dynamics.periodDays
        );
      }
      ratios.sort((x, y) => x - y);
      if (ratios.length > 0) scale = ratios[Math.floor(ratios.length / 2)];
    }
    body.meanMotionScale = scale;
    return scale;
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
