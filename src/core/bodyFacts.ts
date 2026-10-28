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
import { temperatureLabelKey } from '@/core/factQuantity';
import type {
  CelestialBodyConfig,
  FactField,
  FactProvenance,
  UnknownReason,
  WindBands,
} from '@/types';

/**
 * Valeur d'un fait. Cinq natures, et cinq seulement : un NOMBRE dans l'unité du catalogue, un
 * INTERVALLE publié comme tel, deux maxima PAR BANDE DE LATITUDE (les vents de Jupiter et de
 * Saturne, lot 51), une DATE de calendrier, ou un NOM propre.
 *
 * L'intervalle est arrivé au lot 51 avec l'atmosphère des géantes : la fiche de Neptune publie
 * « Scale height: 19.1 - 20.3 km ». Le réduire à son milieu, ou à un milieu « ± demi-largeur »,
 * publierait un nombre que la source n'écrit pas.
 *
 * La date est arrivée avec les objets d'instrument (lancement d'une sonde, première
 * observation d'un interstellaire) : l'encoder en nombre aurait rendu le champ illisible dans
 * la fiche JSON et permis à `displayedUncertainty` de calculer une incertitude relative sur un
 * instant, ce qui n'a aucun sens.
 *
 * Le nom est arrivé au lot 10 avec le lanceur et le site de lancement d'une sonde. Ce n'est
 * PAS du texte libre, et c'est ce qui justifie de l'admettre : c'est la chaîne que la source
 * écrit, recopiée à l'identique, jamais traduite ni composée (« Titan IIIE-Centaur », « Kourou,
 * French Guiana »), et `config/factProvenance.test.ts` la compare caractère pour caractère au
 * relevé. Une phrase écrite par nous ne passerait pas cette garde, et c'est l'invariant que la
 * fermeture protégeait. L'ensemble reste FERMÉ, comme les formes déclarées du registre.
 */
export type FactValue =
  | { kind: 'number'; value: number }
  | { kind: 'range'; min: number; max: number }
  | ({ kind: 'latitudeBands' } & WindBands)
  | { kind: 'date'; iso: string }
  | { kind: 'name'; text: string };

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
  launchVehicle: true,
  launchSite: true,
  absoluteMagnitude: true,
  temperature1BarK: true,
  temperature01BarK: true,
  density1BarKgM3: true,
  scaleHeightKm: true,
  meanMolecularWeight: true,
  windSpeedMs: true,
  surfacePressureBar: true,
  surfaceDensityKgM3: true,
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

/** Faits dont la valeur est un nom propre recopié de la source (voir `FactValue`). */
export const NAME_FACTS: ReadonlySet<FactField> = new Set<FactField>([
  'launchVehicle',
  'launchSite',
]);

/**
 * Faits sur une échelle LOGARITHMIQUE, dont l'incertitude se lit en valeur absolue. Une
 * magnitude de 22,08 ± 0,45 n'est pas « à 2 % près » : 0,45 magnitude, c'est un facteur 1,5 sur
 * la brillance, donc de l'ordre de 20 % sur le diamètre qu'on en déduit.
 */
const ABSOLUTE_UNCERTAINTY_FACTS: ReadonlySet<FactField> = new Set<FactField>([
  'absoluteMagnitude',
]);

/**
 * Faits que SEULE la couche instrument porte (`config/navigable.ts`), par `kind`. Un objet
 * d'instrument n'a en retour aucun des faits du catalogue, sauf sa masse pour une sonde : il
 * n'a ni rayon publié, ni gravité, ni température, ni lune, ni orbite fermée.
 */
const INSTRUMENT_FACTS: Readonly<Record<string, readonly FactField[]>> = {
  spacecraft: ['launchDate', 'launchVehicle', 'launchSite', 'massKg'],
  interstellar: [
    'eccentricity',
    'perihelionAU',
    'firstObservation',
    'absoluteMagnitude',
  ],
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
  'launchVehicle',
  'launchSite',
  'absoluteMagnitude',
]);

/** Les six faits de la fiche d'une géante gazeuse du NSSDCA, définis « à 1 bar ». */
export const GAS_GIANT_ATMOSPHERE_FACTS: readonly FactField[] = [
  'temperature1BarK',
  'temperature01BarK',
  'density1BarKgM3',
  'scaleHeightKm',
  'meanMolecularWeight',
  'windSpeedMs',
];

