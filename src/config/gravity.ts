/**
 * Paramètre gravitationnel à utiliser pour propager CHAQUE corps du catalogue.
 *
 * Table d'entrée du service Horizons : elle lui dit autour de quelle masse propager un
 * corps, sans qu'il ait à connaître le catalogue. Elle sert à interpoler par la dynamique
 * plutôt que par une cubique quand un satellite tourne plus vite que le pas
 * d'échantillonnage de son fichier (cf. `HorizonsEphemerisService`).
 *
 * Une seule source pour les masses : `realData.massKg`, celle qu'affiche déjà la fiche
 * d'information. Ajouter une lune ne demande donc aucune donnée nouvelle.
 */
import { CELESTIAL_CONFIG } from './bodies';
import {
  gravitationalParameter,
  MU_SUN_AU3_PER_DAY2,
} from '@/core/twoBodyPropagation';
import type { CelestialConfig } from '@/types';

/** Ce qu'il faut savoir d'un corps pour propager son mouvement le long de sa conique. */
export interface BodyDynamics {
  /** Paramètre gravitationnel gouvernant son mouvement (UA³/jour²). */
  mu: number;
  /**
   * Période de révolution publiée (jours), quand le catalogue la connaît.
   *
   * C'est la période CATALOGUE qui sert de critère, jamais la période osculatrice lue sur
   * l'état courant : pour un corps dont le mouvement n'est pas à deux corps, cette dernière
   * est erratique. Mesuré sur Styx, dont l'orbite réelle autour du barycentre
   * Pluton-Charon donne une période osculatrice de 44,8 jours autour du CENTRE de Pluton
   * là où sa période vraie est de 20,2 jours — et qui varie d'un échantillon au suivant,
   * faisant basculer le choix d'interpolation en cours de trajectoire.
   */
  periodDays?: number;
  /**
   * Propager entre deux échantillons au rythme de la période MOYENNE plutôt qu'osculatrice
   * (cf. `HorizonsEphemerisService._meanMotionScale`). Déclaré corps par corps dans
   * `MEAN_MOTION_PROPAGATION`, jamais déduit.
   */
  meanMotionPropagation?: boolean;
  /**
   * Ballant autour d'un barycentre imposé par un compagnon massif. Le fichier du corps est
   * alors interpolé une fois ce ballant retiré (série lisse), puis `factor × compagnon(t)`
   * est rajouté, le compagnon venant de son propre binaire. Cf. `REFLEX_MIN_MASS_RATIO`.
   */
  reflex?: { companion: string; factor: number };
}

/**
 * Un satellite pesant au moins 5 % de sa planète fait tourner celle-ci autour d'un barycentre
 * hors d'elle. Seul Charon franchit le seuil (12,2 % de Pluton ; la Lune fait 1,2 %). Pluton
 * décrit alors un cercle de ~2 100 km en 6,39 jours, que des échantillons tous les 4 jours ne
 * peuvent pas suivre : mesuré contre Horizons, Pluton était à 579 km en moyenne et ses quatre
 * petites lunes, stockées par rapport au CENTRE de Pluton, à 460-570 km.
 *
 * Les échantillons étant des états exacts, le barycentre l'est aussi à chaque échantillon :
 * B = Pluton + q·Charon, avec q = m_C / (m_P + m_C). On interpole cette série lisse, puis on
 * rajoute le ballant à la date demandée depuis le binaire de Charon (1,5 km d'erreur) :
 *   - Pluton (héliocentrique)          : P(t) = B(t) − q·C(t)    -> facteur −q ;
 *   - Styx, Nix… (relatifs à Pluton)   : S(t) = S_B(t) + q·C(t)  -> facteur +q.
 * Aucun octet d'asset en plus ; un pas de 0,5 jour aurait coûté 7 Mo pour Pluton seul.
 */
export const REFLEX_MIN_MASS_RATIO = 0.05;

/**
 * Satellites dont l'interpolation dynamique avance au rythme moyen. Choix MESURÉ contre JPL
 * Horizons (`pnpm ephemeris:validate`, 48 dates sur 1900-2100, erreur moyenne en km, avant ->
 * après) et retenu seulement au-delà de 15 % de gain :
 *
 *   Phobos 39 -> 13     Amalthée 4 418 -> 1 089    Encelade 954 -> 555
 *   Mimas 1 653 -> 798  Téthys 654 -> 554          Miranda 69 -> 49     Protée 109 -> 54
 *
 * Ce sont les lunes proches d'une planète très aplatie, où l'écart osculateur/moyen est un
 * biais de J2. Ailleurs il n'en est pas un et la correction dégrade (Titan 19 -> 33, Rhéa
 * 190 -> 282, Triton 40 -> 55) : d'où une liste et non une règle. Un critère « auto-ajusté »
 * sur les échantillons du fichier a été essayé et rejeté, mesures à l'appui : sur un pas
 * double il choisit un facteur faux (Titan 19 -> 927 km).
 */
