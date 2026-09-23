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
import { mapWithConcurrency } from '@/utils/concurrency';
import { medianMeanMotionScale } from './meanMotionScale';
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

/**
 * CE QU'UN CHARGEMENT A RÉELLEMENT OBTENU — la donnée qui permet de le DIRE à l'écran.
 *
 * Contrat dans `docs/ARCHITECTURE.md` § « Un chargement partiel se garde, se reprend et se
 * dit ». En deux mots : ce qui arrive est gardé, ce qui manque est nommé, et l'interface
 * l'annonce au lieu de dégrader en silence.
 */
export interface EphemerisLoadReport {
  /** Corps déclarés par le manifeste. 0 quand le manifeste lui-même n'est pas arrivé. */
  readonly declared: number;
  /** Le manifeste n'est pas arrivé : on ne sait même pas ce qui manque. */
  readonly manifestFailed: boolean;
  /** Corps dont le fichier est arrivé, a la bonne taille et sert les positions. */
  readonly loaded: readonly string[];
  /** Corps dont le fichier manque, chacun avec la raison MESURÉE de son absence. */
  readonly missing: readonly EphemerisLoadFailure[];
  /** true dès qu'au moins un échec vaut la peine d'être repris (cf. `retryable`). */
  readonly retryable: boolean;
}

/** Pourquoi un fichier manque, et si le reprendre a un sens. */
export interface EphemerisLoadFailure {
  readonly body: string;
  readonly reason: string;
  /**
   * Une panne de lien (rejet de `fetch`, 5xx, 408, 429) se reprend : le fichier existe et
   * c'est le transport qui a lâché. Un 404, une origine étrangère ou une taille fausse sont
   * des défauts de DÉPLOIEMENT : les reprendre ne ferait que brûler le lien de l'utilisateur.
   */
  readonly retryable: boolean;
}

/** Réglages du chargement. Les tests les resserrent ; la production garde les défauts. */
export interface EphemerisLoadOptions {
  /** Requêtes simultanées. Cf. `utils/concurrency` pour la raison mesurée de cette borne. */
  concurrency?: number;
  /** Attentes entre deux essais d'un MÊME fichier. Vide = un seul essai. */
  retryDelaysMs?: readonly number[];
  /** Horloge injectée, pour qu'un test n'attende pas réellement. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Six requêtes à la fois. La borne ne change pas le temps TOTAL du chargement (la bande
 * passante le fixe) : elle borne la durée de CHAQUE requête, qui est ce qui expirait. Six
 * garde assez de parallélisme pour masquer la latence sur un lien rapide — mesuré sans
 * régression de démarrage à 50 et 10 Mbit/s.
 */
const DEFAULT_CONCURRENCY = 6;

/**
 * Deux reprises, à 1 s puis 4 s. Bornées parce qu'un chargement qui insiste indéfiniment est
 * une autre façon de ne rien dire : au bout de ces essais, l'absence est un FAIT qu'on affiche.
 */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Échec de chargement d'une ressource, porteur de sa reprenabilité. */
class LoadFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'LoadFailure';
  }
}

/** Un statut HTTP qui peut changer au prochain essai, contre un qui ne changera pas. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Un rejet de `fetch` (« TypeError: Failed to fetch ») est un incident de TRANSPORT : c'est
 * exactement ce qu'on a mesuré en production, et c'est reprenable. Seul un `LoadFailure`
 * déclare explicitement le contraire.
 */
function isRetryableError(error: unknown): boolean {
  return error instanceof LoadFailure ? error.retryable : true;
}

interface LoadPolicy {
  concurrency: number;
  retryDelaysMs: readonly number[];
  wait: (ms: number) => Promise<void>;
}