/**
 * Les quatre faits de l'atmosphère AU SOL d'une planète à surface (Vénus, Terre, Mars). La hauteur
 * d'échelle et la masse molaire sont les MÊMES champs que ceux des géantes, publiés par la même
 * fiche ; seule la référence change (la surface, non le niveau de 1 bar), d'où la classe déclarée.
 * Les vents n'en font pas partie : trois formes sans rapport d'une fiche à l'autre.
 */
export const TERRESTRIAL_ATMOSPHERE_FACTS: readonly FactField[] = [
  'surfacePressureBar',
  'surfaceDensityKgM3',
  'scaleHeightKm',
  'meanMolecularWeight',
];

/**
 * La pression de surface en bar, écrite dans l'unité où elle se lit : « 92 bar », « 1,014 bar »,
 * mais « 6,36 mbar » pour Mars, que la source écrit en millibars. Le seuil est 1 bar. Partagée par
 * la fiche de l'application et la page publique du corps, qui écrivaient sinon deux unités.
 * L'arrondi à 12 chiffres retire le bruit binaire du produit par 1000 (0,00636 × 1000).
 */
export function surfacePressureDisplay(bar: number): {
  value: number;
  unit: 'bar' | 'mbar';
} {
  return bar >= 1
    ? { value: bar, unit: 'bar' }
    : { value: Number((bar * 1000).toPrecision(12)), unit: 'mbar' };
}

/** Les faits d'atmosphère qu'une classe déclarée ouvre (`atmosphereClass`). */
export function atmosphereFactsOf(
  atmosphereClass: CelestialBodyConfig['atmosphereClass']
): readonly FactField[] {
  if (atmosphereClass === 'gas-giant') return GAS_GIANT_ATMOSPHERE_FACTS;
  if (atmosphereClass === 'terrestrial') return TERRESTRIAL_ATMOSPHERE_FACTS;
  return [];
}

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
  // Un fond d'étoiles n'est pas un corps : aucun fait ne s'y applique (le test de complétude l'exclut
  // déjà ; l'inventaire le comptait manquant de neuf faits).
  if (cfg.kind === 'skybox') return new Set(ALL_FACT_FIELDS);
  const out = new Set<FactField>(INSTRUMENT_ONLY_FACTS);
  // Les six faits « à 1 bar » sont ceux de la fiche d'une GÉANTE du NSSDCA, les quatre faits « au
  // sol » ceux d'une planète à surface : hors sujet pour tout corps qui ne se déclare pas tel
  // (déclaré dans la fiche, jamais déduit de l'absence de valeur).
  const opened = new Set(atmosphereFactsOf(cfg.atmosphereClass));
  for (const field of [
    ...GAS_GIANT_ATMOSPHERE_FACTS,
    ...TERRESTRIAL_ATMOSPHERE_FACTS,
  ])
    if (!opened.has(field)) out.add(field);
  if (cfg.kind === 'star')
    for (const field of ['orbitPeriodDays', 'distanceAU', 'moonCount'] as const)
      out.add(field);
  if (cfg.kind === 'moon') out.add('moonCount');
  return out;
}

/**
 * Faits dont la SCÈNE lit la valeur, publiée ou non. Une lune synchrone garde son obliquité
 * pour l'orienter (`CelestialObject`), un corps garde son rayon pour décider d'une approche de
 * surface (`ui/surfacePanel`, `ui/surfaceProbe`, `ui/webxr`) et sa masse pour le calcul du
 * mouvement du parent (`config/gravity`). Ces trois-là peuvent donc porter une valeur ET une
 * raison de ne pas l'afficher, sans se contredire.
 *
 * Tout autre champ, lui, se contredirait : une gravité de surface que la fiche refuse de
 * publier et que personne ne lit n'est plus un besoin de la simulation, c'est un chiffre mort.
 * Quatre traînaient ainsi (Haumea, Orcus, Makémaké, Néréide) ; `catalogueCompleteness.test.ts`
 * les refuse désormais.
 */
export const SIMULATION_ONLY_FACTS: ReadonlySet<FactField> = new Set([
  'axialTilt',
  'radiusKm',
  'massKg',
]);

/**
 * Décimales de l'inclinaison axiale sur la fiche d'un corps, en degrés. Nommée (lot 58) parce
 * qu'une activité pour la classe dit à l'élève ce qu'il y lira : `src/config/activities.test.ts`
 * confronte la valeur arrondie de son corrigé à cette constante.
 */