export const MEAN_MOTION_PROPAGATION: ReadonlySet<string> = new Set([
  'phobos',
  'amalthea',
  'enceladus',
  'mimas',
  'tethys',
  'miranda',
  'proteus',
]);

/**
 * μ (UA³/jour²) par nom de corps.
 *
 * La règle est celle du problème à deux corps relatif : le μ qui gouverne le mouvement d'un
 * corps AUTOUR DE SON PARENT vaut G × (masse du parent + masse de tout ce qui orbite à
 * l'intérieur de son orbite, lui compris). Ce n'est pas un raffinement théorique, c'est
 * mesurable sur ce catalogue :
 *
 *   - Charon pèse 12,2 % de Pluton. L'ignorer donne un mouvement moyen 5,8 % trop lent,
 *     soit 13° d'erreur de phase accumulés sur un pas d'échantillonnage de 4 jours — assez
 *     pour déformer visiblement l'orbite reconstruite.
 *   - Styx, Nix, Kerbéros et Hydre orbitent en réalité le BARYCENTRE Pluton-Charon, qui est
 *     hors de Pluton. Compter Charon comme masse intérieure est la meilleure approximation
 *     à deux corps de leur mouvement, et la seule qui donne la bonne période.
 *   - La Lune pèse 1,2 % de la Terre ; le terme est du même ordre.
 *   - Partout ailleurs il est négligeable (Triton, la plus massive après Charon, pèse
 *     0,02 % de Neptune) mais jamais faux.
 *
 * Le Soleil est fixé à k² (constante de Gauss) plutôt que dérivé de sa masse : c'est la
 * valeur qui définit l'unité astronomique, donc la seule cohérente avec les positions
 * héliocentriques, et elle est connue bien plus précisément que M☉ en kilogrammes.
 */
export function bodyDynamics(
  config: CelestialConfig = CELESTIAL_CONFIG
): Record<string, BodyDynamics> {
  const parameters: Record<string, BodyDynamics> = {};

  for (const [name, body] of Object.entries(config.bodies)) {
    // Corps héliocentrique : le Soleil, plus sa propre masse (terme réel, 0,1 % pour
    // Jupiter, et gratuit à écrire correctement).
    parameters[name] = {
      mu:
        MU_SUN_AU3_PER_DAY2 +
        gravitationalParameter(body.realData?.massKg ?? 0),
      periodDays: body.realData?.orbitPeriodDays,
    };

    const satellites = Object.entries(body.satellites ?? {});
    if (satellites.length === 0) continue;

    const parentMass = body.realData?.massKg ?? 0;
    const heavy = satellites.find(
      ([, satellite]) =>
        parentMass > 0 &&
        (satellite.realData?.massKg ?? 0) / parentMass >= REFLEX_MIN_MASS_RATIO
    );
    const heavyName = heavy?.[0];
    const q = heavy
      ? heavy[1].realData!.massKg! / (parentMass + heavy[1].realData!.massKg!)
      : 0;
    if (heavyName)
      parameters[name].reflex = { companion: heavyName, factor: -q };

    for (const [satelliteName, satellite] of satellites) {
      const ownDistance = satellite.realData?.distanceAU;
      let interiorMass = parentMass;
      for (const [otherName, other] of satellites) {
        const otherMass = other.realData?.massKg;
        const otherDistance = other.realData?.distanceAU;
        if (otherMass === undefined) continue;
        // Lui-même, et tout satellite dont l'orbite est intérieure à la sienne.
        const isInterior =
          otherName === satelliteName ||
          (ownDistance !== undefined &&
            otherDistance !== undefined &&
            otherDistance <= ownDistance);
        if (isInterior) interiorMass += otherMass;
      }
      parameters[satelliteName] = {
        mu: gravitationalParameter(interiorMass),
        periodDays: satellite.realData?.orbitPeriodDays,
        ...(MEAN_MOTION_PROPAGATION.has(satelliteName)
          ? { meanMotionPropagation: true }
          : {}),
        ...(heavyName && satelliteName !== heavyName
          ? { reflex: { companion: heavyName, factor: q } }
          : {}),
      };
    }
  }

  return parameters;
}
