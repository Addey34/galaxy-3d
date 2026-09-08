/**
 * Moteur de mouvement : positionne et oriente chaque corps à chaque frame, dans les
 * deux modes d'affichage.
 *
 *   - Éducatif ('educ') : MÊME mouvement que l'Explo — on lit la vraie position
 *     astronomy-engine, on en extrait l'angle dans le plan orbital (Ω, i J2000) et on
 *     la pose sur un cercle de rayon compressé √(distanceAU)×K. Éduc et Explo sont donc
 *     le même mouvement aligné sur l'horloge/éphéméride, seule l'échelle radiale diffère.
 *   - Exploration ('explo') : positions de Kepler réelles fournies par EphemerisService,
 *     échelle linéaire (AU × K).
 *
 * Gère aussi la synchronisation avec l'horloge (`syncAnglesFromEphemeris` oriente les axes
 * de rotation et cale la rotation de la Terre sur l'heure UTC), le voyage temporel et les
 * points des orbites éducatives.
 */
import * as THREE from 'three';
import { Body, Equator, Observer, SiderealTime } from 'astronomy-engine';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import type { CelestialBodies } from '@/components/systems/SceneSystem';
import type { SimulationClock } from './SimulationClock';
import type { EphemerisService } from './EphemerisService';
import type { OrbitalElementsService } from './OrbitalElementsService';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';
import { KM_PER_AU, ScaleService, SQRT_K } from './ScaleService';
import { computeLightAttenuation } from './eclipse';
import { BodyPositionResolver } from './BodyPositionResolver';
import { OrbitPathBuilder } from './orbitPath';
import { educationalParentOrbitScale } from './educationalScale';
import { HOURS_TO_RAD } from './MathConstants';
import { surfaceRotationForSubsolarLongitude } from './frames';
import { forEachBody } from '@/config/catalog';

/** Corps sans mouvement orbital propre (skybox étoilée, étoile centrale à l'origine). */
function hasOrbit(cfg: CelestialBodyConfig): boolean {
  return cfg.kind !== 'skybox' && cfg.kind !== 'star';
}

const ZERO = new THREE.Vector3(0, 0, 0);

const MS_PER_DAY = 86_400_000;

/** Durée (secondes) de la transition animée des positions et tailles Éduc↔Explo. */
const MORPH_DURATION_S = 1.2;

/** Cubic InOut — même courbe que les vols caméra (TWEEN.Easing.Cubic.InOut). */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const EARTH_OBSERVER = new Observer(0, 0, 0);

// Vecteurs de travail du calage de rotation terrestre — évite d'allouer à chaque sync.
const _tmpSunDirection = new THREE.Vector3();
const _tmpTiltQuaternion = new THREE.Quaternion();

/**
 * Greenwich subsolar longitude, positive east, from apparent sidereal time.
 *
 * GAST is the right ascension crossing Greenwich. The solar meridian is where
 * the Sun's apparent right ascension equals local apparent sidereal time.
 */
export function computeGreenwichSubsolarLongitude(date: Date): number {
  const gastHours = SiderealTime(date);
  const sunRightAscensionHours = Equator(
    Body.Sun,
    date,
    EARTH_OBSERVER,
    true,
    true
  ).ra;
  const rawHours = sunRightAscensionHours - gastHours;
  const wrappedHours = ((((rawHours + 12) % 24) + 24) % 24) - 12;
  return wrappedHours * HOURS_TO_RAD;
}

/**
 * Latitude du point subsolaire = declinaison apparente du Soleil (equateur de la date), en
 * degres. Verite INDEPENDANTE du chemin qui oriente la Terre : la longitude subsolaire ne
 * dit rien de l'orientation de l'AXE, or une erreur d'axe fait pivoter le terminateur autour
 * du point sous-observateur — les lumieres de ville prennent alors de l'avance a un bout du
 * terminateur et du retard a l'autre, sans aucune erreur de longitude.
 */
export function computeSubsolarLatitude(date: Date): number {
  return Equator(Body.Sun, date, EARTH_OBSERVER, true, true).dec;
}