interface HorizonsBodyManifest {
  file: string;
  target: string;
  /** Body name when the binary is sampled relative to a parent instead of the Sun. */
  center?: string;
  startJdTdb: number;
  stepDays: number;
  sampleCount: number;
  /**
   * Facteur d'échelle du temps de propagation, PUBLIÉ parce qu'il se calcule sur le fichier
   * entier (cf. `core/meanMotionScale.ts` et la décision D5 du lot 17). Absent pour les corps
   * qui ne déclarent pas `meanMotionPropagation`, et absent d'un manifeste antérieur au
   * lot 17 : on retombe alors sur le calcul depuis les échantillons tenus, qui n'est juste
   * que si on tient le fichier entier.
   */
  meanMotionScale?: number;
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
    sampleCount >= 2 &&
    (body.meanMotionScale === undefined ||
      (typeof body.meanMotionScale === 'number' &&
        Number.isFinite(body.meanMotionScale) &&
        body.meanMotionScale > 0))
  );
}

export class HorizonsEphemerisService implements PreciseEphemerisProvider {
  readonly source = 'horizons' as const;

  /** Ce que la reprise a besoin de savoir : où sont les fichiers, et avec quelle dynamique. */
  private _pending: {
    manifestUrl: string;
    bodyMu: Readonly<Record<string, BodyDynamics>>;
    policy: LoadPolicy;
    /** Le manifeste, quand il est arrivé. `null` : il reste à demander. */
    manifest: {
      entries: [string, HorizonsBodyManifest][];
      baseUrl: URL;
    } | null;
  } | null = null;

  private _report: EphemerisLoadReport;
  private readonly _listeners: ((report: EphemerisLoadReport) => void)[] = [];
  /** Absences DÉFINITIVES (404, origine étrangère, taille fausse) : plus jamais redemandées. */
  private readonly _permanent = new Map<string, EphemerisLoadFailure>();
  /** Un seul chargement à la fois : un double clic sur « reprendre » ne doit pas doubler. */
  private _loading: Promise<void> | null = null;

  private constructor(
    private readonly bodies: Map<string, LoadedBody>,
    report?: EphemerisLoadReport
  ) {
    // Un service construit depuis le disque (fixture de test) est complet par construction.
    this._report = report ?? {
      declared: bodies.size,
      manifestFailed: false,
      loaded: [...bodies.keys()],
      missing: [],
      retryable: false,
    };
  }

  /**
   * Charge le manifeste et les fichiers binaires. NE REJETTE JAMAIS : ce qui arrive est gardé,
   * ce qui manque est nommé dans `report`, et l'interface l'annonce (`ui/ephemerisNotice`).
   *
   * Jusqu'au lot 15 c'était un `Promise.all` tout-ou-rien enveloppé dans un `catch` : une
   * seule rejection rendait un service VIDE, donc TOUS les corps repartaient sur une source de
   * repli, sans un mot. Mesuré en production le 2026-09-22 sur un lien à 24 ko/s : 25 fichiers
   * sur 64 arrivés, 39 perdus, Mercure à 2 600 km au lieu de 7,3, et les 11 sondes sans
   * aucune position.
   */
  static async load(
    manifestUrl: string,
    /**
     * Masse centrale et periode de revolution de chaque corps, par nom. Injecte par la
     * couche de composition depuis le catalogue plutot qu'importe ici : ce service ne
     * connait que son manifeste et ses binaires, et reste testable sans le catalogue. Un
     * corps absent de la table retombe sur l'interpolation cubique.
     */
    bodyMu: Readonly<Record<string, BodyDynamics>> = {},
    options: EphemerisLoadOptions = {}
  ): Promise<HorizonsEphemerisService> {
    const policy: LoadPolicy = {
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
      wait: options.wait ?? sleep,
    };
    const service = new HorizonsEphemerisService(new Map(), {
      declared: 0,
      manifestFailed: true,
      loaded: [],
      missing: [],
      retryable: true,
    });
    service._pending = { manifestUrl, bodyMu, policy, manifest: null };
    await service._load();
    return service;
  }

