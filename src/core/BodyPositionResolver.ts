import * as THREE from 'three';
import type { Body } from 'astronomy-engine';
import type { CelestialBodyConfig } from '@/types';
import type { EphemerisService } from './EphemerisService';
import type { OrbitalElementsService } from './OrbitalElementsService';
import {
  FallbackPreciseEphemerisProvider,
  type PreciseEphemerisProvider,
} from './PreciseEphemerisProvider';
import type { PositionSource } from './positionProvenance';
import {
  isPlausibleHeliocentricPosition,
  isPlausibleRelativePosition,
} from './ephemerisPlausibility';

/**
 * D'OÙ vient la position d'un corps — la seule autorité sur cette question.
 *
 * Quatre défauts livrés se sont logés dans cet ordre de priorité sans produire ni erreur ni
 * log : une position fausse reste une position. Le contrat complet est écrit dans
 * `docs/ARCHITECTURE.md` § « Position d'un corps » ; ce module en est la seule implémentation.
 *
 * Il est séparé d'`OrbitalMechanics` pour une raison précise : cette dernière décide QUAND
 * recalculer, à quelle échelle afficher et comment animer une transition — trois questions qui
 * n'ont rien à voir avec « quelle source fait autorité pour ce corps à cette date ». Les
 * mélanger rendait la règle de priorité testable seulement à travers une classe de 900 lignes
 * tirant une horloge, un catalogue et une scène.
 *
 * Trois sorties distinctes, et la distinction compte :
 *   - `precise()`   — la source numérique seule (binaire Horizons/SPK), `null` hors couverture.
 *   - `elements()`  — les éléments képlériens seuls, de couverture INFINIE.
 *   - `resolve()`   — la règle de production : précis d'abord, repli ensuite.
 *   - `resolveSource()` — QUI a répondu à `resolve()` pour ce corps à cette date, par la même
 *     règle exécutée une seule fois (`_resolve`), pour la provenance affichée : un binaire
 *     Horizons et un repli képlérien ne disent pas la même chose d'une date.
 *
 * Exposer les deux premières n'est pas une commodité de test : tracer une orbite entière exige
 * de savoir si la source précise couvre toute la courbe, sous peine d'épisser deux trajectoires
 * qui ne coïncident pas (défaut réel, 20° de saut sur Haumea).
 */
export class BodyPositionResolver {
  constructor(
    private readonly ephemeris: EphemerisService,
    private readonly elements: OrbitalElementsService,
    private readonly horizons: PreciseEphemerisProvider,
    /** Nom du parent de chaque satellite `parentRelative`. */
    private readonly parentName: ReadonlyMap<string, string>,
    /** Corps astronomy-engine du parent, quand il en a un. */
    private readonly parentAstroBody: ReadonlyMap<string, Body>
  ) {}

  /**
   * Position issue de la source PRÉCISE (binaire Horizons / SPK) uniquement, ou `null` si elle
   * ne couvre pas ce corps à cette date, ou si sa réponse échoue au test de plausibilité.
   *
   * Un corps imbriqué doit rester dans le repère local de son parent : la branche
   * `parentRelative` précède donc toute lecture héliocentrique. Un fichier SPK peut aussi
   * exposer la position lune→Soleil, mais l'utiliser sous le groupe Terre/Jupiter appliquerait
   * le parent deux fois et fausserait distance, position et ligne d'orbite dans les deux modes.
   */
  precise(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): THREE.Vector3 | null {
    if (cfg.frame === 'parentRelative') {
      const parent = this.parentName.get(name);
      const relative = parent
        ? this.horizons.getParentRelativeAU(name, parent, date)
        : null;
      return relative && isPlausibleRelativePosition(relative, cfg)
        ? relative
        : null;
    }
    const helio = this.horizons.getHeliocentricAU(name, date);
    return helio && isPlausibleHeliocentricPosition(helio, cfg) ? helio : null;
  }