export class OrbitalMechanics {
  private readonly scale = new ScaleService();
  private readonly _exploPos = new THREE.Vector3();
  private readonly _educPos = new THREE.Vector3();
  /** Nom d'un satellite parentRelative → enum astronomy-engine de son parent. */
  private readonly _parentAstroBody = new Map<string, Body>();
  private readonly _parentName = new Map<string, string>();
  /**
   * Seule autorite sur « d'ou vient la position de ce corps » (cf. `BodyPositionResolver`).
   * Construit en fin de constructeur, une fois les tables de parents remplies.
   */
  private _positions!: BodyPositionResolver;
  /** Construit les lignes d'orbite (cf. `orbitPath.ts`). */
  private _paths!: OrbitPathBuilder;
  private _prevPaused = false;
  private _simDeltaSeconds = 0;

  // ── Throttle du recalcul d'éphéméride ──
  // HelioVector (astronomy-engine) est un calcul de séries coûteux, exécuté par corps et par
  // frame. Au temps réel (1×) la date n'avance que de ~16 ms/frame : les positions sont
  // visuellement identiques d'une frame à l'autre → recalculer chaque frame est du gaspillage
  // CPU pur + des allocations Vector3 qui nourrissent le GC (lag continu, aggravé sous RAM
  // saturée). On ne recalcule donc les positions que lorsque la date SIMULÉE a avancé d'assez
  // pour être VISIBLE. Le seuil est PAR CORPS, dérivé de sa période orbitale : un seuil absolu
  // global ferait saccader les lunes rapides (Phobos, période ~7,6 h, saut ~14°/pas à 5 min)
  // tout en sur-recalculant Neptune. On borne le mouvement à ~0,5° d'orbite par pas → invisible
  // pour tous, tout en gardant un recalcul rare au 1× (Phobos : ~0,5° en ~38 s réelles).
  // `_lastPositionMs = null` force le premier recalcul (et après tout saut/morph/reprise).
  private _lastPositionMs: number | null = null;
  // Fraction d'orbite tolérée entre deux recalculs (0,5° → mouvement lisse, saut imperceptible).
  private static readonly _RECOMPUTE_ORBIT_FRACTION = 0.5 / 360;
  // Corps sans période connue (aucun mouvement orbital rapide) : seuil de repli confortable.
  private static readonly _FALLBACK_THRESHOLD_MS = 5 * 60 * 1000;
  // Seuil du corps le plus rapide (ms simulées) : c'est lui qui décide quand recalculer le
  // batch entier (les corps restent ainsi cohérents entre eux). Calculé une fois au boot ;
  // la valeur initiale n'est qu'un repli avant le calcul du constructeur.
  private _minRecomputeThresholdMs = OrbitalMechanics._FALLBACK_THRESHOLD_MS;

  /** Notifie l'application pour recalculer les lignes éducatives après un saut/date ou mode. */
  onOrbitsChanged: (() => void) | null = null;

  // ── Transition animée Éduc↔Explo ──
  // `_morph` : 0 = Éducatif (√ compressé), 1 = Explo (linéaire vrai). Au repos il vaut le mode
  // courant ; pendant une transition il glisse de `_morphFrom` vers `_morphTo` sur MORPH_DURATION_S.
  private _morph = 0;
  private _morphActive = false;
  private _morphFrom = 0;
  private _morphTo = 0;
  private _morphElapsed = 0;

  /** Émis chaque frame pendant la transition avec le facteur de morph courant (0→1) : la couche
   *  app l'utilise pour interpoler la taille visuelle de chaque corps (cf. `setScaleMorph`). */
  onScaleMorph: ((p: number) => void) | null = null;
  /** Masque les lignes pendant une transition vers/depuis l'Exploration. */
  onMorphPhase: ((active: boolean) => void) | null = null;

