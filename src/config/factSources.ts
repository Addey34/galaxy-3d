/**
 * Registre des SOURCES PRIMAIRES des faits affichés (fiche d'un corps, pages par corps).
 *
 * **Depuis le lot 7 (phase 1), la DONNÉE n'est plus ici** : les 18 sources vivent dans
 * `src/registry/providers/*.json`, validées par le schéma Zod de `src/registry/schema/`.
 * Ce module reste la façade que lisent `ui/bodyInfo.ts`, `seo/sourcesPage.ts`,
 * `utils/safeUrl.ts` et `factProvenance.test.ts` : `FACT_SOURCES` est maintenant DÉRIVÉ du
 * registre, dans l'ordre que celui-ci déclare, et les helpers de dérivation et de provenance
 * (`measured`, `derived`, `massFromGM`…) restent ici, car ce sont du code, pas de la donnée.
 *
 * Chaque valeur que Galaxy présente comme un fait (rayon, masse, gravité, température moyenne,
 * distance, période, rotation, obliquité, nombre de lunes) porte dans le catalogue une
 * provenance (`realData.sources[champ]`) qui nomme une entrée de ce registre, la méthode
 * (mesurée, dérivée, illustrative) et, pour un fait qui évolue, sa date de validité.
 *
 * Règles, chacune tenue par `factProvenance.test.ts` :
 *   - une source primaire : agence (NASA, JPL, ESA, IAU/WGCCRE, USGS), base de données d'agence,
 *     article publié ou prépublication nommée comme telle. Jamais Wikipédia, qui reste le lien
 *     « En savoir plus » et ne cite rien ici ;
 *   - une valeur citée est CONFRONTÉE à la source : `factSources.snapshot.json` (écrit par
 *     `scripts/snapshot-fact-sources.mjs`) garde les tables NASA/JPL telles que lues, et le test
 *     compare chaque valeur à sa ligne ;
 *   - un fait affiché sans provenance n'est pas affiché comme un fait (`core/bodyFacts.ts`), et
 *     le test refuse le catalogue qui en contient un. Une valeur que la simulation utilise mais
 *     qu'aucune source ne porte se déclare `unknown` avec `NOT_YET_SOURCED`.
 */
import type { FactProvenance, UnknownReason } from '@/types';
import type { MessageKey } from '@/i18n/dict-en';
import { KM_PER_AU } from '@/core/ScaleService';
import { FACT_SOURCE_PROVIDERS } from '@/registry/providers';

export type FactSourceKind = 'agency' | 'database' | 'article' | 'preprint';

export interface FactSource {
  /** Qui publie : agence, base, ou auteurs d'un article (« Sicardy et al. »). */
  publisher: string;
  /** Titre tel que publié. */
  title: string;
  url: string;
  kind: FactSourceKind;
  /** Revue et année pour un article, `AAAA` ou `AAAA-MM-JJ`. */
  published?: string;
  journal?: string;
  doi?: string;
  /** Date à laquelle la source a été lue pour ce catalogue. */
  accessed: string;
}

/**
 * Sources primaires des faits, DÉRIVÉES du registre `src/registry/providers/`, dans l'ordre
 * qu'il déclare. Cet ordre est une donnée publiée : `seo/sourcesPage.ts` écrit le tableau des
 * sources primaires de `/sources` en parcourant cet objet.
 */
export const FACT_SOURCES = FACT_SOURCE_PROVIDERS satisfies Record<
  string,
  FactSource
>;

export type FactSourceId = keyof typeof FACT_SOURCES;

/**
 * Hôtes des sources, dérivés du registre : la fiche ne crée un lien que vers l'un d'eux
 * (`utils/safeUrl.ts`), sans liste parallèle à tenir à jour.
 */
export const FACT_SOURCE_HOSTS: ReadonlySet<string> = new Set(
  Object.values(FACT_SOURCES).map((source) => new URL(source.url).hostname)
);

/** Source d'un identifiant, ou `undefined` si le registre ne la connaît pas. */
export function factSource(id: string): FactSource | undefined {
  return (FACT_SOURCES as Record<string, FactSource>)[id];
}

// ── Dérivations : écrites une fois, lisibles dans le catalogue ────────────────────────────────

/**
 * Constante gravitationnelle, CODATA 2018 (NIST, https://physics.nist.gov/cgi-bin/cuu/Value?bg).
 * Les tables d'éphémérides publient GM, connu bien mieux que G : la masse en kilogrammes est
 * une valeur DÉRIVÉE, et sa précision est celle de G (2,2e-5 relatif).
 */
export const G_SI = 6.6743e-11;

/** Masse (kg) depuis GM (km³/s²). */
export const massFromGM = (gmKm3s2: number): number => (gmKm3s2 * 1e9) / G_SI;

/** Gravité de surface (m/s²) d'une sphère de rayon `radiusKm`, sans rotation, depuis GM (km³/s²). */
export const gravityFromGM = (gmKm3s2: number, radiusKm: number): number =>
  (gmKm3s2 * 1e9) / (radiusKm * 1e3) ** 2;

