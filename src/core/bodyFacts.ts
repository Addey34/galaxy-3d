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

export type FactEntry =
  | {
      field: FactField;
      status: 'value';
      value: number;
      provenance: FactProvenance;
    }
  | { field: FactField; status: 'unknown'; reason: UnknownReason }
  | { field: FactField; status: 'absent' };

/**
 * Champs structurellement hors sujet pour un `kind`. Une étoile centrale n'orbite rien et n'a
 * pas de lunes (le Soleil a longtemps porté `moonCount: 8` pour ses planètes). Une lune n'a pas
 * de lune connue : « Lunes connues : 0 » sur la fiche de Titan n'apprend rien et ne se source
 * nulle part.
 */
export function notApplicableFacts(cfg: CelestialBodyConfig): Set<FactField> {
  if (cfg.kind === 'star')
    return new Set(['orbitPeriodDays', 'distanceAU', 'moonCount']);
  if (cfg.kind === 'moon') return new Set(['moonCount']);
  return new Set();
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
): number | undefined {
  if (field === 'rotationPeriod')
    return cfg.rotationSpeed
      ? (2 * Math.PI) / (Math.abs(cfg.rotationSpeed) * 3600)
      : undefined;
  const value = cfg.realData?.[field];
  return typeof value === 'number' ? value : undefined;
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
  if (entry.value === 0) return null;
  const relative = Math.abs(entry.provenance.uncertainty / entry.value);
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