  constructor(
    private readonly clock: SimulationClock,
    private readonly ephemeris: EphemerisService,
    private readonly elements: OrbitalElementsService,
    private readonly horizons: PreciseEphemerisProvider,
    private readonly config: CelestialConfig,
    private bodies: CelestialBodies
  ) {
    // Une seule passe sur le catalogue, deux responsabilités indépendantes :
    //   1. Résoudre le parent de chaque satellite parentRelative (position relative au parent :
    //      helio(corps) − helio(parent), plus de référentiel terrestre codé en dur).
    //   2. Retenir la période orbitale la plus courte, qui fixe le seuil de throttle (ci-dessous).
    let minPeriodDays = Infinity;
    forEachBody(config, ({ name, config: cfg, parentName }) => {
      const period = cfg.realData?.orbitPeriodDays;
      if (period && period > 0 && period < minPeriodDays)
        minPeriodDays = period;

      if (cfg.frame !== 'parentRelative' || parentName === null) return;
      this._parentName.set(name, parentName);
      const parent = config.bodies[parentName];
      // Réfère le satellite au corps de POSITION du parent (positionBody ?? astroBody) : pour
      // la Lune, le parent Terre pointe sur l'EMB, gardant la Lune à sa vraie position.
      const parentAstro = parent?.positionBody ?? parent?.astroBody;
      if (parentAstro !== undefined)
        this._parentAstroBody.set(name, parentAstro);
    });

    // Seuil de recalcul = fraction d'orbite du corps LE PLUS RAPIDE (période la plus courte).
    // Il gouverne le batch entier : dès qu'il est franchi, on recalcule tous les corps (cohérence
    // mutuelle). Les corps lents sont donc recalculés « en avance », mais leur mouvement propre
    // reste bien sous 0,5° → aucun coût visuel.
    this._minRecomputeThresholdMs = Number.isFinite(minPeriodDays)
      ? minPeriodDays * MS_PER_DAY * OrbitalMechanics._RECOMPUTE_ORBIT_FRACTION
      : OrbitalMechanics._FALLBACK_THRESHOLD_MS;

    // Apres la passe ci-dessus : le resolveur lit les tables de parents qu'elle remplit.
    this._positions = new BodyPositionResolver(
      this.ephemeris,
      this.elements,
      this.horizons,
      this._parentName,
      this._parentAstroBody
    );
    this._paths = new OrbitPathBuilder(
      this._positions,
      this.scale,
      this.config,
      this._parentName
    );
  }

  /**
   * Trajectoire orbitale adaptee au mode courant. Delegue a `OrbitPathBuilder` : tracer une
   * courbe et positionner un corps sont deux questions distinctes (cf. son en-tete).
   */
  computeOrbitPoints(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    nPoints?: number
  ): Float32Array | null {
    return this._paths.computeOrbitPoints(name, cfg, date, nPoints);
  }

  // ============================================================================
  // UPDATE
  // ============================================================================

