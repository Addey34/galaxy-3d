import * as THREE from 'three';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import type { BodyPositionResolver } from './BodyPositionResolver';
import type { ScaleService } from './ScaleService';
import { SQRT_K } from './ScaleService';
import { solveKepler } from './kepler';
import { educationalParentOrbitScale } from './educationalScale';
import {
  MU_SUN_AU3_PER_DAY2,
  osculatingOrbitPoints,
} from './twoBodyPropagation';

/**
 * TRACE d'une ligne d'orbite — une polyligne fermee, distincte de la POSITION d'un corps.
 *
 * La distinction porte tout ce module. Positionner un corps demande la meilleure source a
 * une date ; tracer sa courbe demande une source HOMOGENE sur une periode entiere et des
 * points repartis la ou la courbe tourne. Confondre les deux a produit deux defauts livres :
 *
 *   - une ligne echantillonnee uniformement dans le TEMPS laisse le periastre presque vide
 *     (deuxieme loi de Kepler) : Halley montrait une corde droite de 130 deg en travers de
 *     son perihelie et n'atteignait jamais sa distance minimale ;
 *   - une ligne qui change de source en cours de courbe episse deux trajectoires qui ne
 *     coincident pas : 20 deg de saut sur Haumea, au franchissement de la couverture du
 *     binaire.
 *
 * Contrat complet dans `docs/ARCHITECTURE.md` § « Position d'un corps ».
 */

export const ORBIT_SAMPLE_COUNT = 512;
export const EXPLO_ORBIT_SAMPLE_COUNT = 4096;

const MS_PER_DAY = 86_400_000;

/**
 * Demi-intervalle (jours) de la différence centrée qui estime la vitesse d'un corps depuis sa
 * source précise, pour tracer sa conique osculatrice. Assez court pour Halley au périhélie
 * (0,054 rad/jour : erreur relative de vitesse ~(0,1 × 0,054)² / 6 ≈ 5e-6).
 */
const OSCULATING_VELOCITY_STEP_DAYS = 0.1;

/** Excentricite a partir de laquelle la ligne est echantillonnee en anomalie excentrique. */
export const ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY = 0.2;

/**
 * L'orbite qui décide OÙ tombent les points d'une ligne (cf. `orbitSampleDate`) : excentricité,
 * anomalie excentrique à la date affichée, mouvement moyen (rad/jour). `null` = temps uniforme.
 */
interface SamplingAnomaly {
  eccentricity: number;
  eccentricNow: number;
  meanMotion: number;
}

/** Position et vitesse (UA, UA/jour) d'un corps, tirées de sa source précise. */
interface PreciseState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

export class OrbitPathBuilder {
  constructor(
    private readonly positions: BodyPositionResolver,
    private readonly scale: ScaleService,
    private readonly config: CelestialConfig,
    /** Nom du parent de chaque satellite, pour l'echelle educative imbriquee. */
    private readonly parentName: ReadonlyMap<string, string>
  ) {}

  /**
   * Une ligne d'orbite doit venir d'UNE SEULE source — sinon elle épisse deux trajectoires
   * qui ne coïncident pas, et le raccord se voit.
   *
   * Le cas se produit dès qu'une période dépasse la couverture du binaire : les fichiers
   * livrés couvrent 201 ans, or Pluton (248 ans), Hauméa (284), Makémaké (309) et Éris (558)
   * font davantage. Tracer un tour complet sortait donc forcément de la couverture, la
   * position basculait sur les éléments képlériens en cours de courbe, et l'écart entre les
   * deux sources apparaissait comme un coude. Mesuré sur Hauméa : **20° de saut** entre deux
   * points consécutifs, pile au franchissement (2101-02-12, couverture close le 2101-01-03).
   *
   * On sonde donc les deux extrémités de la courbe : si la source précise n'y répond pas et
   * que le corps possède des éléments, on trace TOUT depuis les éléments. La courbe perd un
   * peu de précision absolue et gagne d'être continue et fermée — ce qu'on attend d'un tracé.
   * La position du CORPS, elle, continue d'utiliser la meilleure source disponible : seul le
   * tracé est homogénéisé.
   */
  private needsElementsOnly(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    periodDays: number,
    anomaly: SamplingAnomaly | null
  ): boolean {
    if (!cfg.orbitalElements && !cfg.relativeOrbitalElements) return false;
    for (const phase of [-0.5, 0.5]) {
      const at = this.orbitSampleDate(date, phase, periodDays, anomaly);
      if (this.positions.precise(name, cfg, at) === null) return true;
    }
    return false;
  }

