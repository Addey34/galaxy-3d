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
import {
  byteRangeForIndices,
  covers,
  fileByteLength,
  interpretRangeResponse,
  mergeWindows,
  planBodyWindow,
  rangeHeader,
  windowContains,
  type SampleGrid,
  type SampleWindow,
} from './ephemerisWindow';
import {
  EphemerisStore,
  spanSatisfies,
  type StoreInventory,
} from './ephemerisStore';
import { TransferRateMeter } from './transferRate';
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
  /**
   * Corps dont la scène a BESOIN à cette date, c'est-à-dire ceux dont un fichier doit être lu.
   *
   * Depuis le lot 17C ce n'est plus le compte du manifeste : un corps que la date ne concerne
   * pas (Cassini en 2026, Rosetta) n'a aucun fichier à recevoir, donc il n'est ni « reçu » ni
   * « manquant ». Le compter parmi les reçus ferait dire au bandeau « 3 sur 64 » là où un seul
   * fichier est vraiment arrivé — mesuré par `e2e/ephemerisDegraded.spec.ts`, et c'est
   * exactement le genre de phrase que le lot 15 existe pour empêcher. Sans demande de scène,
   * tous les corps sont demandés et ce compte redevient celui du manifeste.
   *
   * 0 quand le manifeste lui-même n'est pas arrivé.
   */
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

/**
 * Ce que la SCÈNE demande aux éphémérides à un instant : une date, l'avance que sa vitesse de
 * lecture réclame, et la période de révolution des corps dont la ligne d'orbite est tracée.
 *
 * C'est la seule chose qui fait passer le service du fichier ENTIER à une FENÊTRE. Absente, il
 * charge les 64 fichiers comme avant le lot 17 : les tests de fixture, le validateur et tout ce
 * qui lit ces binaires hors du navigateur continuent donc de les lire entiers.
 */
export interface SceneWindowRequest {
  /** Date affichée par la scène. */
  readonly date: Date;
  /** Jours de lecture pris d'avance, signés (cf. `core/ephemerisWindow.readAheadDays`). */
  readonly leadDays?: number;
  /**
   * Période de révolution, par corps, pour ceux dont la ligne d'orbite est tracée. C'est ce
   * qui coûte : une position vaut 96 octets, une ligne demande une période ENTIÈRE.
   */
  readonly orbitPeriodDays?: Readonly<Record<string, number>>;
}

/**
 * CE QUE CET APPAREIL TIENT, pour que l'interface le DISE au lieu de le supposer.
 *
 * Tous les nombres sont LUS : `completeFiles` vient des clés réellement présentes dans le
 * magasin, pas d'un « préparation réussie » mémorisé qui survivrait à une purge de quota.
 */
export interface OfflineState {
  /** Ce navigateur a un magasin (cf. `EphemerisStore.open`). */
  readonly available: boolean;
  /** Fichiers que le manifeste déclare. 0 tant qu'il n'est pas arrivé. */
  readonly declaredFiles: number;
  /** Ce que ces fichiers pèsent en tout, octets bruts. */
  readonly declaredBytes: number;
  /** Fichiers tenus ENTIERS. C'est le seul état qui permet n'importe quelle date hors ligne. */
  readonly completeFiles: number;
  /** Octets rangés, fenêtres partielles comprises. */
  readonly storedBytes: number;
  /**
   * Ce qu'une préparation téléchargerait MAINTENANT : les fichiers pas encore tenus entiers.
   * Distinct de `declaredBytes`, et c'est ce que l'interface annonce — promettre 38,4 Mo à
   * quelqu'un qui en tient déjà la moitié serait faux dans le sens qui décourage.
   */
  readonly remainingBytes: number;
}

/** Réglages d'une préparation hors ligne. */
export interface PrepareOfflineOptions {
  /** Appelé après chaque fichier, pour que l'écran avance au rythme du téléchargement. */
  onProgress?: (progress: { done: number; total: number }) => void;
  /** Annulation par l'utilisateur : 38 Mo, c'est long, et il doit pouvoir s'arrêter. */
  signal?: AbortSignal;
}