  update(simDelta: number, realDelta: number = simDelta): void {
    const prevMs = this.clock.date.getTime();
    const isPaused = simDelta === 0;

    if (!isPaused) {
      // Au premier frame après une reprise, on réancre l'horloge sur l'instant présent
      // pour que la date simulée reparte d'où elle était (sans saut en avant).
      if (this._prevPaused) this.clock.setTimeScale(this.clock.timeScale);
      this.clock.syncToRealTime();
    }
    this._prevPaused = isPaused;

    // Delta SIGNÉ : la timebar est bidirectionnelle (timeScale négatif → la date recule),
    // et la rotation propre des corps est une intégrale de ce delta. Prendre la magnitude
    // faisait tourner toutes les planètes vers l'avant pendant que le temps reculait — le
    // sens de rotation restait celui du futur, seule la Terre (phase dérivée de la date,
    // cf. syncEarthSurfaceRotation) repartait à l'envers. Le sens PROPRE d'un corps reste,
    // lui, porté par l'orientation de son axe (rétrogrades retournés, cf. setAxisDirection) :
    // les deux se composent. Un consommateur qui veut une durée (fondu, minuterie) doit
    // prendre |delta| explicitement.
    // Les sauts temporels sont déjà appliqués avant l'échantillon de prevMs ci-dessus.
    this._simDeltaSeconds = isPaused
      ? 0
      : (this.clock.date.getTime() - prevMs) / 1_000;

    // Le morph avance sur le temps réel (realDelta) : il doit se dérouler même en pause.
    this._advanceMorph(realDelta);

    const date = this.clock.date;

    // Throttle du recalcul de positions (cf. champs `_lastPositionMs`). On ne relit
    // l'éphéméride que si la date simulée a assez avancé — SAUF pendant une transition de
    // morph (les positions s'interpolent chaque frame) ou au tout premier passage / après un
    // saut temporel (`_lastPositionMs === null`), où un recalcul immédiat est obligatoire.
    const nowMs = date.getTime();
    const mustRecompute =
      this._morphActive ||
      this._lastPositionMs === null ||
      Math.abs(nowMs - this._lastPositionMs) >= this._minRecomputeThresholdMs;
    if (mustRecompute) {
      this._lastPositionMs = nowMs;
      // L'axe de rotation vieillit comme la position : même cadence, même date.
      this.syncAxesFromEphemeris(date);
      forEachBody(this.config, ({ name, config: cfg }) => {
        if (hasOrbit(cfg)) this._updateBody(name, cfg, date);
      });
    }

    // HORS du throttle, et après lui : la phase de rotation terrestre est la seule grandeur
    // qui doit être exacte À CHAQUE frame. Le throttle ci-dessus ne concerne que les positions
    // orbitales, dont l'imprécision tolérée est bornée à 0,5° d'orbite ; une erreur de phase,
    // elle, se cumulerait sans borne (cf. syncEarthSurfaceRotation).
    this.syncEarthSurfaceRotation(date);
  }

  /** Fait progresser la transition animée et notifie la couche app (taille visuelle). */
  private _advanceMorph(realDelta: number): void {
    if (!this._morphActive) return;
    this._morphElapsed += realDelta;
    const raw = Math.min(this._morphElapsed / MORPH_DURATION_S, 1);
    const eased = easeInOutCubic(raw);
    this._morph = this._morphFrom + (this._morphTo - this._morphFrom) * eased;
    this.onScaleMorph?.(this._morph);

    if (raw >= 1) {
      // Fin de transition : on cale exactement positions et tailles sur le mode cible.
      this._morphActive = false;
      this._morph = this._morphTo;
      this.onScaleMorph?.(this._morph);
      this.onMorphPhase?.(false);
      this.onOrbitsChanged?.();
    }
  }

  /**
   * Position Éducatif (mode compressé) dans `out`. La vraie position astronomy-engine,
   * Horizons ou képlérienne est conservée en direction et sa distance radiale est compressée
   * par √(distanceAU)×SQRT_K. Éduc et Explo restent ainsi synchronisés sur l'horloge et
   * l'excentricité réelle — seule l'échelle radiale change. Renvoie false si la position n'est
   * pas calculable.
   */
  private _computeEducPos(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    out: THREE.Vector3
  ): boolean {
    const posAU = this._positions.resolve(name, cfg, date);
    if (!posAU) return false;
    const distanceAU = posAU.length();
    if (distanceAU < 1e-12) {
      out.set(0, 0, 0);
      return true;
    }
    out
      .copy(posAU)
      .normalize()
      .multiplyScalar(
        Math.sqrt(distanceAU) *
          SQRT_K *
          educationalParentOrbitScale(
            this._parentName?.has(name)
              ? this.config.bodies[this._parentName.get(name)!]
              : undefined
          )
      );
    return true;
  }

  /**
   * Position Explo (vraie échelle) dans `out` : position Kepler réelle depuis astronomy-engine,
   * échelle linéaire (AU × SQRT_K) sans compression √. Pour les corps parentRelative (Lune), la
   * position géocentrique est déjà hors du mesh du parent.
   */
  private _computeExploPos(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    out: THREE.Vector3
  ): void {
    const posAU = this._positions.resolve(name, cfg, date);
    out.copy(posAU ? this.scale.auVectorToScene(posAU) : ZERO);
  }