  /** Ce que le chargement a obtenu, et ce qui manque. */
  get report(): EphemerisLoadReport {
    return this._report;
  }

  /** Prévient à chaque changement de rapport (chargement initial, puis reprises). */
  onReportChange(listener: (report: EphemerisLoadReport) => void): void {
    this._listeners.push(listener);
  }

  /**
   * Redemande ce qui manque, sans rien jeter de ce qui est déjà là. Un corps repris change
   * alors de source EN COURS DE SESSION, de son repli vers son binaire, et se déplace
   * d'autant : c'est un gain de précision, il est demandé par l'utilisateur, et la fiche du
   * corps nomme déjà la source qui le place. L'appelant rafraîchit positions et lignes.
   */
  async retryMissing(): Promise<EphemerisLoadReport> {
    if (!this._pending) return this._report;
    await this._load();
    return this._report;
  }

  /**
   * Le chargement complet : un premier passage, puis un passage par reprise déclarée, tant
   * qu'il reste quelque chose de reprenable.
   *
   * La reprise porte sur le PASSAGE, pas sur chaque fichier, et ce n'est pas un détail : une
   * attente par fichier coûterait le calendrier entier (5 s) multiplié par le nombre de
   * fichiers divisé par la concurrence. Mesuré sur les 64 binaires tous coupés, avant cette
   * forme : 53 s d'attente pure ajoutées au démarrage. Par passage, c'est 5 s, quel que soit
   * le nombre de fichiers manquants.
   */
  private _load(): Promise<void> {
    this._loading ??= this._loadPasses().finally(() => {
      this._loading = null;
    });
    return this._loading;
  }

  private async _loadPasses(): Promise<void> {
    const policy = this._pending?.policy;
    if (!policy) return;
    for (let attempt = 0; ; attempt++) {
      await this._fill();
      if (!this._report.retryable) return;
      if (attempt >= policy.retryDelaysMs.length) return;
      await policy.wait(policy.retryDelaysMs[attempt]);
    }
  }

  /**
   * Un passage de chargement : le manifeste s'il manque, puis tous les corps encore absents.
   * Chaque fichier vit sa propre vie — l'échec de l'un n'annule aucun autre.
   */
  private async _fill(): Promise<void> {
    const pending = this._pending;
    if (!pending) return;
    const { policy } = pending;

    if (!pending.manifest) {
      try {
        pending.manifest = await fetchManifest(pending.manifestUrl);
      } catch (error) {
        Logger.warn(
          '[HorizonsEphemerisService] manifest unavailable; every body falls back',
          error
        );
        this._publish({
          declared: 0,
          manifestFailed: true,
          loaded: [],
          missing: [],
          retryable: isRetryableError(error),
        });
        return;
      }
    }

    const { entries, baseUrl } = pending.manifest;
    // Ce qu'on redemande : ni ce qu'on a déjà, ni ce dont l'absence est DÉFINITIVE. Sans cette
    // seconde condition, un 404 au milieu d'échecs de transport serait redemandé à chaque
    // passage alors que le contrat dit qu'on ne le reprend jamais : le passage, lui, continue
    // tant qu'un seul échec reprenable subsiste.
    const wanted = entries.filter(
      ([name]) =>
        !this.bodies.has(name) && this._permanent.get(name) === undefined
    );
    const failures = await mapWithConcurrency(
      wanted,
      policy.concurrency,
      async ([name, body]): Promise<EphemerisLoadFailure | null> => {
        try {
          this.bodies.set(
            name,
            await fetchBody(name, body, baseUrl, pending.bodyMu)
          );
          return null;
        } catch (error) {
          const failure: EphemerisLoadFailure = {
            body: name,
            reason: error instanceof Error ? error.message : String(error),
            retryable: isRetryableError(error),
          };
          if (!failure.retryable) this._permanent.set(name, failure);
          return failure;
        }
      }
    );

    const missing = entries
      .map(
        ([name]) =>
          this._permanent.get(name) ??
          failures.find((failure) => failure?.body === name) ??
          null
      )
      .filter((failure): failure is EphemerisLoadFailure => failure !== null);
    if (missing.length > 0) {
      Logger.warn(
        `[HorizonsEphemerisService] ${missing.length}/${entries.length} ephemerides missing`,
        missing
      );
    } else {
      Logger.success(
        `[HorizonsEphemerisService] Loaded ${this.bodies.size} precise ephemerides`
      );
    }
    this._publish({
      declared: entries.length,
      manifestFailed: false,
      loaded: [...this.bodies.keys()],
      missing,
      retryable: missing.some((failure) => failure.retryable),
    });
  }