  /**
   * État d'un corps HÉLIOCENTRIQUE à la date, par sa source précise : la position, et la vitesse
   * par différence centrée. `null` pour un satellite, ou si la source ne répond pas.
   */
  private preciseState(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): PreciseState | null {
    if (cfg.frame === 'parentRelative') return null;
    const stepMs = OSCULATING_VELOCITY_STEP_DAYS * MS_PER_DAY;
    const position = this.positions.precise(name, cfg, date);
    const before = this.positions.precise(
      name,
      cfg,
      new Date(date.getTime() - stepMs)
    );
    const after = this.positions.precise(
      name,
      cfg,
      new Date(date.getTime() + stepMs)
    );
    if (!position || !before || !after) return null;
    const velocity = after
      .clone()
      .sub(before)
      .divideScalar(2 * OSCULATING_VELOCITY_STEP_DAYS);
    return { position, velocity };
  }

  /**
   * L'orbite qui répartit les points : celle des ÉLÉMENTS pour une ligne tirée des éléments,
   * celle de l'ÉTAT osculateur pour une ligne tirée de la source précise d'un corps
   * héliocentrique. Ce n'est pas un détail : les points se resserrent là où cette orbite place
   * le périhélie, et si ce n'est pas là que la source le place, la courbe s'y ouvre. Mesuré au
   * lot 11 sur Halley en Éducatif (512 points), ligne tirée de son binaire mais répartie par
   * ses éléments : 24° de trou au périhélie de 2061.
   */
  private samplingAnomaly(
    cfg: CelestialBodyConfig,
    date: Date,
    periodDays: number,
    state: PreciseState | null
  ): SamplingAnomaly | null {
    const elements = cfg.orbitalElements ?? cfg.relativeOrbitalElements;
    if (!elements || elements.eccentricity < ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY)
      return null;

    if (state) {
      const { position, velocity } = state;
      const mu = MU_SUN_AU3_PER_DAY2;
      const r = position.length();
      const energy = velocity.lengthSq() / 2 - mu / r;
      if (energy < 0) {
        const a = -mu / (2 * energy);
        const eSinE = position.dot(velocity) / Math.sqrt(mu * a);
        const eCosE = 1 - r / a;
        const eccentricity = Math.hypot(eCosE, eSinE);
        if (eccentricity < 1)
          return {
            eccentricity,
            eccentricNow: Math.atan2(eSinE, eCosE),
            meanMotion: Math.sqrt(mu / (a * a * a)),
          };
      }
    }

    // Anomalies a la date courante, sur les elements eux-memes.
    const meanMotion = (2 * Math.PI) / periodDays;
    const daysSinceEpoch =
      (date.getTime() - elements.epoch.getTime()) / MS_PER_DAY;
    return {
      eccentricity: elements.eccentricity,
      eccentricNow: solveKepler(
        elements.meanAnomalyAtEpochRad + meanMotion * daysSinceEpoch,
        elements.eccentricity
      ),
      meanMotion,
    };
  }