  private _updateBody(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): void {
    const body = this.bodies[name];
    if (!body) return;

    // Pendant la transition animée : on interpole la position Éduc ↔ Explo par `_morph`.
    // Le lerp gère d'un coup le changement d'échelle radiale ET le morphing cercle→ellipse.
    if (this._morphActive) {
      const hasEduc = this._computeEducPos(name, cfg, date, this._educPos);
      this._computeExploPos(name, cfg, date, this._exploPos);
      if (hasEduc) {
        body.group.position.lerpVectors(
          this._educPos,
          this._exploPos,
          this._morph
        );
      } else {
        body.group.position.copy(this._exploPos);
      }
      return;
    }

    if (this.scale.mode === 'educ') {
      if (this._computeEducPos(name, cfg, date, this._educPos))
        body.group.position.copy(this._educPos);
    } else {
      this._computeExploPos(name, cfg, date, this._exploPos);
      body.group.position.copy(this._exploPos);
    }
  }

  // ============================================================================
  // API PUBLIQUE
  // ============================================================================

  /**
   * Bascule l'échelle Éduc↔Explo.
   *   - `animated = false` (défaut) : bascule instantanée des positions et tailles.
   *   - animated = true : lance la transition — les positions et tailles
   *     glissent de l'échelle courante vers l'échelle cible sur MORPH_DURATION_S.
   * Un appel animé en cours de morph repart de l'état courant (interruptible sans saut).
   */
  setMode(mode: 'educ' | 'explo', animated = false): void {
    if (this.scale.mode === mode && !this._morphActive) return;

    const targetMorph = mode === 'explo' ? 1 : 0;
    // Le mode d'échelle « au repos » passe immédiatement à la cible. Les positions par frame
    // suivent `_morph` tant que la transition animée est active.
    this.scale.mode = mode;

    if (!animated) {
      this._morphActive = false;
      this._morph = targetMorph;
      // L'échelle radiale change (educ √-compressé ↔ explo linéaire) : les positions
      // mémorisées ne sont plus valides → force un recalcul à la prochaine frame.
      this._lastPositionMs = null;
      this.onScaleMorph?.(targetMorph);
      this.onOrbitsChanged?.();
      return;
    }

    this._morphFrom = this._morph;
    this._morphTo = targetMorph;
    this._morphElapsed = 0;
    this._morphActive = true;
    this.onMorphPhase?.(true);
  }

  /**
   * Cale sur l'heure/date donnée ce qui ne se déduit pas de la position orbitale :
   * l'orientation de l'axe de rotation de chaque corps (pôle IAU réel) et la rotation de
   * surface de la Terre sur l'heure UTC. Les angles orbitaux, eux, sont désormais lus
   * directement de l'éphéméride à chaque frame (cf. _updateBody), donc plus rien à ré-ancrer ici.
   */
  syncAnglesFromEphemeris(date: Date): void {
    this.syncAxesFromEphemeris(date);
    this.syncEarthSurfaceRotation(date);
  }

