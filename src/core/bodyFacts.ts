/**
 * Faits affichés d'un corps : LA règle qui décide ce qui se montre comme un fait.
 *
 * Deux surfaces publient les mêmes grandeurs : la fiche de l'application (`ui/bodyInfo.ts`) et
 * la page publique de chaque corps (`seo/bodyLandingPage.ts`). Elles formatent différemment
 * (langue, unités, HTML), mais la décision « valeur sourcée, non publiée, pas encore sourcée,
 * hors sujet » ne doit exister qu'ici : deux copies de cette règle, c'est une page qui affiche
 * ce que la fiche refuse. Le défaut « 0 km » de Bennu l'a déjà montré pour un formateur.
 *
 * Module PUR : ni DOM, ni i18n, ni Three.js.
 */
import { NOT_YET_SOURCED } from '@/config/factSources';
import type {
  CelestialBodyConfig,
  FactField,
  FactProvenance,
  UnknownReason,
} from '@/types';

/**
 * Valeur d'un fait. Deux natures, et deux seulement : un NOMBRE dans l'unité du catalogue, ou
 * une DATE de calendrier. La date est arrivée avec les objets d'instrument (lancement d'une
 * sonde, première observation d'un interstellaire) : l'encoder en nombre aurait rendu le champ
 * illisible dans la fiche JSON et permis à `displayedUncertainty` de calculer une incertitude
 * relative sur un instant, ce qui n'a aucun sens. L'ensemble reste FERMÉ, comme les formes
 * déclarées du registre : pas de fait en texte libre.
 */
export type FactValue =
  { kind: 'number'; value: number } | { kind: 'date'; iso: string };

export type FactEntry =
  | {
      field: FactField;
      status: 'value';
      value: FactValue;
      provenance: FactProvenance;
    }
  | { field: FactField; status: 'unknown'; reason: UnknownReason }
  | { field: FactField; status: 'absent' };

/**
 * Tous les champs de faits, en un seul endroit : `notApplicableFacts` a besoin de l'ensemble
 * complet pour le soustraire, et un `FactField` oublié ici ferait apparaître une ligne muette
 * sur une fiche d'objet d'instrument. Le test `bodyFacts.test.ts` le confronte aux deux ordres
 * d'affichage.
 */
const FACT_LABEL_ORDER: Record<FactField, true> = {
  radiusKm: true,
  massKg: true,
  gravity: true,
  meanTempC: true,
  moonCount: true,
  axialTilt: true,
  distanceAU: true,
  orbitPeriodDays: true,
  rotationPeriod: true,
  launchDate: true,
  firstObservation: true,
  eccentricity: true,
  perihelionAU: true,
};

/** Tous les champs de faits connus, dans l'ordre de leur déclaration. */
export const ALL_FACT_FIELDS: readonly FactField[] = Object.keys(
  FACT_LABEL_ORDER
) as FactField[];

/** Faits dont la valeur est une date de calendrier plutôt qu'un nombre. */
export const DATE_FACTS: ReadonlySet<FactField> = new Set<FactField>([
  'launchDate',
  'firstObservation',
]);

/**
 * Faits que SEULE la couche instrument porte (`config/navigable.ts`), par `kind`. Un objet
 * d'instrument n'a en retour aucun des faits du catalogue, sauf sa masse pour une sonde : il
 * n'a ni rayon publié, ni gravité, ni température, ni lune, ni orbite fermée.
 */
const INSTRUMENT_FACTS: Readonly<Record<string, readonly FactField[]>> = {
  spacecraft: ['launchDate', 'massKg'],
  interstellar: ['eccentricity', 'perihelionAU', 'firstObservation'],
};

/**
 * Faits que SEULE la couche instrument peut porter. Ce n'est PAS l'union des listes ci-dessus :
 * la masse d'une sonde est la même grandeur que celle d'une planète, et l'inclure ici l'aurait
 * effacée de tout le catalogue (défaut attrapé par `factProvenance.test.ts`, 40 valeurs
 * disparues d'un coup).
 */
const INSTRUMENT_ONLY_FACTS: ReadonlySet<FactField> = new Set<FactField>([
  'launchDate',
  'firstObservation',
  'eccentricity',
  'perihelionAU',
]);

/**
 * Champs structurellement hors sujet pour un `kind`. Une étoile centrale n'orbite rien et n'a
 * pas de lunes (le Soleil a longtemps porté `moonCount: 8` pour ses planètes). Une lune n'a pas
 * de lune connue : « Lunes connues : 0 » sur la fiche de Titan n'apprend rien et ne se source
 * nulle part. Un objet d'instrument, symétriquement, n'a que les faits de sa famille : la règle
 * est déclarée, pas déduite de l'absence de valeur, pour qu'une valeur ajoutée par erreur à une
 * fiche n'ouvre pas une ligne qui n'a pas de sens.
 */