  /**
   * Ligne tirée de la conique OSCULATRICE de la source précise à la date affichée, quand
   * `needsElementsOnly` écarte la source précise pour le tracé mais qu'elle répond pour le corps.
   *
   * Sans elle, le corps (placé par son binaire) et sa ligne (tracée depuis les éléments) ne
   * viennent plus de la même source, et l'écart entre les deux devient l'écart entre le corps et
   * sa propre orbite. Mesuré au lot 11, quand Halley a reçu son binaire : jusqu'à 1,5e8 km de
   * 1900 à 1938 et de 2063 à 2100, là où ses 76 ans ne tiennent plus dans les 201 ans du
   * fichier ; 7e5 à 3e6 km pour les astéroïdes pendant leur première et leur dernière
   * demi-période, Cérès comprise, dont le binaire est plus ancien que ce lot. La conique osculatrice passe exactement par le corps, reste une seule courbe
   * fermée, et s'écarte de la trajectoire réelle d'autant moins qu'on est près du corps.
   *
   * Pas pour des éléments BARYCENTRIQUES (les objets transneptuniens) : leur état héliocentrique
   * porte le ballant du Soleil autour du barycentre, et sa conique osculatrice n'a pas la forme
   * de leur orbite. Leurs éléments, eux, s'en écartent de 2,4e6 km au plus (Quaoar en 1900, à
   * 43 UA : 0,02°). Ni pour un satellite, dont la ligne suit d'autres règles.
   */
  private osculatingLine(
    cfg: CelestialBodyConfig,
    state: PreciseState | null,
    count: number
  ): THREE.Vector3[] | null {
    if (!state || !cfg.orbitalElements || cfg.orbitalElements.barycentric)
      return null;
    return osculatingOrbitPoints(
      state.position,
      state.velocity,
      MU_SUN_AU3_PER_DAY2,
      count
    );
  }

  /**
   * Fraction d'orbite [-0,5 ; 0,5[ -> date d'echantillonnage de la ligne d'orbite.
   *
   * Un echantillonnage uniforme dans le TEMPS place les points la ou le corps passe son
   * temps, ce qui est exactement le contraire de ce qu'il faut pour dessiner une courbe :
   * la deuxieme loi de Kepler concentre presque toute la periode pres de l'aphelie. Mesure
   * sur Halley (e = 0,967), 512 points sur 76 ans : deux points consecutifs s'ecartaient de
   * 130 deg, une corde droite traversait toute la region du perihelie, et la ligne
   * n'atteignait meme jamais sa distance minimale (rapport des rayons rendu 6,7 pour 7,8
   * attendu). Le bout pointu de l'ellipse etait litteralement coupe. Meme defaut en Explo,
   * seulement attenue par ses 4096 points (20,7 deg d'ecart au lieu de 130).
   *
   * On repartit donc les points uniformement en ANOMALIE EXCENTRIQUE E, dont la longueur
   * d'arc |d(pos)/dE| = a*sqrt(1 - e^2 cos^2 E) ne varie plus que d'un facteur a/b entre
   * l'apside et le quadrant, contre un facteur illimite pour le temps. La conversion vers
   * la date se fait par l'equation de Kepler M = E - e sin E, exacte, donc les points
   * restent sur la vraie trajectoire : on ne change QUE la repartition, jamais la courbe.
   *
   * Seuil a 0,2 : en dessous, la reparation ne se voit pas et le temps uniforme evite de
   * dependre de la phase des elements pour un corps dont la position vient d'ailleurs
   * (fichier Horizons). Au-dessus, l'excentricite est justement ce qu'on veut montrer.
   */
  private orbitSampleDate(
    date: Date,
    phase: number,
    periodDays: number,
    anomaly: SamplingAnomaly | null
  ): Date {
    if (!anomaly)
      return new Date(date.getTime() + phase * periodDays * MS_PER_DAY);
    const { eccentricity, eccentricNow, meanMotion } = anomaly;
    // L'anomalie moyenne courante est RECALCULÉE depuis l'anomalie excentrique, et non reprise
    // des éléments : `solveKepler` ramène M dans [-π ; π], donc la valeur brute, qui compte les
    // tours depuis l'époque, n'est pas sur le même tour que `eccentricNow`. Leur différence
    // décalait chaque date de la ligne d'un nombre ENTIER de périodes : invisible tant que la
    // ligne venait des éléments (même ellipse à chaque tour), faux dès qu'elle vient d'une
    // éphéméride. Mesuré au lot 11 : pour Halley en 2026, « phase = 0 » tombait en 1950 et la
    // ligne, tracée sur la révolution précédente, passait à 2e7 km du corps.
    const meanNow = eccentricNow - eccentricity * Math.sin(eccentricNow);

    // Un tour complet d'anomalie excentrique centre sur la position courante : la couture
    // reste a l'oppose du corps affiche, et phase = 0 retombe exactement sur lui.
    const eccentric = eccentricNow + 2 * Math.PI * phase;
    const mean = eccentric - eccentricity * Math.sin(eccentric);
    return new Date(
      date.getTime() + ((mean - meanNow) / meanMotion) * MS_PER_DAY
    );
  }