/** Gravité de surface (m/s²) depuis une masse (kg). */
export const gravityFromMass = (massKg: number, radiusKm: number): number =>
  gravityFromGM((massKg * G_SI) / 1e9, radiusKm);

/** Masse (kg) d'une sphère de densité `gPerCm3` et de rayon `radiusKm`. */
export const massFromDensity = (gPerCm3: number, radiusKm: number): number =>
  gPerCm3 * 1000 * (4 / 3) * Math.PI * (radiusKm * 1e3) ** 3;

/** Distance en UA depuis des kilomètres (même UA que la scène, `ScaleService.KM_PER_AU`). */
export const kmToAu = (km: number): number => km / KM_PER_AU;

// ── Raccourcis de provenance pour le catalogue ───────────────────────────────────────────────

export const measured = (
  source: FactSourceId,
  extra: Omit<FactProvenance, 'source' | 'method'> = {}
): FactProvenance => ({ source, method: 'measured', ...extra });

export const derived = (
  source: FactSourceId,
  extra: Omit<FactProvenance, 'source' | 'method'> = {}
): FactProvenance => ({ source, method: 'derived', ...extra });

/**
 * Précisions récurrentes : ce que la source mesure exactement quand le libellé de la fiche est
 * plus large (« Rayon » d'une géante = rayon équatorial au niveau de 1 bar), ou comment une
 * valeur dérivée a été calculée.
 *
 * CE SONT DES CLÉS, ET NON DU TEXTE, depuis le lot 35. Cette table inlinait ses 28 précisions
 * dans les QUATRE langues, au milieu de la clôture statique du démarrage : 6 676 octets de
 * source, 2 828 gzippés, payés par un visiteur qui n'en lit qu'un quart. C'est exactement ce que
 * le contrat du lot 20 interdit (« un visiteur charge le dictionnaire de SA langue et d'aucune
 * autre »), et rien ne le gardait. Le texte vit maintenant dans les dictionnaires, dont seul
 * l'anglais est statique parce qu'il est le repli de `t()` ; une clé absente de `dict-en` est
 * une erreur de COMPILATION. Garde : `src/i18n/localizedProse.test.ts`.
 */
export const DETAIL = {
  equatorialRadius1Bar: { message: 'detail.equatorialRadius1Bar' },
  meanGravity1Bar: { message: 'detail.meanGravity1Bar' },
  equatorialGravity: { message: 'detail.equatorialGravity' },
  temperature1Bar: { message: 'detail.temperature1Bar' },
  effectiveTemperature: { message: 'detail.effectiveTemperature' },
  solarRotationAt16Degrees: { message: 'detail.solarRotationAt16Degrees' },
  obliquityToEcliptic: { message: 'detail.obliquityToEcliptic' },
  synchronousRotation: { message: 'detail.synchronousRotation' },
  massFromGM: { message: 'detail.massFromGM' },
  gravityFromGM: { message: 'detail.gravityFromGM' },
  radiusFromDiameter: { message: 'detail.radiusFromDiameter' },
  equatorialRadiusFromDiameter: {
    message: 'detail.equatorialRadiusFromDiameter',
  },
  volumetricRadiusFromDiameter: {
    message: 'detail.volumetricRadiusFromDiameter',
  },
  itokawaPublishedMass: { message: 'detail.itokawaPublishedMass' },
  gravityFromSystemMass: { message: 'detail.gravityFromSystemMass' },
  massFromDensity: { message: 'detail.massFromDensity' },
  gravityFromMass: { message: 'detail.gravityFromMass' },
  systemMass: { message: 'detail.systemMass' },
  obliquityFromPole: { message: 'detail.obliquityFromPole' },
  osculatingSemiMajorAxis: { message: 'detail.osculatingSemiMajorAxis' },
  keplerPeriod: { message: 'detail.keplerPeriod' },
  partialLightcurve: { message: 'detail.partialLightcurve' },
  confirmedSatellites: { message: 'detail.confirmedSatellites' },
  nssdcaFactsInBrief: { message: 'detail.nssdcaFactsInBrief' },
  firstObservationUsed: { message: 'detail.firstObservationUsed' },
  osculatingEccentricity: { message: 'detail.osculatingEccentricity' },
  absoluteMagnitudeH: { message: 'detail.absoluteMagnitudeH' },
  perihelionFromElements: { message: 'detail.perihelionFromElements' },
} as const satisfies Record<string, { message: MessageKey }>;

/**
 * Raison affichée pour une valeur que la simulation porte mais qu'aucune source primaire ne
 * rattache encore. Formulée pour rester VRAIE quel que soit le champ : elle ne prétend pas que
 * la science ignore la valeur, seulement que Galaxy ne l'a pas encore sourcée.
 */
export const NOT_YET_SOURCED: UnknownReason = {
  unsourced: true,
  message: 'fact.notYetSourced',
};