export function notApplicableFacts(cfg: CelestialBodyConfig): Set<FactField> {
  const instrument = INSTRUMENT_FACTS[cfg.kind];
  if (instrument) {
    const applicable = new Set<FactField>(instrument);
    return new Set(
      (Object.keys(FACT_LABEL_ORDER) as FactField[]).filter(
        (field) => !applicable.has(field)
      )
    );
  }
  const out = new Set<FactField>(INSTRUMENT_ONLY_FACTS);
  if (cfg.kind === 'star')
    for (const field of ['orbitPeriodDays', 'distanceAU', 'moonCount'] as const)
      out.add(field);
  if (cfg.kind === 'moon') out.add('moonCount');
  return out;
}

/** Faits qui évoluent avec les découvertes : leur provenance DOIT porter `asOf`. */
export const TIME_VARYING_FACTS: ReadonlySet<FactField> = new Set([
  'moonCount',
]);

/**
 * Valeur brute d'un champ, dans l'unité du catalogue (radians pour l'obliquité, heures pour la
 * rotation). La rotation n'a pas de champ documentaire : elle se lit dans `rotationSpeed`, la
 * vitesse que la simulation applique, pour qu'on ne publie jamais une période que la scène ne
 * montre pas.
 */
export function factValue(
  cfg: CelestialBodyConfig,
  field: FactField
): FactValue | undefined {
  if (field === 'rotationPeriod')
    return cfg.rotationSpeed
      ? {
          kind: 'number',
          value: (2 * Math.PI) / (Math.abs(cfg.rotationSpeed) * 3600),
        }
      : undefined;
  const value = cfg.realData?.[field];
  if (DATE_FACTS.has(field))
    return typeof value === 'string' ? { kind: 'date', iso: value } : undefined;
  return typeof value === 'number' ? { kind: 'number', value } : undefined;
}

/** Valeur numérique d'un fait, ou `undefined` si ce fait est une date ou n'existe pas. */
export function factNumber(
  cfg: CelestialBodyConfig,
  field: FactField
): number | undefined {
  const value = factValue(cfg, field);
  return value?.kind === 'number' ? value.value : undefined;
}

/**
 * État affiché d'un champ. Ordre des règles, chacune tranchant la suivante :
 *   1. hors sujet pour le `kind` → absent ;
 *   2. déclaré dans `unknown` → non affiché, avec sa raison (même si la simulation garde une
 *      valeur : l'obliquité 0 d'une lune synchrone sert au rendu, elle n'est pas une mesure) ;
 *   3. pas de valeur → absent ;
 *   4. une valeur SANS provenance → non affichée, « pas encore sourcée ». Filet de sécurité : le
 *      test `factProvenance.test.ts` refuse ce cas dans le catalogue ; ceci garantit qu'une
 *      régression ne publie pas pour autant un chiffre sans source.
 */
export function bodyFact(
  cfg: CelestialBodyConfig,
  field: FactField
): FactEntry {
  if (notApplicableFacts(cfg).has(field)) return { field, status: 'absent' };
  const reason = cfg.realData?.unknown?.[field];
  if (reason) return { field, status: 'unknown', reason };
  const value = factValue(cfg, field);
  if (value === undefined) return { field, status: 'absent' };
  const provenance = cfg.realData?.sources?.[field];
  if (!provenance) return { field, status: 'unknown', reason: NOT_YET_SOURCED };
  return { field, status: 'value', value, provenance };
}

/**
 * Incertitude relative à afficher à côté de la valeur, ou `null`. Seuil de 5 % : en dessous,
 * l'arrondi affiché dit déjà la précision utile ; au-dessus, taire l'incertitude laisserait lire
 * la masse de Protée (± 94 %) avec la même assurance que celle de la Terre.
 */
export const UNCERTAINTY_DISPLAY_THRESHOLD = 0.05;

export function displayedUncertainty(entry: FactEntry): number | null {
  if (entry.status !== 'value' || entry.provenance.uncertainty === undefined)
    return null;
  // Une incertitude RELATIVE n'a pas de sens sur une date : « le 5 septembre 1977 ± 3 % » ne
  // veut rien dire, et le seul fait daté qui en porterait une resterait à écrire.
  if (entry.value.kind !== 'number' || entry.value.value === 0) return null;
  const relative = Math.abs(entry.provenance.uncertainty / entry.value.value);
  return relative >= UNCERTAINTY_DISPLAY_THRESHOLD ? relative : null;
}

/**
 * Numérotation des sources citées, dans l'ordre de première apparition parmi `entries` : le
 * numéro affiché à côté d'une valeur renvoie à la même entrée de la liste des sources.
 */
export function citationOrder(
  entries: readonly FactEntry[]
): Map<string, number> {
  const order = new Map<string, number>();
  for (const entry of entries)
    if (entry.status === 'value' && !order.has(entry.provenance.source))
      order.set(entry.provenance.source, order.size + 1);
  return order;
}