/** Réglages du chargement. Les tests les resserrent ; la production garde les défauts. */
export interface EphemerisLoadOptions {
  /** Ce que la scène demande. Absent = les fichiers entiers, comme avant le lot 17. */
  scene?: SceneWindowRequest;
  /** Requêtes simultanées. Cf. `utils/concurrency` pour la raison mesurée de cette borne. */
  concurrency?: number;
  /** Attentes entre deux essais d'un MÊME fichier. Vide = un seul essai. */
  retryDelaysMs?: readonly number[];
  /** Horloge injectée, pour qu'un test n'attende pas réellement. */
  wait?: (ms: number) => Promise<void>;
  /**
   * Horloge MONOTONE, en millisecondes, pour mesurer le débit (`core/transferRate`). Injectée
   * pour qu'un test mesure un débit exact au lieu de dépendre de la machine.
   */
  now?: () => number;
  /**
   * Le magasin de cet appareil (lot 17E). `undefined` : on l'ouvre si le navigateur en a un.
   * `null` : on n'en veut pas, ce que demandent les tests qui mesurent le RÉSEAU.
   */
  store?: EphemerisStore | null;
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

/**
 * Horloge monotone par défaut. `performance.now()` plutôt que `Date.now()` : une mesure de
 * débit ne doit pas changer de signe parce que l'horloge du système a été remise à l'heure.
 */
const monotonicNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

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
  now: () => number;
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
  /**
   * Les échantillons TENUS, qui ne sont plus forcément tout le fichier depuis le lot 17 :
   * ils commencent à `firstIndex` dans la grille du manifeste, qui elle décrit toujours le
   * fichier ENTIER. Confondre les deux, c'est lire un autre instant.
   */
  samples: Float64Array;
  /** Index, dans la grille du fichier, du premier échantillon tenu. Absent = 0. */
  firstIndex?: number;
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

/** Ce qu'un corps chargé tient du manifeste et du catalogue, avant ses octets. */
function bodyBase(
  manifest: HorizonsBodyManifest,
  dynamics: BodyDynamics | undefined
): Pick<LoadedBody, 'manifest' | 'dynamics'> {
  return { manifest, ...(dynamics ? { dynamics } : {}) };
}

/**
 * Les octets que le magasin de l'appareil tient pour ce plan, ou `null`.
 *
 * L'inventaire est celui du passage courant, lu une seule fois : interroger le cache corps par
 * corps relirait 62 fois la même liste de clés.
 */
async function readHeld(
  store: EphemerisStore | null,
  inventory: StoreInventory | null,
  manifest: HorizonsBodyManifest,
  plan: SampleWindow | 'full'
): Promise<{ bytes: ArrayBuffer; firstIndex: number } | null> {
  if (!store || !inventory) return null;
  const span = inventory.spans.get(manifest.file);
  if (!span || !spanSatisfies(span, plan, manifest.sampleCount)) return null;
  return store.readSpan(manifest.file, span);
}

/**
 * Le résultat d'un `fetchBody` : le corps, et les octets bruts à ranger dans le magasin.
 *
 * Cette distinction n'est pas décorative : des octets relus du magasin ne mesurent RIEN du
 * lien, et les faire passer par le même chemin que le réseau ferait voir au compteur de débit
 * plusieurs gigabits par seconde, donc AUCUN plafond de vitesse à afficher (lot 17D) — puis la
 * date se remettrait à attendre en silence dès la première fenêtre réellement manquante.
 * Défaut vu en écrivant cette phase, pas en la relisant : c'est pourquoi la lecture du magasin
 * se fait avant `TransferRateMeter.begin`, et non à l'intérieur de `fetchBody`.
 */
interface FetchedBody {
  readonly body: LoadedBody;
  readonly stored: {
    readonly firstIndex: number;
    readonly lastIndex: number;
    readonly bytes: ArrayBuffer;
  };
}

/** Premier échantillon tenu, dans la grille du FICHIER. */
function heldFirstIndex(body: LoadedBody): number {
  return body.firstIndex ?? 0;
}

/** Nombre d'échantillons tenus, qui vaut `manifest.sampleCount` quand le fichier est entier. */
function heldSampleCount(body: LoadedBody): number {
  return body.samples.length / COMPONENTS_PER_SAMPLE;
}

/** La fenêtre tenue, exprimée comme un plan l'exprime. */
function heldWindow(body: LoadedBody): SampleWindow | null {
  const count = heldSampleCount(body);
  if (count < 1) return null;
  const firstIndex = heldFirstIndex(body);
  const lastIndex = firstIndex + count - 1;
  return {
    firstIndex,
    lastIndex,
    ...byteRangeForIndices(firstIndex, lastIndex),
  };
}

/** Le corps tient-il déjà tout ce que ce plan demande ? */
function holdsWindow(body: LoadedBody, wanted: SampleWindow): boolean {
  const held = heldWindow(body);
  return held !== null && windowContains(held, wanted);
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
    /** La dernière demande de scène. `null` : on charge les fichiers entiers. */
    scene: SceneWindowRequest | null;
    /** Le manifeste, quand il est arrivé. `null` : il reste à demander. */
    manifest: {
      entries: [string, HorizonsBodyManifest][];
      baseUrl: URL;
      /** Le manifeste TEL QUEL, pour que le magasin en range une copie hors ligne. */
      raw: unknown;
    } | null;
    /** Le magasin de cet appareil, ou `null` quand il n'y en a pas (cf. `EphemerisStore`). */
    store: EphemerisStore | null;
  } | null = null;

