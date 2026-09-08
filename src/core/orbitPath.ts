import * as THREE from 'three';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import type { BodyPositionResolver } from './BodyPositionResolver';
import type { ScaleService } from './ScaleService';
import { SQRT_K } from './ScaleService';
import { solveKepler } from './kepler';
import { educationalParentOrbitScale } from './educationalScale';

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

/** Excentricite a partir de laquelle la ligne est echantillonnee en anomalie excentrique. */
const ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY = 0.2;

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
    periodDays: number
  ): boolean {
    if (!cfg.orbitalElements && !cfg.relativeOrbitalElements) return false;
    for (const phase of [-0.5, 0.5]) {
      const at = this.orbitSampleDate(cfg, date, phase, periodDays);
      if (this.positions.precise(name, cfg, at) === null) return true;
    }
    return false;
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
    cfg: CelestialBodyConfig,
    date: Date,
    phase: number,
    periodDays: number
  ): Date {
    const uniform = new Date(date.getTime() + phase * periodDays * MS_PER_DAY);
    const elements = cfg.orbitalElements ?? cfg.relativeOrbitalElements;
    const eccentricity = elements?.eccentricity ?? 0;
    if (!elements || eccentricity < ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY) {
      return uniform;
    }

    // Anomalies a la date courante, sur les elements eux-memes.
    const meanMotion = (2 * Math.PI) / periodDays;
    const daysSinceEpoch =
      (date.getTime() - elements.epoch.getTime()) / MS_PER_DAY;
    const meanNow =
      elements.meanAnomalyAtEpochRad + meanMotion * daysSinceEpoch;
    const eccentricNow = solveKepler(meanNow, eccentricity);

    // Un tour complet d'anomalie excentrique centre sur la position courante : la couture
    // reste a l'oppose du corps affiche, et phase = 0 retombe exactement sur lui.
    const eccentric = eccentricNow + 2 * Math.PI * phase;
    const mean = eccentric - eccentricity * Math.sin(eccentric);
    return new Date(
      date.getTime() + ((mean - meanNow) / meanMotion) * MS_PER_DAY
    );
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
      const elementsOnly = this.needsElementsOnly(
        _name,
        cfg,
        _date,
        periodDays
      );

      // Center the sampled period on the current date. The seam is then opposite
      // the currently displayed body instead of moving through it as time advances.
      for (let i = 0; i < nPoints; i++) {
        const phase = i / nPoints - 0.5;
        const sampleDate = this.orbitSampleDate(cfg, _date, phase, periodDays);
        const point = elementsOnly
          ? this.positions.elementsOnly(cfg, sampleDate)
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
    const elementsOnly = this.needsElementsOnly(_name, cfg, _date, periodDays);
    for (let i = 0; i < nPoints; i++) {
      const phase = i / nPoints - 0.5;
      const sampleDate = this.orbitSampleDate(cfg, _date, phase, periodDays);
      const pointAU = elementsOnly
        ? this.positions.elementsOnly(cfg, sampleDate)
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