  /**
   * D'où vient la ligne, décidé une fois pour toute la courbe : la source précise (répartie par
   * l'orbite osculatrice de son état), sa conique osculatrice (la source répond à la date mais
   * pas sur toute la période), ou les éléments (répartis par eux-mêmes).
   */
  private lineSource(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    periodDays: number,
    count: number
  ): {
    elementsOnly: boolean;
    osculating: THREE.Vector3[] | null;
    anomaly: SamplingAnomaly | null;
  } {
    const state = this.preciseState(name, cfg, date);
    const preciseAnomaly = this.samplingAnomaly(cfg, date, periodDays, state);
    const elementsOnly = this.needsElementsOnly(
      name,
      cfg,
      date,
      periodDays,
      preciseAnomaly
    );
    if (!elementsOnly)
      return { elementsOnly, osculating: null, anomaly: preciseAnomaly };
    return {
      elementsOnly,
      osculating: this.osculatingLine(cfg, state, count),
      anomaly: this.samplingAnomaly(cfg, date, periodDays, null),
    };
  }

  /** Calcule la trajectoire orbitale adaptée au mode courant. */
  computeOrbitPoints(
    _name: string,
    cfg: CelestialBodyConfig,
    _date: Date,
    nPoints = this.scale.mode === 'explo'
      ? EXPLO_ORBIT_SAMPLE_COUNT
      : ORBIT_SAMPLE_COUNT
  ): Float32Array | null {
    if (this.scale.mode === 'explo') {
      const periodDays = cfg.realData?.orbitPeriodDays;
      if (!periodDays || periodDays <= 0) return null;

      const points = new Float32Array((nPoints + 1) * 3);
      const first = this.positions.resolve(_name, cfg, _date);
      if (!first) return null;
      const { elementsOnly, osculating, anomaly } = this.lineSource(
        _name,
        cfg,
        _date,
        periodDays,
        nPoints
      );

      // Center the sampled period on the current date. The seam is then opposite
      // the currently displayed body instead of moving through it as time advances.
      for (let i = 0; i < nPoints; i++) {
        const phase = i / nPoints - 0.5;
        const sampleDate = this.orbitSampleDate(
          _date,
          phase,
          periodDays,
          anomaly
        );
        const point = osculating
          ? osculating[i]!
          : elementsOnly
            ? this.positions.elementsOnly(cfg, sampleDate, _date)
            : this.positions.resolve(_name, cfg, sampleDate);
        if (!point) return null;
        const i3 = i * 3;
        points[i3] = point.x * SQRT_K;
        points[i3 + 1] = point.y * SQRT_K;
        points[i3 + 2] = point.z * SQRT_K;
      }

      // Ferme exactement la courbe : les perturbations peuvent empêcher
      // la position à date + période de rejoindre le premier échantillon.
      points.set(points.subarray(0, 3), nPoints * 3);
      return points;
    }
    const periodDays = cfg.realData?.orbitPeriodDays;
    if (!periodDays || periodDays <= 0) return null;
    const points = new Float32Array((nPoints + 1) * 3);
    const { elementsOnly, osculating, anomaly } = this.lineSource(
      _name,
      cfg,
      _date,
      periodDays,
      nPoints
    );
    for (let i = 0; i < nPoints; i++) {
      const phase = i / nPoints - 0.5;
      const sampleDate = this.orbitSampleDate(
        _date,
        phase,
        periodDays,
        anomaly
      );
      const pointAU = osculating
        ? osculating[i]!
        : elementsOnly
          ? this.positions.elementsOnly(cfg, sampleDate, _date)
          : this.positions.resolve(_name, cfg, sampleDate);
      if (!pointAU) return null;
      const parentName = this.parentName.get(_name);
      const parentScale = educationalParentOrbitScale(
        parentName ? this.config.bodies[parentName] : undefined
      );
      const scaledRadius = Math.sqrt(pointAU.length()) * SQRT_K * parentScale;
      const point = pointAU.normalize().multiplyScalar(scaledRadius);
      const i3 = i * 3;
      points[i3] = point.x;
      points[i3 + 1] = point.y;
      points[i3 + 2] = point.z;
    }
    points.set(points.subarray(0, 3), nPoints * 3);
    return points;
  }
}