  /**
   * Oriente l'axe de rotation de chaque corps sur son vrai pôle IAU (obliquité + azimut réels).
   *
   * Ré-appelé sur la MÊME cadence que le recalcul des positions, et pas seulement aux sauts
   * temporels comme avant. L'orientation de l'axe est elle aussi un ancrage : figée, elle
   * vieillit dès que la date avance vite. Mesuré à 1 an/s (?debug-solar) : 0,15° d'erreur de
   * latitude subsolaire après ~58 ans simulés, en croissance continue. Ce n'est pas cosmétique
   * — une erreur d'axe fait PIVOTER le terminateur autour du point sous-observateur, donc les
   * lumières de ville prennent de l'avance à un bout et du retard à l'autre, sans la moindre
   * erreur de longitude. Coût mesuré : ~0,4 µs par corps, contre un `HelioVector` complet déjà
   * payé par corps au même moment.
   */
  syncAxesFromEphemeris(date: Date): void {
    forEachBody(this.config, ({ name, config: cfg }) => {
      if (!hasOrbit(cfg)) return;
      const body = this.bodies[name];
      const rotationBody = cfg.rotationBody ?? cfg.astroBody;
      if (!body || rotationBody === undefined) return;

      // Axe = moment cinétique de SPIN du corps qui fournit le pôle, pas son pôle nord
      // cartographique : c'est autour de lui que `+rotationSpeed` tourne dans le bon sens.
      //
      // La règle précédente déduisait le retournement rétrograde de l'obliquité DU CORPS
      // ORIENTÉ (> 90°). Elle se trompait doublement. D'abord pour un satellite, qui
      // emprunte le pôle de sa planète (`rotationBody`) mais dont l'obliquité catalogue est
      // mesurée sur SON orbite, donc ≈ 0 : les cinq lunes d'Uranus recevaient le pôle nord
      // IAU d'Uranus sans le retournement qu'Uranus, lui, recevait — elles tournaient donc à
      // l'inverse de leur planète alors qu'elles lui sont verrouillées par effet de marée.
      // Ensuite parce que « obliquité > 90° » n'est pas le critère du sens : il vaut pour
      // les planètes, pas pour les planètes naines, qui ne suivent pas la même convention de
      // pôle dans WGCCRE 2015 (cf. `getSpinAxisDirection`, qui lit le sens à sa source).
      body.setAxisDirection(
        this.ephemeris.getSpinAxisDirection(rotationBody, date)
      );
    });
  }

  /**
   * Aligne la rotation de surface de la Terre sur le Soleil apparent : le point subsolaire
   * doit tomber sur sa VRAIE longitude géographique (RA apparente du Soleil - GAST).
   *
   * Appelé À CHAQUE FRAME, et c'est le point important. La phase était auparavant ancrée ici
   * puis laissée s'intégrer toute seule dans `CelestialObject.update` — un cumul qui perdait
   * silencieusement tout le temps passé hors du frustum, en pause, ou pendant une éclipse de
   * rendu, sans jamais se rattraper. Mesuré au démarrage (?debug-solar) : 0,68° puis 2,35°
   * d'erreur de longitude selon la durée, soit exactement le temps simulé écoulé sans
   * intégration. Une phase DÉRIVÉE de la date ne peut pas dériver : il n'y a plus d'état à
   * désynchroniser. Coût mesuré : ~3,3 µs/frame (un `Equator` + un `SiderealTime`), 0,02 %
   * d'une frame à 60 fps.
   *
   * L'azimut du Soleil est mesuré dans le repère où la Terre TOURNE (le _tiltGroup, aligné
   * sur le pôle IAU réel), pas dans celui de la scène. Le plan XZ de la scène est
   * l'ÉCLIPTIQUE, alors que la longitude subsolaire est ÉQUATORIALE : les composer
   * directement laissait exactement l'écart RA - λ, le terme d'obliquité de l'équation du
   * temps. Mesuré avant correction (?debug-solar) : ±2.4°, nul aux équinoxes ET aux
   * solstices, extrême entre les deux. Le terminateur, lui, restait juste — il ne dépend
   * que de dot(normale, Soleil) — d'où des continents et des lumières de ville décalés par
   * rapport à l'ombre, en avance sur un limbe et en retard sur l'autre.
   */
  syncEarthSurfaceRotation(date: Date): void {
    const earthBody = this.bodies['earth'];
    if (!earthBody?.group) return;

    // Direction Terre->Soleil lue sur la position RENDUE, pas sur un recalcul d'éphéméride :
    // c'est elle qui produit le terminateur qu'on voit, donc la seule sur laquelle caler la
    // longitude subsolaire. Elle est aussi gratuite, là où `BodyPositionResolver.resolve` est le calcul lourd
    // que tout le reste de cette classe s'applique à throttler. Les deux coïncident de toute
    // façon : la position éduc est un pur redimensionnement RADIAL de la position vraie
    // (cf. _computeEducPos), donc de même direction, et le morph éduc↔explo interpole entre
    // deux vecteurs colinéaires.
    // Soleil à l'origine de la scène : direction Terre->Soleil = -position de la Terre.
    earthBody.group.getWorldPosition(_tmpSunDirection);
    if (_tmpSunDirection.lengthSq() < 1e-24) return;
    const sunDirection = _tmpSunDirection
      .negate()
      .normalize()
      .applyQuaternion(
        earthBody.getTiltQuaternion(_tmpTiltQuaternion).invert()
      );

    earthBody.setSurfaceRotation(
      surfaceRotationForSubsolarLongitude(
        sunDirection,
        computeGreenwichSubsolarLongitude(date)
      )
    );
  }