  private _report: EphemerisLoadReport;
  private readonly _listeners: ((report: EphemerisLoadReport) => void)[] = [];
  /** Absences DÉFINITIVES (404, origine étrangère, taille fausse) : plus jamais redemandées. */
  private readonly _permanent = new Map<string, EphemerisLoadFailure>();
  /**
   * Dernière fenêtre DEMANDÉE pour chaque corps, qu'elle soit arrivée ou non. Sans cette
   * mémoire, une fenêtre qui n'arrive jamais figerait l'horloge pour toujours : on la demande,
   * on dit qu'elle manque (lot 15), et on laisse la scène continuer avec la source de repli.
   */
  private readonly _attempted = new Map<string, SampleWindow | 'full'>();
  /**
   * L'hôte a ignoré une plage (200 avec tout le fichier) ou répondu quelque chose qui ne
   * décrit pas ce fichier : on repasse aux fichiers entiers pour tout le monde. C'est la
   * décision D7 du lot 17 — sur un hébergement sans plages, l'application marche comme avant,
   * au prix d'aujourd'hui, plutôt que de ne pas marcher.
   */
  private _rangesRefused = false;
  /**
   * Débit observé, mesuré sur le TEMPS OCCUPÉ (`core/transferRate`). Il n'existe que pour
   * répondre à une question de produit : quelle vitesse de lecture ce lien soutient-il
   * (§ 9b du plan du lot 17, option (c)). Une requête qui échoue y entre avec 0 octet, le
   * temps qu'elle a occupé étant du temps où le lien n'a rien livré.
   */
  private readonly _rate = new TransferRateMeter();

  /** Un seul chargement à la fois : un double clic sur « reprendre » ne doit pas doubler. */
  private _loading: Promise<void> | null = null;

