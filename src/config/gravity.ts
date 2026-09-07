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
}

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
      };
    }
  }

  return parameters;
}