  /**
   * Position issue des ÉLÉMENTS KÉPLÉRIENS du catalogue uniquement, ou `null` si le corps n'en
   * a pas. C'est la seule source de couverture infinie : elle vaut à n'importe quelle date, là
   * où un binaire s'arrête.
   *
   * `frameDate` : date à laquelle prendre le barycentre pour des éléments barycentriques
   * (cf. `OrbitalElementsService.getHeliocentricAU`) — la date affichée pour une ligne.
   */
  elementsOnly(
    cfg: CelestialBodyConfig,
    date: Date,
    frameDate: Date = date
  ): THREE.Vector3 | null {
    if (cfg.relativeOrbitalElements) {
      // Le corps central est la PLANÈTE, pas le Soleil : on fournit la période publiée du
      // catalogue, faute de quoi le mouvement moyen serait déduit du μ solaire (cf.
      // `OrbitalElements.periodDays`). Une entrée qui porte déjà sa propre période garde la main.
      return this.elements.getHeliocentricAU(
        {
          periodDays: cfg.realData?.orbitPeriodDays,
          ...cfg.relativeOrbitalElements,
        },
        date
      );
    }
    if (cfg.orbitalElements) {
      return this.elements.getHeliocentricAU(
        cfg.orbitalElements,
        date,
        frameDate
      );
    }
    return null;
  }

  /**
   * La règle de PRODUCTION : source précise si elle couvre, sinon repli, dans l'ordre décrit
   * par `docs/ARCHITECTURE.md`. `null` si aucune source ne sait positionner ce corps.
   */
  resolve(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): THREE.Vector3 | null {
    return this._resolve(name, cfg, date, null);
  }

  /**
   * La source qui a produit `resolve(name, cfg, date)`, ou `null` si aucune ne sait placer ce
   * corps. Recalcule la position : réservé à la provenance affichée (un corps, à la cadence
   * de l'interface), jamais à la boucle de rendu.
   */
  resolveSource(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): PositionSource | null {
    const out: { source: PositionSource | null } = { source: null };
    return this._resolve(name, cfg, date, out) ? out.source : null;
  }

  /** Nom de la source précise qui répond : le primaire d'un composite s'il couvre. */
  private _preciseSource(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): PositionSource {
    const provider = this.horizons;
    const answering =
      provider instanceof FallbackPreciseEphemerisProvider
        ? provider.answering(
            name,
            cfg.frame === 'parentRelative'
              ? (this.parentName.get(name) ?? null)
              : null,
            date
          )
        : provider;
    return answering?.source ?? 'horizons';
  }

  /**
   * LA règle, une seule fois. `out` reçoit la source quand l'appelant la demande ; `null` dans
   * la boucle de rendu, qui n'alloue rien.
   */
  private _resolve(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    out: { source: PositionSource | null } | null
  ): THREE.Vector3 | null {
    const precise = this.precise(name, cfg, date);
    if (precise) {
      if (out) out.source = this._preciseSource(name, cfg, date);
      return precise;
    }

    if (out) out.source = 'astronomy-engine';
    if (cfg.relativeEphemeris?.kind === 'jupiterMoon') {
      // astronomy-engine fournit directement les vecteurs relatifs aux lunes galiléennes.
      return this.ephemeris.getJupiterMoonRelativeAU(
        cfg.relativeEphemeris.moon,
        date
      );
    }

    if (cfg.astroBody !== undefined) {
      if (cfg.frame === 'parentRelative') {
        const parentBody = this.parentAstroBody.get(name);
        // Parent sans éphéméride → pas de position relative calculable.
        if (parentBody === undefined) return null;
        return this.ephemeris.getParentRelativeAU(
          cfg.astroBody,
          parentBody,
          date
        );
      }
      return this.ephemeris.getHeliocentricAU(
        cfg.positionBody ?? cfg.astroBody,
        date
      );
    }

    if (out) out.source = 'kepler';
    return this.elementsOnly(cfg, date);
  }
}