  private _publish(report: EphemerisLoadReport): void {
    this._report = report;
    for (const listener of this._listeners) listener(report);
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
      // La valeur PUBLIÉE d'abord : elle est calculée sur le fichier entier, donc elle reste
      // juste quand le service ne tient qu'une fenêtre (lot 17, décision D5). Le calcul local
      // ne subsiste que pour un manifeste antérieur, et il n'est exact que sur un fichier
      // complet — sur une fenêtre il donnerait un autre facteur, donc une autre position
      // (mesuré sur Encelade : 27 m).
      scale =
        body.manifest.meanMotionScale ??
        medianMeanMotionScale(
          body.samples,
          body.manifest.sampleCount,
          dynamics.mu,
          dynamics.periodDays
        );
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

/** Demande le manifeste, et en vérifie le schéma ET l'origine. */
async function fetchManifest(
  manifestUrl: string
): Promise<{ entries: [string, HorizonsBodyManifest][]; baseUrl: URL }> {
  const response = await fetch(manifestUrl);
  if (!response.ok)
    throw new LoadFailure(
      `manifest HTTP ${response.status}`,
      isRetryableStatus(response.status)
    );

  const raw: unknown = await response.json();
  // Un manifeste illisible ne se répare pas en le redemandant.
  if (!isManifest(raw)) throw new LoadFailure('invalid manifest schema', false);

  const manifestAbsoluteUrl = new URL(manifestUrl, window.location.href);
  if (manifestAbsoluteUrl.origin !== window.location.origin) {
    throw new LoadFailure('manifest must use the application origin', false);
  }
  return {
    entries: Object.entries(raw.bodies),
    baseUrl: new URL('.', manifestAbsoluteUrl),
  };
}

/** Demande un binaire, en vérifie l'origine et la taille exacte, et le prépare. */
async function fetchBody(
  name: string,
  body: HorizonsBodyManifest,
  baseUrl: URL,
  bodyMu: Readonly<Record<string, BodyDynamics>>
): Promise<LoadedBody> {
  const binaryUrl = new URL(body.file, baseUrl);
  if (binaryUrl.origin !== baseUrl.origin) {
    throw new LoadFailure(
      `${name}: binary asset must use the application origin`,
      false
    );
  }
  const binaryResponse = await fetch(binaryUrl);
  if (!binaryResponse.ok)
    throw new LoadFailure(
      `${name} HTTP ${binaryResponse.status}`,
      isRetryableStatus(binaryResponse.status)
    );
  const buffer = await binaryResponse.arrayBuffer();
  const expectedBytes =
    body.sampleCount * COMPONENTS_PER_SAMPLE * Float64Array.BYTES_PER_ELEMENT;
  // Des octets servis à la mauvaise taille sont un défaut de déploiement, pas de transport.
  if (buffer.byteLength !== expectedBytes) {
    throw new LoadFailure(
      `${name}: ${buffer.byteLength} bytes, expected ${expectedBytes}`,
      false
    );
  }
  const dynamics = bodyMu[name];
  return {
    manifest: body,
    samples: new Float64Array(buffer),
    ...(dynamics ? { dynamics } : {}),
  };
}