  /**
   * Ce que le magasin de l'appareil tenait au dernier passage. Mémorisé parce que `budgetGrids`
   * est SYNCHRONE (l'horloge l'interroge à chaque image) alors que lire un cache ne l'est pas.
   * Périmé d'au plus un passage, ce qui est sans conséquence : un fichier rangé entre deux
   * passages fait seulement garder un plafond de vitesse une image de trop.
   */
  private _inventory: StoreInventory | null = null;

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
      now: options.now ?? monotonicNow,
    };
    const service = new HorizonsEphemerisService(new Map(), {
      declared: 0,
      manifestFailed: true,
      loaded: [],
      missing: [],
      retryable: true,
    });
    // `undefined` veut dire « ouvre-le si ce navigateur en a un » ; `null`, « n'en ouvre pas »,
    // ce que demandent les tests et les mesures qui comptent le RÉSEAU.
    const store =
      options.store === undefined ? await EphemerisStore.open() : options.store;
    service._pending = {
      manifestUrl,
      bodyMu,
      policy,
      scene: options.scene ?? null,
      manifest: null,
      store,
    };
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
   * Débit observé, en octets par seconde, ou `null` tant qu'il n'y a pas de quoi le mesurer.
   *
   * Mesuré sur le TEMPS OCCUPÉ, jamais requête par requête : six requêtes simultanées se
   * partagent la bande passante, donc `octets / durée` d'une requête sous-estime le lien d'un
   * facteur proche du nombre de requêtes en vol. C'est la mesure qui a trompé le lot 15.
   */
  get observedBytesPerSecond(): number | null {
    return this._rate.bytesPerSecond;
  }

  /**
   * Les grilles des corps qui demandent des octets À CETTE DATE, pour que
   * `core/playbackBudget` en dérive le coût d'un jour simulé.
   *
   * Un corps hors couverture ne demande rien et n'entre donc pas dans le budget : le compter
   * gonflerait la demande d'un tiers au 1969-07-20 (11 corps sur 64, mesuré), et le plafond de
   * vitesse serait plus bas que ce que le lien soutient vraiment.
   */
  budgetGrids(date: Date): SampleGrid[] {
    const manifests = this._pending?.manifest?.entries;
    const grids: SampleGrid[] = [];
    const push = (manifest: HorizonsBodyManifest): void => {
      const grid: SampleGrid = {
        startJdTdb: manifest.startJdTdb,
        stepDays: manifest.stepDays,
        sampleCount: manifest.sampleCount,
      };
      // Un corps dont l'appareil tient le fichier ENTIER (lot 17E, « préparer le hors-ligne »)
      // ne demandera plus un octet, quelle que soit la date : le compter dans le budget
      // plafonnerait la lecture au nom d'un trafic qui n'aura pas lieu.
      if (this._holdsWholeFile(manifest)) return;
      if (covers(grid, date)) grids.push(grid);
    };
    if (manifests) for (const [, manifest] of manifests) push(manifest);
    else for (const body of this.bodies.values()) push(body.manifest);
    return grids;
  }

  /** L'appareil tient-il ce fichier ENTIER ? Lu dans l'inventaire du dernier passage. */
  private _holdsWholeFile(manifest: HorizonsBodyManifest): boolean {
    const span = this._inventory?.spans.get(manifest.file);
    return (
      span !== undefined &&
      span.firstIndex === 0 &&
      span.lastIndex === manifest.sampleCount - 1
    );
  }

  /**
   * CE QUE CET APPAREIL TIENT VRAIMENT, relu du magasin — jamais un drapeau qu'on aurait
   * posé après un téléchargement.
   *
   * C'est la règle que le projet applique déjà à la disponibilité des sondes depuis le lot 7e :
   * un état MESURÉ, ou rien. Un « c'est prêt » mémorisé survivrait à un cache vidé par le
   * navigateur sous la pression du quota, et l'utilisateur emporterait en classe un appareil
   * qui a oublié ses fichiers.
   */
  async offlineState(): Promise<OfflineState> {
    const pending = this._pending;
    const entries = pending?.manifest?.entries ?? [];
    const declaredBytes = entries.reduce(
      (total, [, manifest]) =>
        total + fileByteLength(HorizonsEphemerisService._grid(manifest)),
      0
    );
    if (!pending?.store)
      return {
        available: false,
        declaredFiles: entries.length,
        declaredBytes,
        completeFiles: 0,
        storedBytes: 0,
        remainingBytes: declaredBytes,
      };
    const inventory = await pending.store.inventory();
    this._inventory = inventory;
    let completeFiles = 0;
    let remainingBytes = 0;
    for (const [, manifest] of entries) {
      const span = inventory.spans.get(manifest.file);
      if (
        span &&
        span.firstIndex === 0 &&
        span.lastIndex === manifest.sampleCount - 1
      )
        completeFiles++;
      else
        remainingBytes += fileByteLength(
          HorizonsEphemerisService._grid(manifest)
        );
    }
    return {
      available: true,
      declaredFiles: entries.length,
      declaredBytes,
      completeFiles,
      storedBytes: inventory.bytes,
      remainingBytes,
    };
  }

  /**
   * Télécharge les fichiers ENTIERS que cet appareil n'a pas encore, pour qu'il sache placer
   * les corps sans réseau, à n'importe quelle date de la couverture.
   *
   * Option (a2), tranchée par l'utilisateur le 2026-09-23 : le hors-ligne est DEMANDÉ, pas
   * subi. Un téléchargement automatique de 38 Mo serait pris sur le forfait de quelqu'un sans
   * qu'il l'ait voulu ; « je prépare chez moi, j'enseigne sans réseau » est une fonctionnalité.
   *
   * Le débit N'EST PAS mesuré ici, et c'est un choix : ce transfert n'est pas celui que
   * l'horloge demandera ensuite (une fois préparés, ces corps ne demandent plus rien, cf.
   * `budgetGrids`), donc le plafond de vitesse de lecture n'a aucune raison d'en dépendre.
   */
  async prepareOffline(
    options: PrepareOfflineOptions = {}
  ): Promise<OfflineState> {
    const pending = this._pending;
    if (!pending?.store || !pending.manifest) return this.offlineState();
    const { store, manifest, policy } = pending;
    const { baseUrl, entries, raw } = manifest;
    await store.writeManifest(raw);

    const inventory = await store.inventory();
    const wanted = entries.filter(([, body]) => {
      const span = inventory.spans.get(body.file);
      return !(
        span &&
        span.firstIndex === 0 &&
        span.lastIndex === body.sampleCount - 1
      );
    });

    let done = entries.length - wanted.length;
    options.onProgress?.({ done, total: entries.length });

    await mapWithConcurrency(
      wanted,
      policy.concurrency,
      async ([, body]): Promise<void> => {
        if (options.signal?.aborted) return;
        try {
          const url = new URL(body.file, baseUrl);
          if (url.origin !== baseUrl.origin) return;
          const response = await fetch(
            url,
            options.signal ? { signal: options.signal } : {}
          );
          if (!response.ok) return;
          const buffer = await response.arrayBuffer();
          // Des octets servis à la mauvaise taille ne seront jamais lisibles, et ranger un
          // fichier tronqué ferait croire l'appareil prêt. C'est le MAGASIN qui refuse, pas
          // ici : il confronte déjà toute écriture à la tranche annoncée, et une seconde
          // vérification au même endroit du code n'aurait pas d'existence falsifiable.
          await store.write(
            body.file,
            { firstIndex: 0, lastIndex: body.sampleCount - 1 },
            buffer
          );
        } catch {
          /* Le lien a lâché : l'état relu dira exactement où en est l'appareil. */
        } finally {
          done++;
          options.onProgress?.({ done, total: entries.length });
        }
      }
    );

    return this.offlineState();
  }

  /** Rend la place. L'utilisateur reprendra ses 38 Mo quand il le décidera. */
  async forgetOffline(): Promise<OfflineState> {
    const store = this._pending?.store;
    if (store) await store.clear();
    this._inventory = null;
    return this.offlineState();
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
   * Les octets qu'il faut pour cette demande sont-ils DÉJÀ là ? Question synchrone, posée par
   * l'horloge avant de laisser la date avancer (lot 17, décision D3 : « la date n'avance que
   * sur des données arrivées »). Répondre `true` à tort, c'est afficher une position de repli
   * en se taisant, exactement ce que le lot 15 a corrigé.
   *
   * Trois cas rendent `true` sans que rien n'ait été chargé, et chacun est une INFORMATION :
   * le corps n'est pas couvert à cette date (il ne répondrait pas davantage avec son fichier
   * entier), son absence est définitive (404 : rien ne viendra), ou sa fenêtre a déjà été
   * demandée sans revenir et aucun chargement n'est en cours — le bandeau le dit, et on ne
   * fige pas la scène pour toujours.
   */
  hasCoverageFor(request: SceneWindowRequest): boolean {
    const pending = this._pending;
    // Pas de manifeste : soit il n'est pas arrivé (le bandeau le dit déjà), soit ce service
    // vient du disque et tient tout. Dans les deux cas, il n'y a rien à attendre.
    if (!pending?.manifest) return true;
    const plans = this._planAll(
      pending.manifest.entries,
      request,
      pending.bodyMu
    );
    for (const [name, plan] of plans) {
      if (plan === null) continue;
      if (this._holds(name, plan)) continue;
      if (this._permanent.has(name)) continue;
      if (this._loading === null && this._attemptCovers(name, plan)) continue;
      return false;
    }
    return true;
  }

  /**
   * Demande les fenêtres manquantes pour cette scène et résout quand elles sont là — ou quand
   * leur absence est ACTÉE, ce qui est la même chose du point de vue de l'appelant : dans les
   * deux cas il peut avancer, et le rapport dit lequel des deux s'est produit.
   */
  async ensureCoverage(
    request: SceneWindowRequest
  ): Promise<EphemerisLoadReport> {
    const pending = this._pending;
    if (!pending) return this._report;
    pending.scene = request;
    await this._load();
    // La demande a pu changer PENDANT un chargement déjà en cours, qui a alors rendu la main
    // sur l'ancienne : un second passage lit la nouvelle.
    if (!this.hasCoverageFor(request)) await this._load();
    return this._report;
  }

  /** Ce corps tient-il déjà ce plan ? */
  private _holds(name: string, plan: SampleWindow | 'full'): boolean {
    const held = this.bodies.get(name);
    if (!held) return false;
    return plan === 'full'
      ? heldSampleCount(held) === held.manifest.sampleCount
      : holdsWindow(held, plan);
  }

  /** Ce plan a-t-il déjà été demandé, sans revenir ? */
  private _attemptCovers(name: string, plan: SampleWindow | 'full'): boolean {
    const attempted = this._attempted.get(name);
    if (attempted === undefined) return false;
    if (attempted === 'full') return true;
    return plan !== 'full' && windowContains(attempted, plan);
  }

  /** La grille du fichier, telle que le manifeste la déclare. */
  private static _grid(entry: HorizonsBodyManifest): SampleGrid {
    return {
      startJdTdb: entry.startJdTdb,
      stepDays: entry.stepDays,
      sampleCount: entry.sampleCount,
    };
  }

  /**
   * Ce qu'un corps doit tenir : une fenêtre, le fichier ENTIER, ou rien.
   *
   * Deux raisons de charger un fichier entier malgré une demande de scène, et toutes deux
   * sont des FAITS, pas des précautions : l'hôte a refusé les plages (D7), ou le facteur
   * d'échelle du temps de propagation n'est pas publié au manifeste, auquel cas il se calcule
   * sur le fichier entier et une fenêtre en donnerait un autre, donc une autre position
   * (mesuré au lot 17B : jusqu'à 202 m sur Mimas). La phase 17B l'a publié pour les sept corps
   * concernés ; ce chemin ne sert plus qu'à un manifeste antérieur.
   */
  private _planBody(
    name: string,
    entry: HorizonsBodyManifest,
    scene: SceneWindowRequest | null,
    bodyMu: Readonly<Record<string, BodyDynamics>>
  ): SampleWindow | 'full' | null {
    if (!scene) return 'full';
    const dynamics = bodyMu[name];
    const wholeFile =
      this._rangesRefused ||
      (dynamics?.meanMotionPropagation && entry.meanMotionScale === undefined);
    if (wholeFile) {
      // Même sans plages, un corps que la date ne concerne pas ne demande RIEN : la
      // couverture se lit au manifeste, pas dans les octets. Onze corps sur 64 sont dans ce
      // cas au 1969-07-20 (mesuré), et leur fichier entier serait payé pour un `null`.
      return covers(HorizonsEphemerisService._grid(entry), scene.date)
        ? 'full'
        : null;
    }
    return planBodyWindow(HorizonsEphemerisService._grid(entry), {
      date: scene.date,
      ...(scene.leadDays !== undefined ? { leadDays: scene.leadDays } : {}),
      ...(scene.orbitPeriodDays?.[name] !== undefined
        ? { orbitPeriodDays: scene.orbitPeriodDays[name] }
        : {}),
    });
  }

  /**
   * Le plan de TOUS les corps, familles du ballant comprises.
   *
   * Un corps qui subit le ballant d'un compagnon (Pluton et ses quatre petites lunes) exige
   * que ce compagnon soit tenu sur le MÊME intervalle d'index, sinon on soustrait deux
   * instants différents (piège 7 du plan, trouvé par un test rouge en 17A). La fenêtre du
   * compagnon est donc la RÉUNION de la sienne et de celles qui en dépendent.
   */
  private _planAll(
    entries: readonly [string, HorizonsBodyManifest][],
    scene: SceneWindowRequest | null,
    bodyMu: Readonly<Record<string, BodyDynamics>>
  ): Map<string, SampleWindow | 'full' | null> {
    const plans = new Map<string, SampleWindow | 'full' | null>();
    const byName = new Map(entries);
    for (const [name, entry] of entries)
      plans.set(name, this._planBody(name, entry, scene, bodyMu));

    for (const [name, entry] of entries) {
      const companionName = bodyMu[name]?.reflex?.companion;
      if (companionName === undefined) continue;
      const companion = byName.get(companionName);
      // Grilles différentes : `_withoutReflex` refuse déjà de mélanger deux pas, et élargir
      // la fenêtre du compagnon n'y changerait rien — ce serait payer des octets pour rien.
      if (
        !companion ||
        companion.startJdTdb !== entry.startJdTdb ||
        companion.stepDays !== entry.stepDays ||
        companion.sampleCount !== entry.sampleCount
      )
        continue;
      const plan = plans.get(name);
      if (plan === null || plan === undefined) continue;
      const companionPlan = plans.get(companionName) ?? null;
      if (plan === 'full' || companionPlan === 'full') {
        plans.set(companionName, 'full');
        continue;
      }
      plans.set(
        companionName,
        companionPlan === null ? plan : mergeWindows(companionPlan, plan)
      );
    }
    return plans;
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
        pending.manifest = await fetchManifest(
          pending.manifestUrl,
          pending.store
        );
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
    const plans = this._planAll(entries, pending.scene, pending.bodyMu);
    // L'inventaire du magasin se lit UNE fois par passage : `cache.keys()` par corps ferait
    // 62 relectures du cache entier pour la même réponse.
    const inventory = pending.store ? await pending.store.inventory() : null;
    this._inventory = inventory;
    // Ce qu'on demande : ni ce qu'on tient déjà, ni ce dont l'absence est DÉFINITIVE. Sans
    // cette seconde condition, un 404 au milieu d'échecs de transport serait redemandé à
    // chaque passage alors que le contrat dit qu'on ne le reprend jamais : le passage, lui,
    // continue tant qu'un seul échec reprenable subsiste.
    //
    // « Ce qu'on tient » est devenu une question de FENÊTRE au lot 17 : un corps déjà chargé
    // peut avoir besoin d'octets qu'il n'a pas, et un corps hors couverture n'a besoin de
    // rien du tout — il est alors inscrit sans la moindre requête.
    const wanted = entries.filter(([name]) => {
      if (this._permanent.has(name)) return false;
      const plan = plans.get(name) ?? null;
      if (plan === null) return !this.bodies.has(name);
      return !this._holds(name, plan);
    });
    const failures = await mapWithConcurrency(
      wanted,
      policy.concurrency,
      async ([name, body]): Promise<EphemerisLoadFailure | null> => {
        const plan = plans.get(name) ?? null;
        if (plan !== null) this._attempted.set(name, plan);
        const base = bodyBase(body, pending.bodyMu[name]);
        // Un corps hors couverture ne fait AUCUNE requête : le mesurer ajouterait du temps
        // occupé sans un octet et ferait passer le lien pour lent (11 corps sur 64 au
        // 1969-07-20).
        if (plan === null) {
          this.bodies.set(name, {
            ...base,
            samples: new Float64Array(0),
            firstIndex: 0,
          });
          return null;
        }

        // Ce que l'appareil tient déjà ne se redemande pas, et ne mesure RIEN du lien : c'est
        // ici que la visite de retour devient gratuite et que le hors-ligne existe (lot 17E).
        // La question posée au magasin est la MÊME que celle posée à la mémoire.
        const held = await readHeld(pending.store, inventory, body, plan);
        if (held) {
          this.bodies.set(name, {
            ...base,
            samples: new Float64Array(held.bytes),
            firstIndex: held.firstIndex,
          });
          return null;
        }

        this._rate.begin(policy.now());
        try {
          const fetched = await fetchBody(
            name,
            body,
            baseUrl,
            pending.bodyMu,
            plan,
            () => {
              this._rangesRefused = true;
            }
          );
          this.bodies.set(name, fetched.body);
          this._rate.end(policy.now(), fetched.body.samples.byteLength);
          if (pending.store)
            await pending.store.write(
              body.file,
              {
                firstIndex: fetched.stored.firstIndex,
                lastIndex: fetched.stored.lastIndex,
              },
              fetched.stored.bytes
            );
          return null;
        } catch (error) {
          this._rate.end(policy.now(), 0);
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

    // Les séries sans ballant sont construites sur l'INTERSECTION de deux fenêtres : une
    // fenêtre qui vient d'arriver les périme toutes (cf. `_withoutReflex`).
    for (const body of this.bodies.values()) delete body.withoutReflex;

    // Ce que la scène demande vraiment à cette date : les corps hors couverture n'ont rien à
    // recevoir et sortent donc des DEUX comptes (cf. `EphemerisLoadReport.declared`).
    const needed = entries.filter(
      ([name]) => (plans.get(name) ?? null) !== null
    );
    const missing = needed
      .map(
        ([name]) =>
          this._permanent.get(name) ??
          failures.find((failure) => failure?.body === name) ??
          null
      )
      .filter((failure): failure is EphemerisLoadFailure => failure !== null);
    const missingNames = new Set(missing.map((failure) => failure.body));
    if (missing.length > 0) {
      Logger.warn(
        `[HorizonsEphemerisService] ${missing.length}/${needed.length} ephemerides missing`,
        missing
      );
    } else {
      Logger.success(
        `[HorizonsEphemerisService] Loaded ${this.bodies.size} precise ephemerides`
      );
    }
    this._publish({
      declared: needed.length,
      manifestFailed: false,
      // Un corps dont la fenêtre courante a échoué n'est pas « reçu », même s'il tient encore
      // celle d'avant : c'est ce que le bandeau compte, et il compte ce qui répond ICI.
      loaded: needed
        .map(([name]) => name)
        .filter((name) => this.bodies.has(name) && !missingNames.has(name)),
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
   *
   * La soustraction se fait sur l'INTERSECTION des deux fenêtres tenues (lot 17). Sans cette
   * précaution, deux fenêtres décalées d'un seul échantillon retireraient le ballant d'un
   * autre instant, et Pluton comme ses quatre petites lunes se placeraient ailleurs sans la
   * moindre erreur — c'est le piège 7 du plan, devenu rouge dans `ephemerisWindow.test.ts`
   * avant d'être une contrainte de ce code. La planification demande donc au compagnon au
   * moins la fenêtre du corps (cf. `_planAll`) ; ceci en est la dernière garde.
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
      const firstIndex = Math.max(
        heldFirstIndex(body),
        heldFirstIndex(companion)
      );
      const lastIndex = Math.min(
        heldFirstIndex(body) + heldSampleCount(body) - 1,
        heldFirstIndex(companion) + heldSampleCount(companion) - 1
      );
      // Un seul échantillon commun n'interpole rien : `_sampleGrid` a besoin de l'index ET
      // du suivant.
      if (lastIndex - firstIndex >= 1) {
        const count = lastIndex - firstIndex + 1;
        const samples = new Float64Array(count * COMPONENTS_PER_SAMPLE);
        const bodyOffset =
          (firstIndex - heldFirstIndex(body)) * COMPONENTS_PER_SAMPLE;
        const companionOffset =
          (firstIndex - heldFirstIndex(companion)) * COMPONENTS_PER_SAMPLE;
        for (let i = 0; i < samples.length; i++)
          samples[i] =
            body.samples[bodyOffset + i] -
            reflex.factor * companion.samples[companionOffset + i];
        result = { manifest: m, samples, firstIndex, dynamics: body.dynamics };
      }
    }
    body.withoutReflex = result;
    return result;
  }

  private _sampleGrid(body: LoadedBody, date: Date): THREE.Vector3 | null {
    const { startJdTdb, stepDays, sampleCount } = body.manifest;
    const samplePosition = (jdTdbFromDate(date) - startJdTdb) / stepDays;
    const index = Math.floor(samplePosition);
    if (index < 0 || index >= sampleCount - 1) return null;

    // Le FICHIER couvre la date ; reste à savoir si les octets tenus la portent. Depuis le
    // lot 17 le service n'en charge qu'une fenêtre, et l'index du fichier n'est pas l'index
    // du tampon : les confondre lirait un autre instant, sans aucune erreur. Hors fenêtre on
    // répond `null` comme hors couverture — c'est l'horloge (`OrbitalMechanics`) qui a la
    // charge de ne pas y aller, et non ce lecteur de deviner.
    const local = index - heldFirstIndex(body);
    if (local < 0 || local + 1 >= heldSampleCount(body)) return null;

    const u = samplePosition - index;
    return (
      this._keplerianBetweenSamples(body, local, u) ??
      this._hermiteBetweenSamples(body, local, u)
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
    /** Index dans les échantillons TENUS, pas dans la grille du fichier (cf. `_sampleGrid`). */
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
      // (mesuré : 28,2 m sur Encelade, jusqu'à 202,4 m sur Mimas).
      scale =
        body.manifest.meanMotionScale ??
        medianMeanMotionScale(
          body.samples,
          heldSampleCount(body),
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
    /** Index dans les échantillons TENUS, pas dans la grille du fichier (cf. `_sampleGrid`). */
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

/**
 * Demande le manifeste, et en vérifie le schéma ET l'origine.
 *
 * Depuis le lot 17E, une copie en est rangée dans le magasin de l'appareil, et c'est elle qui
 * répond quand le réseau ne répond pas. Sans cela, « préparer le hors-ligne » ne tiendrait pas
 * sa promesse plus d'une heure : le manifeste est servi en `NetworkFirst` avec une péremption
 * d'une heure (`ssv-ephemeris-manifest` dans `vite.config.ts`), donc passé ce délai un appareil
 * portant ses 64 fichiers afficherait quand même « aucune éphéméride précise ».
 *
 * L'ordre reste le réseau d'abord : le manifeste est le SEUL fichier mutable de cette famille,
 * il pointe des binaires nommés par le hachage de leur contenu, et une copie périmée pointerait
 * des fichiers que le déploiement suivant a supprimés.
 */
async function fetchManifest(
  manifestUrl: string,
  store: EphemerisStore | null
): Promise<{
  entries: [string, HorizonsBodyManifest][];
  baseUrl: URL;
  raw: unknown;
}> {
  const manifestAbsoluteUrl = new URL(manifestUrl, window.location.href);
  if (manifestAbsoluteUrl.origin !== window.location.origin) {
    throw new LoadFailure('manifest must use the application origin', false);
  }

  let raw: unknown;
  let fromNetwork = false;
  try {
    const response = await fetch(manifestUrl);
    if (!response.ok)
      throw new LoadFailure(
        `manifest HTTP ${response.status}`,
        isRetryableStatus(response.status)
      );
    raw = await response.json();
    fromNetwork = true;
  } catch (networkError) {
    const stored = store ? await store.readManifest() : null;
    // Pas de copie : l'échec du réseau est l'échec, avec sa reprenabilité d'origine.
    if (stored === null) throw networkError;
    raw = stored;
  }

  // Un manifeste illisible ne se répare pas en le redemandant.
  if (!isManifest(raw)) throw new LoadFailure('invalid manifest schema', false);

  if (fromNetwork && store) {
    await store.writeManifest(raw);
    // Le manifeste qui vient d'arriver est la seule vérité sur ce qui existe : ce que le
    // magasin tient d'autre ne sera plus jamais relu et occuperait la place jusqu'au quota.
    await store.prune(
      new Set(Object.values(raw.bodies).map((body) => body.file))
    );
  }

  return {
    entries: Object.entries(raw.bodies),
    baseUrl: new URL('.', manifestAbsoluteUrl),
    raw,
  };
}

/**
 * DEMANDE un binaire au réseau — tout entier ou une FENÊTRE — en vérifie l'origine et la
 * taille, et le prépare.
 *
 * Cette fonction ne connaît QUE le réseau, et depuis le lot 17E c'est délibéré : ce que
 * l'appareil tient déjà est lu avant elle (`_heldBody`), justement pour que la mesure de débit
 * n'encadre que des octets qui ont vraiment traversé le lien.
 *
 * Deux cas ne l'atteignent jamais : un corps hors couverture, qui est inscrit SANS la moindre
 * requête (onze corps sur 64 au 1969-07-20, mesuré en écrivant le plan du lot 17), et un corps
 * dont le magasin tient déjà la fenêtre.
 */
async function fetchBody(
  name: string,
  body: HorizonsBodyManifest,
  baseUrl: URL,
  bodyMu: Readonly<Record<string, BodyDynamics>>,
  plan: SampleWindow | 'full',
  onRangesRefused: () => void
): Promise<FetchedBody> {
  const dynamics = bodyMu[name];
  const base = {
    manifest: body,
    ...(dynamics ? { dynamics } : {}),
  };
  const binaryUrl = new URL(body.file, baseUrl);
  if (binaryUrl.origin !== baseUrl.origin) {
    throw new LoadFailure(
      `${name}: binary asset must use the application origin`,
      false
    );
  }
  const grid = {
    startJdTdb: body.startJdTdb,
    stepDays: body.stepDays,
    sampleCount: body.sampleCount,
  };
  const expectedBytes = fileByteLength(grid);

  if (plan === 'full') {
    const binaryResponse = await fetch(binaryUrl);
    if (!binaryResponse.ok)
      throw new LoadFailure(
        `${name} HTTP ${binaryResponse.status}`,
        isRetryableStatus(binaryResponse.status)
      );
    const buffer = await binaryResponse.arrayBuffer();
    // Des octets servis à la mauvaise taille sont un défaut de déploiement, pas de transport.
    if (buffer.byteLength !== expectedBytes) {
      throw new LoadFailure(
        `${name}: ${buffer.byteLength} bytes, expected ${expectedBytes}`,
        false
      );
    }
    return {
      body: { ...base, samples: new Float64Array(buffer), firstIndex: 0 },
      stored: { firstIndex: 0, lastIndex: body.sampleCount - 1, bytes: buffer },
    };
  }

  const rangeResponse = await fetch(binaryUrl, {
    headers: { Range: rangeHeader(plan) },
  });
  if (!rangeResponse.ok)
    throw new LoadFailure(
      `${name} HTTP ${rangeResponse.status}`,
      isRetryableStatus(rangeResponse.status)
    );
  const buffer = await rangeResponse.arrayBuffer();
  const outcome = interpretRangeResponse(
    rangeResponse.status,
    rangeResponse.headers?.get('Content-Range') ?? null,
    buffer.byteLength,
    plan,
    grid
  );
  if (outcome.kind === 'invalid') {
    // L'hôte rend quelque chose qui ne décrit pas ce fichier : on renonce aux plages pour
    // TOUT le monde, et le passage suivant redemande les fichiers entiers (décision D7).
    // Reprenable, donc : c'est bien ce passage-là qui est perdu, pas le corps.
    onRangesRefused();
    throw new LoadFailure(`${name}: ${outcome.reason}`, true);
  }
  if (outcome.kind === 'full') {
    // La plage a été ignorée et l'hôte a rendu tout le fichier : on le GARDE (on l'a payé),
    // et on cesse de demander des plages.
    onRangesRefused();
    return {
      body: { ...base, samples: new Float64Array(buffer), firstIndex: 0 },
      stored: { firstIndex: 0, lastIndex: body.sampleCount - 1, bytes: buffer },
    };
  }
  return {
    body: {
      ...base,
      samples: new Float64Array(buffer),
      firstIndex: plan.firstIndex,
    },
    stored: {
      firstIndex: plan.firstIndex,
      lastIndex: plan.lastIndex,
      bytes: buffer,
    },
  };
}