export const AXIAL_TILT_DISPLAY_DECIMALS = 1;

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
  if (NAME_FACTS.has(field))
    return typeof value === 'string' && value.length > 0
      ? { kind: 'name', text: value }
      : undefined;
  if (isWindBands(value)) return { kind: 'latitudeBands', ...value };
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    value[0] < value[1]
  )
    return { kind: 'range', min: value[0], max: value[1] };
  return typeof value === 'number' ? { kind: 'number', value } : undefined;
}

/** Les deux maxima par bande de latitude (vents de Jupiter et de Saturne), exactement ces clés. */
function isWindBands(value: unknown): value is WindBands {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const keys = Object.keys(value).sort().join();
  return (
    keys === 'aboveMaxMs,belowLatDeg,belowMaxMs' &&
    Object.values(value).every(
      (v) => typeof v === 'number' && Number.isFinite(v)
    )
  );
}

/** Valeur numérique d'un fait, ou `undefined` si ce fait n'est pas un nombre ou n'existe pas. */
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
const UNCERTAINTY_DISPLAY_THRESHOLD = 0.05;

export function displayedUncertainty(entry: FactEntry): number | null {
  if (entry.status !== 'value' || entry.provenance.uncertainty === undefined)
    return null;
  // Une incertitude RELATIVE n'a pas de sens sur une date : « le 5 septembre 1977 ± 3 % » ne
  // veut rien dire, et le seul fait daté qui en porterait une resterait à écrire. Ni sur une
  // magnitude, qui a sa propre règle (`displayedAbsoluteUncertainty`).
  if (ABSOLUTE_UNCERTAINTY_FACTS.has(entry.field)) return null;
  if (entry.value.kind !== 'number' || entry.value.value === 0) return null;
  const relative = Math.abs(entry.provenance.uncertainty / entry.value.value);
  return relative >= UNCERTAINTY_DISPLAY_THRESHOLD ? relative : null;
}

/**
 * Incertitude ABSOLUE à afficher, dans l'unité du fait, pour un fait d'échelle logarithmique ;
 * `null` pour tout autre fait. Toujours affichée quand elle est publiée : aucun seuil relatif
 * ne s'applique à une magnitude, voir `ABSOLUTE_UNCERTAINTY_FACTS`.
 */
export function displayedAbsoluteUncertainty(entry: FactEntry): number | null {
  if (entry.status !== 'value' || !ABSOLUTE_UNCERTAINTY_FACTS.has(entry.field))
    return null;
  return entry.provenance.uncertainty ?? null;
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

/**
 * Sous ce seuil une masse s'écrit en kilogrammes, avec la décimale que la source publie (721,9 kg
 * pour Voyager 1) ; au-delà, en notation scientifique. Partagé par la fiche de l'application et
 * par les pages publiques : les deux écrivaient la même masse différemment.
 */
export const SCIENTIFIC_MASS_KG = 1e6;

/**
 * LES DEUX TEMPÉRATURES À 1 BAR DU NSSDCA (lot 51). La table principale (« Mean Temperature »,
 * « for the gas giants at the one bar level » selon sa note de définition) et la fiche de chaque
 * géante (« Temperature at 1 bar ») ne donnent pas la même valeur : 0,85 à 2,15 K d'écart sur
 * les quatre, relevé du 2026-09-28. Les deux sont publiées, et la ligne de la fiche dit l'autre
 * valeur et l'écart : la fiche ne tranche pas en silence, et un lecteur ne croit pas à une faute
 * de recopie. `null` quand le corps n'a pas les deux valeurs de la même source, ou qu'elles
 * s'accordent. Partagée par la fiche de l'application et la page publique du corps.
 */
export function oneBarTemperatureGap(
  cfg: CelestialBodyConfig
): { tableC: number; gapK: number } | null {
  const sheet = bodyFact(cfg, 'temperature1BarK');
  const table = bodyFact(cfg, 'meanTempC');
  if (sheet.status !== 'value' || table.status !== 'value') return null;
  if (sheet.value.kind !== 'number' || table.value.kind !== 'number')
    return null;
  if (
    temperatureLabelKey(table.provenance) !== 'stat.meanTemperature1Bar' ||
    table.provenance.source !== sheet.provenance.source
  )
    return null;
  const gapK = Math.abs(sheet.value.value - 273.15 - table.value.value);
  return gapK < 0.005 ? null : { tableC: table.value.value, gapK };
}