  /**
   * À appeler après tout saut temporel. Re-synchronise IMPÉRATIVEMENT :
   *   - les angles orbitaux éducatifs (sinon les planètes restent figées au scrubbing) ;
   *   - la rotation de surface de la Terre sur l'heure UTC (sinon le jour/nuit ne suit pas).
   */
  private _afterTimeTravel(): void {
    // Force un recalcul de position à la prochaine frame : la date a sauté, les positions
    // mémorisées sont obsolètes (sinon les corps resteraient figés jusqu'au prochain seuil).
    this._lastPositionMs = null;
    this.syncAnglesFromEphemeris(this.clock.date);
    this.onOrbitsChanged?.();
  }

  addTimeOffset(days: number): void {
    this.clock.addDays(days);
    this._afterTimeTravel();
  }

  addTimeOffsetHours(hours: number): void {
    this.clock.addHours(hours);
    this._afterTimeTravel();
  }

  /** Saute à une date absolue (delta calculé depuis la date simulée courante). */
  jumpToDate(target: Date): void {
    this.addTimeOffset(
      (target.getTime() - this.simulationDate.getTime()) / 86_400_000
    );
  }

  setSimulationSpeed(scale: number): void {
    this.clock.setTimeScale(scale);
  }

  resetTimeOffset(): void {
    this.clock.resetOffset();
    this._lastPositionMs = null;
    this.syncAnglesFromEphemeris(this.clock.date);
    this.onOrbitsChanged?.();
  }

  /**
   * Atténuation d'éclipse Terre-Lune-Soleil calculée sur la **vraie** géométrie
   * (positions et rayons réels en AU via l'éphéméride), indépendamment de
   * l'échelle d'affichage compressée du mode educ. Sert à rendre visible
   * l'éclipse solaire (Lune devant le Soleil, ombre sur la Terre) et l'éclipse
   * lunaire (Lune dans l'ombre de la Terre) même en educ, où les positions de la
   * scène sont sur des cercles √-compressés inexploitables pour l'occultation.
   * Limité à ce seul triplet : les orbites educ sont trop plates/rapprochées pour
   * un calcul d'éclipse fiable sur les autres corps (fausses éclipses partout).
   */
  getEarthMoonEclipse(): { earth: number; moon: number } {
    const date = this.clock.date;
    const sunPos = new THREE.Vector3(0, 0, 0); // Soleil à l'origine héliocentrique.
    const earthPos = this.ephemeris.getHeliocentricAU(Body.Earth, date);
    const moonPos = this.ephemeris.getHeliocentricAU(Body.Moon, date);

    const sunRadiusAU = 696_000 / KM_PER_AU;
    const earthRadiusAU = 6_371 / KM_PER_AU;
    const moonRadiusAU = 1_737 / KM_PER_AU;

    // Éclipse solaire vue de la Terre : la Lune occulte le Soleil.
    const earth = computeLightAttenuation(earthPos, sunPos, sunRadiusAU, [
      { position: moonPos, radius: moonRadiusAU },
    ]);
    // Éclipse lunaire : la Lune entre dans l'ombre projetée par la Terre.
    const moon = computeLightAttenuation(moonPos, sunPos, sunRadiusAU, [
      { position: earthPos, radius: earthRadiusAU },
    ]);
    return { earth, moon };
  }

  get scaleMode(): 'educ' | 'explo' {
    return this.scale.mode;
  }
  get simulationDate(): Date {
    return this.clock.date;
  }
  get offsetDays(): number {
    return this.clock.offsetDays;
  }
  get simulationTimeScale(): number {
    return this.clock.timeScale;
  }
  get simDeltaSeconds(): number {
    return this._simDeltaSeconds;
  }
}
