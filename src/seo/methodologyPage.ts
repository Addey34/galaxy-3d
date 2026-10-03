/**
 * `/methodology` : comment Galaxy calcule ce qu'il montre, et avec quelle erreur MESURÉE.
 *
 * Le texte explique la méthode ; chaque nombre vient d'une source lue au build :
 *   - les erreurs : `horizons-validation-summary.json`, écrit par
 *     `scripts/validate-against-horizons.mjs` (lot 2) et seulement par une mesure complète ;
 *   - la couverture et le pas des binaires : `public/assets/ephemerides/manifest.json` ;
 *   - les constantes (obliquité, échelle, seuil d'interpolation, fenêtre interstellaire,
 *     secondes intercalaires) : importées des modules qui les APPLIQUENT, pas recopiées.
 * Si l'une de ces valeurs change, la page change au build suivant. Un nombre écrit dans une
 * phrase ci-dessous serait une affirmation que rien ne vérifie : il n'y en a pas.
 *
 * Module PUR : données en entrée, pages en sortie.
 */
import textureLadder from '@/config/textureLadder.json';
import type { CelestialConfig } from '@/types';
import {
  flattenBodies,
  forEachBody,
  ILLUSTRATIVE_SURFACES,
} from '@/config/catalog';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import {
  INTERSTELLAR_OBJECTS,
  INTERSTELLAR_WINDOW_YEARS,
} from '@/config/interstellar';
import { SMALL_BODY_ELEMENTS } from '@/config/smallBodies';
import { OBLIQUITY_RAD } from '@/core/frames';
import { ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY } from '@/core/orbitPath';
import { SQRT_K } from '@/core/ScaleService';
import { educationalParentOrbitScale } from '@/core/educationalScale';
import { MIN_SAMPLES_PER_ORBIT_FOR_HERMITE } from '@/core/HorizonsEphemerisService';
import { TT_MINUS_UTC } from '@/core/timeScale';
import {
  TEMPORAL_CATEGORIES,
  temporalCategoryLabelKey,
  type TemporalCategory,
} from '@/core/temporal';
import { messages } from '@/i18n/allDictionaries';
import { escapeHtml } from './bodyLandingPage';
import {
  type DocText,
  type DocLocale,
  type DocPage,
  DOC_LOCALES,
  docPath,
  docSection,
  docTable,
  formatQuantity,
} from './documentPage';
import { citationSection, type CitationMetadata } from './citation';

// ─────────────────────────── données d'entrée ───────────────────────────

export interface ValidationStats {
  mean: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
}

export interface ValidationRow {
  body: string;
  provider:
    'astronomy-engine' | 'horizons-binary' | 'kepler' | 'spk' | 'production';
  windowKind: 'fixed' | 'binary' | 'epoch' | 'perihelion' | 'deep';
  windowFrom: string;
  windowTo: string;
  windowClipped: boolean;
  /** Cible Horizons interrogée : le corps, ou le barycentre qui le remplace avant 1600. */
  target: string | null;
  /** Biais de cette substitution, mesuré par le témoin du lot 39. Absent sans substitution. */
  floorKm?: number;
  /** Raison pour laquelle cette ligne n'a PAS d'écart publié malgré une mesure faite. */
  floorRefused?: string;
  relative: boolean;
  radiusKm: number | null;
  n: number;
  uncovered: number;
  rejected: number;
  sources: Record<string, number>;
  referenceError?: boolean;
  km: ValidationStats | null;
  radii: ValidationStats | null;
}

/** La substitution de référence des époques profondes, corps par corps (lot 39). */
export interface DeepReference {
  target: string;
  targetName: string;
  /** Biais mesuré par le chemin RÉELLEMENT emprunté (les deux positions héliocentriques). */
  floorKm: number;
  /** Distance géométrique corps ↔ barycentre, demandée à Horizons en une seule fois. */
  separationMaxKm: number;
  radiusKm: number | null;
  insideBody: boolean;
}

export interface ValidationSummary {
  generatedAt: string;
  samplesPerCase: number;
  spk: { kernel: boolean; enabledInProduction: boolean };
  deep?: {
    witnessFrom: string;
    witnessTo: string;
    bodies: Record<string, DeepReference>;
    /**
     * Le désaccord des deux ΔT au milieu de chaque tranche profonde (ligne 22.10) : celui
     * d'Horizons (« TDB-UT ») et celui de l'application (`core/timeScale.ts`), en secondes.
     */
    deltaT?: { year: number; horizonsS: number; galaxyS: number }[];
  };
  rows: ValidationRow[];
}

export interface EphemerisManifestEntry {
  file: string;
  target: string;
  center: string;
  startJdTdb: number;
  stepDays: number;
  sampleCount: number;
}

export interface EphemerisManifest {
  source: string;
  generatedAt: string;
  frame: string;
  center: string;
  coverage: { start: string; stop: string };
  bodies: Record<string, EphemerisManifestEntry>;
}

// ─────────────────────────── noms et libellés ───────────────────────────

/** Nom affiché d'un corps, d'une sonde ou d'un objet interstellaire, dans la langue. */
export function displayNameResolver(
  config: CelestialConfig
): (name: string, locale: DocLocale) => string {
  const names = new Map<string, Partial<DocText>>();
  for (const [name, cfg] of flattenBodies(config))
    if (cfg.displayName) names.set(name, cfg.displayName);
  for (const mission of SPACECRAFT_MISSIONS)
    names.set(mission.name, mission.displayName);
  for (const object of INTERSTELLAR_OBJECTS)
    names.set(object.name, object.displayName);
  return (name, locale) =>
    names.get(name)?.[locale] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** Nombre de jeux de textures mesures : LU dans le releve, jamais saisi. */
const TEXTURE_LADDER_ROWS = textureLadder.rows.length;

const SOURCE_LABELS: Record<string, DocText> = {
  binaire: {
    en: 'JPL Horizons file',
    fr: 'fichier JPL Horizons',
    es: 'archivo JPL Horizons',
    'pt-BR': 'arquivo JPL Horizons',
  },
  'astronomy-engine': {
    en: 'astronomy-engine',
    fr: 'astronomy-engine',
    es: 'astronomy-engine',
    'pt-BR': 'astronomy-engine',
  },
  kepler: {
    en: 'Keplerian elements',
    fr: 'éléments képlériens',
    es: 'elementos keplerianos',
    'pt-BR': 'elementos keplerianos',
  },
};

/** « fichier JPL Horizons » ou, si la source a changé en cours de fenêtre, chaque part. */
function sourceLabel(row: ValidationRow, locale: DocLocale): string {
  const entries = Object.entries(row.sources);
  if (entries.length === 1)
    return escapeHtml(
      SOURCE_LABELS[entries[0]![0]]?.[locale] ?? entries[0]![0]
    );
  return entries
    .map(
      ([source, count]) =>
        `${escapeHtml(SOURCE_LABELS[source]?.[locale] ?? source)} (${count})`
    )
    .join(', ');
}

const NA: DocText = { en: 'n/a', fr: 'n.d.', es: 's. d.', 'pt-BR': 'n/d' };

function q(value: number | null | undefined, locale: DocLocale): string {
  return value === null || value === undefined
    ? NA[locale]
    : formatQuantity(value, locale);
}

/**
 * Année d'une date ISO, SANS ses zéros de tête : le format en porte quatre (`0001-01-01`), et
 * « de l'an 0001 à l'an 9999 » se lit mal. La fiche écrit déjà « 1 » de son côté
 * (`ui/bodyInfo`), et les deux ne peuvent pas diverger.
 */
const year = (iso: string): string => String(yearNumber(iso));

/**
 * L'année ASTRONOMIQUE d'une date ISO, signe compris. `slice(0, 4)` rendait « -001 » pour
 * « -001000-01-01 », que `toISOString` écrit pour une année avant l'an 1 (front des années avant
 * J.-C., ligne 22.10). L'année 0 est 1 av. J.-C., l'année -1000 est 1001 av. J.-C.
 */
const yearNumber = (iso: string): number =>
  Number(/^([+-]?\d+)-\d{2}-\d{2}/.exec(iso)?.[1] ?? Number.NaN);

/** Trier des dates ISO comme des DATES : « -001000 » passe avant « -009997 » en ordre de chaîne. */
const isoTime = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * Valeur EXACTE (un pas en jours, une constante), seulement le separateur decimal traduit.
 *
 * Le francais n'est pas seul a ecrire la virgule : l'espagnol et le portugais du Bresil aussi.
 * Le ternaire precedent leur servait un point, c'est-a-dire une notation qu'ils ne lisent pas.
 */
/** La conjonction d'une enumeration (« a, b ou c »), dans les quatre langues. */
const OR: DocText = { en: ' or ', fr: ' ou ', es: ' o ', 'pt-BR': ' ou ' };

const exact = (value: number, locale: DocLocale): string =>
  locale === 'en' ? String(value) : String(value).replace('.', ',');

// ─────────────────────────── dérivés du catalogue ───────────────────────────

/** Écart relatif sous lequel une lune est tenue pour verrouillée (cf. `bodies.test.ts`). */
const SYNCHRONOUS_TOLERANCE = 0.01;
/** Écart relatif sous lequel le verrouillage est EXACT au sens de `bodies.test.ts`. */
const SYNCHRONOUS_EXACT = 1e-9;

export interface SpinDrift {
  body: string;
  /** Dérive de la face tournée vers la planète, en degrés par an. */
  degreesPerYear: number;
}

/**
 * Lunes synchrones dont la période de rotation ne coïncide pas EXACTEMENT avec la période
 * orbitale du catalogue : leur face visible dérive. La rotation est l'intégrale de
 * `rotationSpeed`, donc un écart relatif ε la fait tourner de 360°·ε par révolution.
 */
export function synchronousSpinDrifts(config: CelestialConfig): SpinDrift[] {
  const drifts: SpinDrift[] = [];
  forEachBody(config, ({ name, config: cfg, parentName }) => {
    const orbitDays = cfg.realData?.orbitPeriodDays;
    if (!parentName || !orbitDays || !cfg.rotationSpeed) return;
    const spinDays = (2 * Math.PI) / Math.abs(cfg.rotationSpeed) / 86_400;
    const epsilon = Math.abs(spinDays / orbitDays - 1);
    if (epsilon >= SYNCHRONOUS_TOLERANCE || epsilon < SYNCHRONOUS_EXACT) return;
    drifts.push({
      body: name,
      degreesPerYear: (360 * epsilon * 365.25) / orbitDays,
    });
  });
  return drifts;
}

// ─────────────────────────── contenu ───────────────────────────

const T = {
  title: {
    en: 'Methodology: how Galaxy computes positions',
    fr: 'Méthodologie : comment Galaxy calcule les positions',
    es: 'Metodología: cómo calcula Galaxy las posiciones',
    'pt-BR': 'Metodologia: como a Galaxy calcula as posições',
  },
  description: {
    en: 'Reference frames, JPL Horizons ephemerides, Keplerian orbits, interpolation, scales and known limits of Galaxy, with every position source measured against NASA/JPL Horizons.',
    fr: 'Repères, éphémérides JPL Horizons, orbites képlériennes, interpolation, échelles et limites connues de Galaxy, chaque source de position étant mesurée contre NASA/JPL Horizons.',
    es: 'Marcos de referencia, efemérides JPL Horizons, órbitas keplerianas, interpolación, escalas y límites conocidos de Galaxy, con cada fuente de posición medida contra NASA/JPL Horizons.',
    'pt-BR':
      'Referenciais, efemérides JPL Horizons, órbitas keplerianas, interpolação, escalas e limites conhecidos da Galaxy, com cada fonte de posição medida contra a NASA/JPL Horizons.',
  },
} satisfies Record<string, DocText>;

export interface MethodologyInput {
  summary: ValidationSummary;
  manifest: EphemerisManifest;
  config: CelestialConfig;
  origin: string;
  /** Lue dans `CITATION.cff`, seul endroit où le DOI est écrit (cf. `seo/citation.ts`). */
  citation: CitationMetadata;
}

/**
 * Refuse un résumé qui ne peut pas être publié tel quel. Une page qui afficherait des tableaux
 * vides, ou les chiffres d'une mesure partielle, serait pire que pas de page.
 */
export function assertPublishableSummary(summary: ValidationSummary): void {
  const production = summary.rows.filter((r) => r.provider === 'production');
  if (production.length < 20)
    throw new Error(
      `résumé de validation : ${production.length} ligne(s) « production » seulement`
    );
  if (summary.samplesPerCase < 10)
    throw new Error(
      `résumé de validation : ${summary.samplesPerCase} dates par ligne, mesure non standard`
    );
  for (const row of production)
    if (row.n === 0 || !row.km)
      throw new Error(`résumé de validation : ${row.body} sans mesure`);
}

export function methodologyPages(input: MethodologyInput): DocPage[] {
  assertPublishableSummary(input.summary);
  return DOC_LOCALES.map((locale) => methodologyPage(input, locale));
}

const PROVIDER_TITLES: Record<
  Exclude<ValidationRow['provider'], 'production'>,
  DocText
> = {
  'astronomy-engine': {
    en: 'astronomy-engine (VSOP87 and analytic models)',
    fr: 'astronomy-engine (VSOP87 et modèles analytiques)',
    es: 'astronomy-engine (VSOP87 y modelos analíticos)',
    'pt-BR': 'astronomy-engine (VSOP87 e modelos analíticos)',
  },
  'horizons-binary': {
    en: 'Precomputed JPL Horizons files',
    fr: 'Fichiers JPL Horizons précalculés',
    es: 'Archivos JPL Horizons precalculados',
    'pt-BR': 'Arquivos JPL Horizons pré-calculados',
  },
  kepler: {
    en: 'Keplerian elements (catalogue, moon fallbacks, interstellar objects)',
    fr: 'Éléments képlériens (catalogue, replis des lunes, objets interstellaires)',
    es: 'Elementos keplerianos (catálogo, respaldo de lunas, objetos interestelares)',
    'pt-BR':
      'Elementos keplerianos (catálogo, reserva das luas, objetos interestelares)',
  },
  spk: {
    en: 'SPK kernel SAT441 (measured locally, not enabled on this site)',
    fr: 'Noyau SPK SAT441 (mesuré localement, non activé sur ce site)',
    es: 'Núcleo SPK SAT441 (medido en local, no activado en este sitio)',
    'pt-BR': 'Núcleo SPK SAT441 (medido localmente, não ativado neste site)',
  },
};

function methodologyPage(input: MethodologyInput, locale: DocLocale): DocPage {
  const { summary, manifest, config, origin } = input;
  const L = (text: DocText): string => text[locale];
  const name = displayNameResolver(config);
  const rows = summary.rows;
  const production = rows.filter((r) => r.provider === 'production');
  const spacecraftNames = new Set(SPACECRAFT_MISSIONS.map((m) => m.name));
  const productionOf = (body: string): ValidationRow | undefined =>
    production.find((r) => r.body === body);

  // ── Constantes lues dans le code qui les applique ──
  const obliquityArcsec = (((OBLIQUITY_RAD * 180) / Math.PI) * 3600).toFixed(3);
  const obliquityDeg = ((OBLIQUITY_RAD * 180) / Math.PI).toFixed(7);
  const [lastLeapMs, lastTtMinusUtc] = TT_MINUS_UTC[TT_MINUS_UTC.length - 1]!;
  const lastLeapDate = new Date(lastLeapMs).toISOString().slice(0, 10);

  // ── Manifest des éphémérides ──
  const binaries = Object.entries(manifest.bodies);
  const binarySpacecraft = binaries.filter(([n]) => spacecraftNames.has(n));
  const binaryNatural = binaries.filter(([n]) => !spacecraftNames.has(n));
  const stepsOf = (entries: typeof binaries): number[] =>
    [...new Set(entries.map(([, e]) => e.stepDays))].sort((a, b) => a - b);
  const naturalSteps = stepsOf(binaryNatural);
  const spacecraftSteps = stepsOf(binarySpacecraft);
  const finestSpacecraft = binarySpacecraft
    .filter(([, e]) => e.stepDays === spacecraftSteps[0])
    .map(([n]) => n);
  const listNames = (names: readonly string[]): string =>
    names.map((n) => escapeHtml(name(n, locale))).join(', ');
  // « 4, 8, 16 ou 64 » : depuis le lot 11 les pas des fichiers naturels sont quatre, et une
  // jonction par « ou » seul écrivait « 4 ou 8 ou 16 ou 64 ».
  const days = (values: readonly number[]): string => {
    const text = values.map((v) => exact(v, locale));
    const last = text.pop();
    if (text.length === 0) return last ?? '';
    return `${text.join(', ')}${OR[locale]}${last}`;
  };
  const num = (v: number | null | undefined): string => q(v, locale);

  // ── Petits corps, objets interstellaires, lunes ──
  const barycentric = SMALL_BODY_ELEMENTS.filter((el) => el.barycentric).length;
  const keplerOnly = production.filter(
    (r) => Object.keys(r.sources).length === 1 && r.sources.kepler
  );
  const moonFallbacks = [...flattenBodies(config).values()].filter(
    (cfg) => cfg.relativeOrbitalElements
  ).length;
  const drifts = synchronousSpinDrifts(config);
  // Planètes dont les lunes sont écartées en Éducatif (facteur > 1), lu dans le module qui
  // l'applique à la position ET à la ligne d'orbite.
  const spreadParents = Object.entries(config.bodies)
    .filter(([, cfg]) => educationalParentOrbitScale(cfg) > 1)
    .map(([parentName]) => parentName);

  /**
   * Une année telle qu'un lecteur l'écrit : « 9998 av. J.-C. » pour l'année astronomique -9997.
   * Les dates restent dans le calendrier grégorien prolongé dans le passé, et la page le dit.
   */
  const yearText = (iso: string): string => {
    const n = yearNumber(iso);
    return n >= 1
      ? String(n)
      : `${1 - n} ${L({ en: 'BC', fr: 'av. J.-C.', es: 'a. C.', 'pt-BR': 'a.C.' })}`;
  };

  /** Libellé d'une fenêtre de mesure, dans la langue de la page. */
  const windowLabel = (r: ValidationRow): string => {
    const span = `${yearText(r.windowFrom)}–${yearText(r.windowTo)}`;
    const clipped = r.windowClipped
      ? L({
          en: ' (limited to Horizons coverage)',
          fr: ' (limitée à la couverture Horizons)',
          es: ' (limitado a la cobertura de Horizons)',
          'pt-BR': ' (limitado à cobertura da Horizons)',
        })
      : '';
    switch (r.windowKind) {
      case 'binary':
        return `${escapeHtml(r.windowFrom)} → ${escapeHtml(r.windowTo)}`;
      case 'epoch':
        return (
          L({
            en: 'epoch ±10 yr',
            fr: 'époque ±10 ans',
            es: 'época ±10 años',
            'pt-BR': 'época ±10 anos',
          }) + ` (${span})${clipped}`
        );
      case 'perihelion':
        return (
          L({
            en: `perihelion ±${INTERSTELLAR_WINDOW_YEARS} yr`,
            fr: `périhélie ±${INTERSTELLAR_WINDOW_YEARS} ans`,
            es: `perihelio ±${INTERSTELLAR_WINDOW_YEARS} años`,
            'pt-BR': `periélio ±${INTERSTELLAR_WINDOW_YEARS} anos`,
          }) + ` (${span})${clipped}`
        );
      default:
        return `${span}${clipped}`;
    }
  };

  const sections: string[] = [];

  // 1. Repères
  sections.push(
    docSection(
      'frames',
      L({
        en: 'Reference frames',
        fr: 'Repères',
        es: 'Marcos de referencia',
        'pt-BR': 'Referenciais',
      }),
      `<p>${L({
        en: `Every position is a <strong>geometric</strong> position, with no light-time or aberration correction: where a body is at that instant, not where it appears from Earth. Galaxy works in the <strong>J2000 ecliptic</strong> frame, the frame of the JPL Horizons files and of the orbital elements. astronomy-engine returns J2000 equatorial vectors (ICRF axes); they are rotated into the ecliptic by the J2000 obliquity, ε = ${exact(Number(obliquityArcsec), locale)}″ (${exact(Number(obliquityDeg), locale)}°), the IAU 1976 value that defines the Horizons ecliptic, so that every source shares one frame.`,
        fr: `Chaque position est une position <strong>géométrique</strong>, sans correction de temps de lumière ni d’aberration : où se trouve le corps à cet instant, pas où il paraît depuis la Terre. Galaxy travaille dans l’<strong>écliptique J2000</strong>, le repère des fichiers JPL Horizons et des éléments orbitaux. astronomy-engine fournit des vecteurs équatoriaux J2000 (axes ICRF) ; ils sont tournés vers l’écliptique d’un angle égal à l’obliquité J2000, ε = ${exact(Number(obliquityArcsec), locale)}″ (${exact(Number(obliquityDeg), locale)}°), la valeur IAU 1976 qui définit l’écliptique d’Horizons, pour que toutes les sources partagent un même repère.`,
        es: `Cada posición es una posición <strong>geométrica</strong>, sin corrección de tiempo de luz ni de aberración: dónde está un cuerpo en ese instante, no dónde se ve desde la Tierra. Galaxy trabaja en el marco <strong>eclíptico J2000</strong>, el de los archivos JPL Horizons y de los elementos orbitales. astronomy-engine devuelve vectores ecuatoriales J2000 (ejes ICRF); se rotan a la eclíptica por la oblicuidad J2000, ε = ${exact(Number(obliquityArcsec), locale)}″ (${exact(Number(obliquityDeg), locale)}°), el valor IAU 1976 que define la eclíptica de Horizons, de modo que todas las fuentes comparten un marco.`,
        'pt-BR': `Cada posição é uma posição <strong>geométrica</strong>, sem correção de tempo de luz nem de aberração: onde um corpo está naquele instante, não onde ele aparece visto da Terra. A Galaxy trabalha no referencial <strong>eclíptico J2000</strong>, o dos arquivos JPL Horizons e dos elementos orbitais. A astronomy-engine devolve vetores equatoriais J2000 (eixos ICRF); eles são rotacionados para a eclíptica pela obliquidade J2000, ε = ${exact(Number(obliquityArcsec), locale)}″ (${exact(Number(obliquityDeg), locale)}°), o valor IAU 1976 que define a eclíptica da Horizons, de modo que todas as fontes compartilham um referencial.`,
      })}</p><p>${L({
        en: 'The Sun is fixed at the origin: positions are heliocentric. The 3D scene maps the ecliptic onto its horizontal plane: scene X = ecliptic x, scene Y = ecliptic z (towards the north ecliptic pole), scene Z = −ecliptic y. This is a proper rotation (determinant +1), not a mirror, so orbits keep their true direction of travel.',
        fr: 'Le Soleil est fixé à l’origine : les positions sont héliocentriques. La scène 3D place l’écliptique dans son plan horizontal : X scène = x écliptique, Y scène = z écliptique (vers le pôle nord de l’écliptique), Z scène = −y écliptique. C’est une rotation propre (déterminant +1), pas un miroir : les orbites gardent leur vrai sens de parcours.',
        es: 'El Sol está fijo en el origen: las posiciones son heliocéntricas. La escena 3D proyecta la eclíptica sobre su plano horizontal: X de escena = x eclíptica, Y de escena = z eclíptica (hacia el polo norte eclíptico), Z de escena = −y eclíptica. Es una rotación propia (determinante +1), no un espejo, así que las órbitas conservan su verdadero sentido de recorrido.',
        'pt-BR':
          'O Sol está fixo na origem: as posições são heliocêntricas. A cena 3D projeta a eclíptica sobre o seu plano horizontal: X da cena = x eclíptico, Y da cena = z eclíptico (na direção do polo norte eclíptico), Z da cena = −y eclíptico. É uma rotação própria (determinante +1), não um espelho, então as órbitas conservam o seu verdadeiro sentido de percurso.',
      })}</p>`
    )
  );

  // 2. Temps
  sections.push(
    docSection(
      'time',
      L({
        en: 'Time scale',
        fr: 'Échelle de temps',
        es: 'Escala de tiempo',
        'pt-BR': 'Escala de tempo',
      }),
      `<p>${L({
        en: `The date you choose is read as UTC. From 1972 onwards it is converted to Terrestrial Time with the table of leap seconds, held constant after the last one (TT − UTC = ${exact(lastTtMinusUtc, locale)} s since ${lastLeapDate}), which is the convention JPL Horizons applies to dates given in UT. Before 1972 the date is read as UT1 and ΔT = TT − UT1 follows the Espenak and Meeus model. A single module performs this conversion for every source, and installs it into astronomy-engine, so two sources never disagree about which instant is meant.`,
        fr: `La date choisie est lue en UTC. À partir de 1972, elle est convertie en Temps terrestre par la table des secondes intercalaires, maintenue constante après la dernière (TT − UTC = ${exact(lastTtMinusUtc, locale)} s depuis le ${lastLeapDate}), ce qui est la convention appliquée par JPL Horizons aux dates données en UT. Avant 1972, la date est lue comme UT1 et ΔT = TT − UT1 suit le modèle d’Espenak et Meeus. Un seul module fait cette conversion pour toutes les sources, et l’installe dans astronomy-engine : deux sources ne peuvent pas désigner deux instants différents.`,
        es: `La fecha que elige se lee como UTC. Desde 1972 se convierte a Tiempo Terrestre con la tabla de segundos intercalares, mantenida constante después del último (TT − UTC = ${exact(lastTtMinusUtc, locale)} s desde ${lastLeapDate}), que es la convención que JPL Horizons aplica a las fechas dadas en UT. Antes de 1972 la fecha se lee como UT1 y ΔT = TT − UT1 sigue el modelo de Espenak y Meeus. Un único módulo realiza esta conversión para todas las fuentes, y la instala en astronomy-engine, de modo que dos fuentes nunca discrepan sobre qué instante se designa.`,
        'pt-BR': `A data que você escolhe é lida como UTC. A partir de 1972 ela é convertida em Tempo Terrestre com a tabela de segundos intercalares, mantida constante depois do último (TT − UTC = ${exact(lastTtMinusUtc, locale)} s desde ${lastLeapDate}), que é a convenção que a JPL Horizons aplica às datas dadas em UT. Antes de 1972 a data é lida como UT1 e ΔT = TT − UT1 segue o modelo de Espenak e Meeus. Um único módulo faz essa conversão para todas as fontes, e a instala na astronomy-engine, de modo que duas fontes nunca discordam sobre qual instante se designa.`,
      })}</p>`
    )
  );

  // 3. Sources de position
  sections.push(
    docSection(
      'sources',
      L({
        en: 'Where each position comes from',
        fr: 'D’où vient chaque position',
        es: 'De dónde viene cada posición',
        'pt-BR': 'De onde vem cada posição',
      }),
      `<p>${L({
        en: 'For a planet, a moon or a small body, Galaxy tries the following sources in order and keeps the first that answers:',
        fr: 'Pour une planète, une lune ou un petit corps, Galaxy essaie les sources suivantes dans cet ordre et garde la première qui répond :',
        es: 'Para un planeta, una luna o un cuerpo menor, Galaxy prueba las fuentes siguientes en orden y conserva la primera que responde:',
        'pt-BR':
          'Para um planeta, uma lua ou um corpo menor, a Galaxy tenta as fontes seguintes em ordem e mantém a primeira que responde:',
      })}</p><ol class="doc-list">` +
        `<li>${L({
          en: `<strong>A JPL SPK kernel</strong> (SAT441, Saturn’s moons), when the site is configured to serve one. It then takes precedence over the Horizons files. ${summary.spk.enabledInProduction ? 'It is <strong>enabled</strong> on this site.' : 'It is <strong>not enabled</strong> on this site.'}`,
          fr: `<strong>Un noyau SPK du JPL</strong> (SAT441, lunes de Saturne), quand le site est configuré pour en servir un. Il passe alors avant les fichiers Horizons. ${summary.spk.enabledInProduction ? 'Il est <strong>activé</strong> sur ce site.' : 'Il n’est <strong>pas activé</strong> sur ce site.'}`,
          es: `<strong>Un núcleo SPK del JPL</strong> (SAT441, las lunas de Saturno), cuando el sitio está configurado para servirlo. Tiene entonces prioridad sobre los archivos Horizons. ${summary.spk.enabledInProduction ? 'Está <strong>activado</strong> en este sitio.' : 'No está <strong>activado</strong> en este sitio.'}`,
          'pt-BR': `<strong>Um núcleo SPK do JPL</strong> (SAT441, as luas de Saturno), quando o site está configurado para servi-lo. Ele tem então prioridade sobre os arquivos Horizons. ${summary.spk.enabledInProduction ? 'Ele está <strong>ativado</strong> neste site.' : 'Ele <strong>não está ativado</strong> neste site.'}`,
        })}</li>` +
        `<li>${L({
          en: `<strong>Precomputed NASA/JPL Horizons files</strong> for ${binaryNatural.length} natural bodies: exact position and velocity states in the ${escapeHtml(manifest.frame)} frame, every ${days(naturalSteps)} days depending on the body, between ${escapeHtml(manifest.coverage.start)} and ${escapeHtml(manifest.coverage.stop)}; the <a href="${docPath('sources', locale)}">sources page</a> gives each file’s step and exact range. A value from a file is compared with the body’s catalogue orbit and rejected if its distance is implausibly large or small; the next source then takes over.`,
          fr: `<strong>Fichiers NASA/JPL Horizons précalculés</strong> pour ${binaryNatural.length} corps naturels : états exacts de position et de vitesse dans le repère ${escapeHtml(manifest.frame)}, tous les ${days(naturalSteps)} jours selon le corps, entre le ${escapeHtml(manifest.coverage.start)} et le ${escapeHtml(manifest.coverage.stop)} ; la <a href="${docPath('sources', locale)}">page des sources</a> donne le pas et la plage exacte de chaque fichier. Une valeur issue d’un fichier est confrontée à l’orbite du corps dans le catalogue et rejetée si sa distance est trop grande ou trop petite pour être plausible ; la source suivante prend alors le relais.`,
          es: `<strong>Archivos NASA/JPL Horizons precalculados</strong> para ${binaryNatural.length} cuerpos naturales: estados exactos de posición y velocidad en el marco ${escapeHtml(manifest.frame)}, cada ${days(naturalSteps)} días según el cuerpo, entre ${escapeHtml(manifest.coverage.start)} y ${escapeHtml(manifest.coverage.stop)}; la <a href="${docPath('sources', locale)}">página de fuentes</a> da el paso y el rango exacto de cada archivo. Un valor de un archivo se compara con la órbita del cuerpo en el catálogo y se rechaza si su distancia es inverosímilmente grande o pequeña; la fuente siguiente toma entonces el relevo.`,
          'pt-BR': `<strong>Arquivos NASA/JPL Horizons pré-calculados</strong> para ${binaryNatural.length} corpos naturais: estados exatos de posição e velocidade no referencial ${escapeHtml(manifest.frame)}, a cada ${days(naturalSteps)} dias conforme o corpo, entre ${escapeHtml(manifest.coverage.start)} e ${escapeHtml(manifest.coverage.stop)}; a <a href="${docPath('sources', locale)}">página de fontes</a> dá o passo e o intervalo exato de cada arquivo. Um valor de um arquivo é comparado com a órbita do corpo no catálogo e recusado se a sua distância for implausivelmente grande ou pequena; a fonte seguinte assume então.`,
        })}</li>` +
        `<li>${L({
          en: '<strong>astronomy-engine</strong>, an open-source library: VSOP87 for the planets, and analytic models for the Moon and the four Galilean moons.',
          fr: '<strong>astronomy-engine</strong>, une bibliothèque libre : VSOP87 pour les planètes, et des modèles analytiques pour la Lune et les quatre lunes galiléennes.',
          es: '<strong>astronomy-engine</strong>, una biblioteca de código abierto: VSOP87 para los planetas, y modelos analíticos para la Luna y las cuatro lunas galileanas.',
          'pt-BR':
            '<strong>astronomy-engine</strong>, uma biblioteca de código aberto: VSOP87 para os planetas, e modelos analíticos para a Lua e as quatro luas galileanas.',
        })}</li>` +
        `<li>${L({
          en: `<strong>Keplerian orbital elements</strong>: ${SMALL_BODY_ELEMENTS.length} small bodies, whose osculating elements come from Horizons at a stated epoch and are checked by a test against a Horizons position at that epoch (${barycentric} of them are referred to the Solar System barycentre: beyond Neptune, a heliocentric orbit carries the Sun’s own reflex motion); and a fallback for ${moonFallbacks} moons, derived by script from their Horizons files, used only when a file is missing, out of range or rejected.`,
          fr: `<strong>Éléments orbitaux képlériens</strong> : ${SMALL_BODY_ELEMENTS.length} petits corps, dont les éléments osculateurs viennent d’Horizons à une époque déclarée et qu’un test confronte à une position Horizons à cette époque (${barycentric} d’entre eux sont rapportés au barycentre du Système solaire : au-delà de Neptune, une orbite héliocentrique porte le mouvement réflexe du Soleil lui-même) ; et un repli pour ${moonFallbacks} lunes, dérivé par script de leurs fichiers Horizons, utilisé seulement quand un fichier manque, sort de sa couverture ou est rejeté.`,
          es: `<strong>Elementos orbitales keplerianos</strong>: ${SMALL_BODY_ELEMENTS.length} cuerpos menores, cuyos elementos osculadores vienen de Horizons en una época declarada y son verificados por una prueba contra una posición de Horizons en esa época (${barycentric} de ellos están referidos al baricentro del Sistema Solar: más allá de Neptuno, una órbita heliocéntrica arrastra el propio movimiento de retroceso del Sol); y un respaldo para ${moonFallbacks} lunas, derivado por script de sus archivos Horizons, usado solo cuando un archivo falta, está fuera de rango o es rechazado.`,
          'pt-BR': `<strong>Elementos orbitais keplerianos</strong>: ${SMALL_BODY_ELEMENTS.length} corpos menores, cujos elementos osculadores vêm da Horizons em uma época declarada e são verificados por um teste contra uma posição da Horizons nessa época (${barycentric} deles são referidos ao baricentro do Sistema Solar: além de Netuno, uma órbita heliocêntrica carrega o próprio movimento de recuo do Sol); e uma reserva para ${moonFallbacks} luas, derivada por script dos seus arquivos Horizons, usada somente quando um arquivo falta, está fora do intervalo ou é recusado.`,
        })}</li></ol><p>${L({
          en: `The ${binarySpacecraft.length} spacecraft and the ${INTERSTELLAR_OBJECTS.length} interstellar objects follow their own rule. A spacecraft is positioned only by its Horizons file, sampled at a step of ${days(spacecraftSteps)} days (${exact(spacecraftSteps[0]!, locale)} for: ${listNames(finestSpacecraft)}), and is not drawn outside the file’s coverage. An interstellar object is positioned by its hyperbolic elements and drawn only within ±${INTERSTELLAR_WINDOW_YEARS} years of perihelion, the range over which they were checked against Horizons.`,
          fr: `Les ${binarySpacecraft.length} sondes et les ${INTERSTELLAR_OBJECTS.length} objets interstellaires suivent leur propre règle. Une sonde est positionnée uniquement par son fichier Horizons, échantillonné à un pas de ${days(spacecraftSteps)} jours (${exact(spacecraftSteps[0]!, locale)} jour pour : ${listNames(finestSpacecraft)}), et n’est pas dessinée hors de la couverture de ce fichier. Un objet interstellaire est positionné par ses éléments hyperboliques et dessiné seulement à ±${INTERSTELLAR_WINDOW_YEARS} ans de son périhélie, la plage sur laquelle ils ont été vérifiés contre Horizons.`,
          es: `Las ${binarySpacecraft.length} sondas y los ${INTERSTELLAR_OBJECTS.length} objetos interestelares siguen su propia regla. Una sonda se sitúa únicamente por su archivo Horizons, muestreado con un paso de ${days(spacecraftSteps)} días (${exact(spacecraftSteps[0]!, locale)} para: ${listNames(finestSpacecraft)}), y no se dibuja fuera de la cobertura del archivo. Un objeto interestelar se sitúa por sus elementos hiperbólicos y solo se dibuja dentro de ±${INTERSTELLAR_WINDOW_YEARS} años del perihelio, el rango en el que fueron verificados contra Horizons.`,
          'pt-BR': `As ${binarySpacecraft.length} sondas e os ${INTERSTELLAR_OBJECTS.length} objetos interestelares seguem a sua própria regra. Uma sonda é posicionada unicamente pelo seu arquivo Horizons, amostrado com um passo de ${days(spacecraftSteps)} dias (${exact(spacecraftSteps[0]!, locale)} para: ${listNames(finestSpacecraft)}), e não é desenhada fora da cobertura do arquivo. Um objeto interestelar é posicionado pelos seus elementos hiperbólicos e desenhado somente dentro de ±${INTERSTELLAR_WINDOW_YEARS} anos do periélio, o intervalo no qual eles foram verificados contra a Horizons.`,
        })}</p>`
    )
  );

  // 4. Interpolation
  sections.push(
    docSection(
      'interpolation',
      L({
        en: 'Between two samples: conditional interpolation',
        fr: 'Entre deux échantillons : interpolation conditionnelle',
        es: 'Entre dos muestras: interpolación condicional',
        'pt-BR': 'Entre duas amostras: interpolação condicional',
      }),
      `<p>${L({
        en: `A Horizons file holds exact states at a fixed step. Between two of them, a cubic (Hermite) curve is only valid if the body moves smoothly over the interval, which is false as soon as it completes several turns within one step. Galaxy therefore counts how many samples one revolution spans, using the catalogue’s mean period. From ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} samples per orbit upwards it uses the cubic. Below that, it propagates each of the two surrounding states along its own two-body orbit and blends them smoothly, so both ends stay exactly on the data.`,
        fr: `Un fichier Horizons contient des états exacts à pas fixe. Entre deux d’entre eux, une courbe cubique (Hermite) n’est valable que si le corps se déplace régulièrement sur l’intervalle, ce qui est faux dès qu’il fait plusieurs tours en un pas. Galaxy compte donc combien d’échantillons couvre une révolution, d’après la période moyenne du catalogue. À partir de ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} échantillons par orbite, il emploie la cubique. En dessous, il propage chacun des deux états qui encadrent la date le long de sa propre orbite à deux corps, puis les fond progressivement : chaque extrémité reste exactement sur les données.`,
        es: `Un archivo Horizons contiene estados exactos con un paso fijo. Entre dos de ellos, una curva cúbica (de Hermite) solo es válida si el cuerpo se mueve suavemente en el intervalo, lo que es falso en cuanto da varias vueltas dentro de un paso. Galaxy cuenta por tanto cuántas muestras abarca una revolución, usando el periodo medio del catálogo. A partir de ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} muestras por órbita usa la cúbica. Por debajo, propaga cada uno de los dos estados que rodean la fecha a lo largo de su propia órbita de dos cuerpos y los mezcla suavemente, de modo que ambos extremos siguen exactamente sobre los datos.`,
        'pt-BR': `Um arquivo Horizons contém estados exatos com um passo fixo. Entre dois deles, uma curva cúbica (de Hermite) só é válida se o corpo se mover suavemente no intervalo, o que é falso assim que ele dá várias voltas dentro de um passo. A Galaxy conta então quantas amostras uma revolução abrange, usando o período médio do catálogo. A partir de ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} amostras por órbita ela usa a cúbica. Abaixo disso, ela propaga cada um dos dois estados que cercam a data ao longo da sua própria órbita de dois corpos e os mistura suavemente, de modo que as duas extremidades permanecem exatamente sobre os dados.`,
      })}</p><p>${L({
        en: 'Two refinements follow the same rule, keeping the data and linking it with the right curve. When a moon is massive enough to pull its planet around a shared barycentre (Charon and Pluto), that wobble is removed before interpolation and added back at the requested date. For a declared list of moons close to a flattened planet, the conic is travelled at the measured mean rate rather than the instantaneous one.',
        fr: 'Deux raffinements suivent la même règle, garder les données et les relier par la bonne courbe. Quand une lune est assez massive pour faire tourner sa planète autour d’un barycentre commun (Charon et Pluton), ce ballant est retiré avant l’interpolation puis rajouté à la date demandée. Pour une liste déclarée de lunes proches d’une planète aplatie, la conique est parcourue au rythme moyen mesuré plutôt qu’au rythme instantané.',
        es: 'Dos refinamientos siguen la misma regla, conservando los datos y uniéndolos con la curva adecuada. Cuando una luna es lo bastante masiva para arrastrar a su planeta alrededor de un baricentro común (Caronte y Plutón), ese bamboleo se retira antes de interpolar y se vuelve a añadir en la fecha pedida. Para una lista declarada de lunas cercanas a un planeta achatado, la cónica se recorre al ritmo medio medido y no al instantáneo.',
        'pt-BR':
          'Dois refinamentos seguem a mesma regra, conservando os dados e ligando-os com a curva adequada. Quando uma lua é massiva o bastante para arrastar o seu planeta em torno de um baricentro comum (Caronte e Plutão), essa oscilação é retirada antes da interpolação e reposta na data pedida. Para uma lista declarada de luas próximas de um planeta achatado, a cônica é percorrida no ritmo médio medido e não no instantâneo.',
      })}</p>`
    )
  );

  // 5. Kepler
  sections.push(
    docSection(
      'kepler',
      L({
        en: 'Keplerian orbits: ellipses and hyperbolas',
        fr: 'Orbites képlériennes : ellipses et hyperboles',
        es: 'Órbitas keplerianas: elipses e hipérbolas',
        'pt-BR': 'Órbitas keplerianas: elipses e hipérboles',
      }),
      `<p>${L({
        en: 'For a closed orbit (eccentricity below 1), Kepler’s equation M = E − e sin E is solved for the eccentric anomaly. For an open orbit (eccentricity above 1, the interstellar objects), the hyperbolic form M = e sinh F − F is solved instead; the mean anomaly is then not an angle and is never reduced modulo 360°.',
        fr: 'Pour une orbite fermée (excentricité inférieure à 1), l’équation de Kepler M = E − e sin E est résolue pour l’anomalie excentrique. Pour une orbite ouverte (excentricité supérieure à 1, les objets interstellaires), c’est la forme hyperbolique M = e sinh F − F qui est résolue ; l’anomalie moyenne n’est alors pas un angle et n’est jamais ramenée modulo 360°.',
        es: 'Para una órbita cerrada (excentricidad menor que 1) se resuelve la ecuación de Kepler M = E − e sin E para la anomalía excéntrica. Para una órbita abierta (excentricidad mayor que 1, los objetos interestelares) se resuelve en su lugar la forma hiperbólica M = e sinh F − F; la anomalía media no es entonces un ángulo y nunca se reduce módulo 360°.',
        'pt-BR':
          'Para uma órbita fechada (excentricidade menor que 1) resolve-se a equação de Kepler M = E − e sin E para a anomalia excêntrica. Para uma órbita aberta (excentricidade maior que 1, os objetos interestelares) resolve-se em vez disso a forma hiperbólica M = e sinh F − F; a anomalia média não é então um ângulo e nunca é reduzida módulo 360°.',
      })}</p><p>${L({
        en: `A small body orbiting the Sun moves at the rate set by the Sun’s gravitational parameter. A moon’s elements are referred to its planet, and its rate comes from its measured mean sidereal period, not from the Sun, nor from the instantaneous state the elements were taken from. Orbit lines of orbits with an eccentricity of ${exact(ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY, locale)} or more are sampled evenly in eccentric anomaly rather than in time, so that they reach their true closest point; hyperbolic trajectories are sampled evenly in hyperbolic anomaly.`,
        fr: `Un petit corps en orbite autour du Soleil se déplace au rythme fixé par le paramètre gravitationnel du Soleil. Les éléments d’une lune sont rapportés à sa planète, et son rythme vient de sa période sidérale moyenne mesurée, et non du Soleil ni de l’état instantané d’où les éléments ont été tirés. Les lignes des orbites d’excentricité ${exact(ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY, locale)} ou plus sont échantillonnées régulièrement en anomalie excentrique plutôt que dans le temps, pour atteindre leur vrai point le plus proche ; les trajectoires hyperboliques le sont en anomalie hyperbolique.`,
        es: `Un cuerpo menor que orbita el Sol se mueve al ritmo fijado por el parámetro gravitacional del Sol. Los elementos de una luna están referidos a su planeta, y su ritmo viene de su periodo sidéreo medio medido, no del Sol, ni del estado instantáneo del que se tomaron los elementos. Las líneas de órbita de excentricidad igual o superior a ${exact(ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY, locale)} se muestrean uniformemente en anomalía excéntrica y no en el tiempo, para que alcancen su verdadero punto más cercano; las trayectorias hiperbólicas se muestrean uniformemente en anomalía hiperbólica.`,
        'pt-BR': `Um corpo menor que orbita o Sol se move no ritmo fixado pelo parâmetro gravitacional do Sol. Os elementos de uma lua são referidos ao seu planeta, e o seu ritmo vem do seu período sideral médio medido, não do Sol, nem do estado instantâneo de onde os elementos foram tirados. As linhas de órbita de excentricidade igual ou superior a ${exact(ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY, locale)} são amostradas uniformemente em anomalia excêntrica e não no tempo, para que alcancem o seu verdadeiro ponto mais próximo; as trajetórias hiperbólicas são amostradas uniformemente em anomalia hiperbólica.`,
      })}</p>`
    )
  );

  // 6. SPK
  const spkRows = rows.filter(
    (r) => r.provider === 'spk' && r.n > 0 && r.relative
  );
  sections.push(
    docSection(
      'spk',
      L({
        en: 'SPK kernel',
        fr: 'Noyau SPK',
        es: 'Núcleo SPK',
        'pt-BR': 'Núcleo SPK',
      }),
      `<p>${L({
        en: 'SPK is JPL’s binary format for high-precision ephemerides. Galaxy can read the SAT441 kernel for Saturn’s moons in a background worker, by HTTP range requests, composing segments through their common centre when the kernel stores no direct pair.',
        fr: 'SPK est le format binaire du JPL pour les éphémérides de haute précision. Galaxy sait lire le noyau SAT441 des lunes de Saturne dans un worker en arrière-plan, par requêtes HTTP partielles, en composant les segments par leur centre commun quand le noyau ne stocke pas la paire directe.',
        es: 'SPK es el formato binario del JPL para efemérides de alta precisión. Galaxy puede leer el núcleo SAT441 de las lunas de Saturno en un trabajador de fondo, por peticiones HTTP de rango, componiendo segmentos a través de su centro común cuando el núcleo no guarda ningún par directo.',
        'pt-BR':
          'SPK é o formato binário do JPL para efemérides de alta precisão. A Galaxy pode ler o núcleo SAT441 das luas de Saturno em um trabalhador de fundo, por requisições HTTP de intervalo, compondo segmentos através do seu centro comum quando o núcleo não guarda nenhum par direto.',
      })} ${L(
        summary.spk.enabledInProduction
          ? {
              en: 'It is <strong>enabled</strong> on this site.',
              fr: 'Il est <strong>activé</strong> sur ce site.',
              es: 'Está <strong>activado</strong> en este sitio.',
              'pt-BR': 'Ele está <strong>ativado</strong> neste site.',
            }
          : {
              en: 'It is <strong>not enabled</strong> on this site, so Saturn’s moons use the Horizons files; the figures below were measured locally with the kernel.',
              fr: 'Il n’est <strong>pas activé</strong> sur ce site : les lunes de Saturne utilisent donc les fichiers Horizons ; les chiffres ci-dessous ont été mesurés localement avec le noyau.',
              es: 'No está <strong>activado</strong> en este sitio, así que las lunas de Saturno usan los archivos Horizons; las cifras siguientes se midieron en local con el núcleo.',
              'pt-BR':
                'Ele <strong>não está ativado</strong> neste site, então as luas de Saturno usam os arquivos Horizons; os números abaixo foram medidos localmente com o núcleo.',
            }
      )}</p>` +
        (spkRows.length > 0
          ? docTable(
              L({
                en: 'SPK path against Horizons, position relative to Saturn',
                fr: 'Chemin SPK contre Horizons, position relative à Saturne',
                es: 'Vía SPK contra Horizons, posición relativa a Saturno',
                'pt-BR':
                  'Via SPK contra a Horizons, posição relativa a Saturno',
              }),
              [
                L({ en: 'Moon', fr: 'Lune', es: 'Luna', 'pt-BR': 'Lua' }),
                L({
                  en: 'Window',
                  fr: 'Fenêtre',
                  es: 'Ventana',
                  'pt-BR': 'Janela',
                }),
                L({
                  en: 'Mean (km)',
                  fr: 'Moyenne (km)',
                  es: 'Media (km)',
                  'pt-BR': 'Média (km)',
                }),
                L({
                  en: 'Max (km)',
                  fr: 'Max (km)',
                  es: 'Máx. (km)',
                  'pt-BR': 'Máx. (km)',
                }),
              ],
              spkRows.map((r) => [
                escapeHtml(name(r.body, locale)),
                windowLabel(r),
                num(r.km?.mean),
                num(r.km?.max),
              ]),
              2
            )
          : '')
    )
  );

  // 7. Échelles
  sections.push(
    docSection(
      'scales',
      L({
        en: 'Educational and Explore scales',
        fr: 'Échelles Éducative et Exploration',
        es: 'Escalas Educativa y Exploración',
        'pt-BR': 'Escalas Educativa e Exploração',
      }),
      `<p>${L({
        en: `Positions are computed in astronomical units (AU), then placed in the scene with a single constant K = ${SQRT_K} scene units, so that the Earth, at 1 AU, sits at ${SQRT_K} units in both modes. Only the display changes between the two modes; the computed position is the same.`,
        fr: `Les positions sont calculées en unités astronomiques (UA), puis placées dans la scène avec une seule constante K = ${SQRT_K} unités de scène : la Terre, à 1 UA, est à ${SQRT_K} unités dans les deux modes. Seul l’affichage change entre les deux modes ; la position calculée est la même.`,
        es: `Las posiciones se calculan en unidades astronómicas (UA) y luego se colocan en la escena con una única constante K = ${SQRT_K} unidades de escena, de modo que la Tierra, a 1 UA, queda a ${SQRT_K} unidades en ambos modos. Solo cambia la visualización entre los dos modos; la posición calculada es la misma.`,
        'pt-BR': `As posições são calculadas em unidades astronômicas (UA) e depois colocadas na cena com uma única constante K = ${SQRT_K} unidades de cena, de modo que a Terra, a 1 UA, fica a ${SQRT_K} unidades nos dois modos. Só a exibição muda entre os dois modos; a posição calculada é a mesma.`,
      })}</p><ul class="doc-list"><li>${L({
        en: `<strong>Explore</strong> is true scale: distance = AU × ${SQRT_K}, and every body has its physical radius. A distant body can be too small to see, exactly as in space; navigation aids are drawn as labels, never by enlarging a body, and the optical zoom changes only the camera’s field of view.`,
        fr: `<strong>Exploration</strong> est à l’échelle réelle : distance = UA × ${SQRT_K}, et chaque corps a son rayon physique. Un corps lointain peut être trop petit pour être vu, exactement comme dans l’espace ; les aides à la navigation sont des étiquettes, jamais un corps agrandi, et le zoom optique ne change que le champ de la caméra.`,
        es: `<strong>Exploración</strong> es a escala real: distancia = UA × ${SQRT_K}, y cada cuerpo tiene su radio físico. Un cuerpo lejano puede ser demasiado pequeño para verse, exactamente como en el espacio; las ayudas a la navegación se dibujan como etiquetas, nunca agrandando un cuerpo, y el zoom óptico solo cambia el campo de visión de la cámara.`,
        'pt-BR': `<strong>Exploração</strong> é em escala real: distância = UA × ${SQRT_K}, e cada corpo tem o seu raio físico. Um corpo distante pode ser pequeno demais para ser visto, exatamente como no espaço; os auxílios à navegação são desenhados como rótulos, nunca aumentando um corpo, e o zoom óptico só muda o campo de visão da câmera.`,
      })}</li><li>${L({
        en: `<strong>Educational</strong> is not to scale: distances are compressed to √AU × ${SQRT_K} along the true direction, and bodies are drawn at enlarged teaching sizes so that all of them stay visible. Around ${listNames(spreadParents)}, the moons’ distances are then multiplied by one common factor per planet, the smallest that keeps every moon outside its enlarged planet, so their order of distance is preserved. Eccentric orbits keep their shape.`,
        fr: `<strong>Éducatif</strong> n’est pas à l’échelle : les distances sont compressées en √UA × ${SQRT_K} dans la vraie direction, et les corps sont dessinés à des tailles pédagogiques agrandies pour rester tous visibles. Autour de ${listNames(spreadParents)}, les distances des lunes sont ensuite multipliées par un facteur commun à chaque planète, le plus petit qui garde chaque lune hors de sa planète agrandie : leur ordre de distance est conservé. Les orbites excentriques gardent leur forme.`,
        es: `<strong>Educativa</strong> no está a escala: las distancias se comprimen a √UA × ${SQRT_K} a lo largo de la dirección verdadera, y los cuerpos se dibujan en tamaños didácticos ampliados para que todos sigan visibles. Alrededor de ${listNames(spreadParents)}, las distancias de las lunas se multiplican además por un factor común por planeta, el más pequeño que mantiene cada luna fuera de su planeta ampliado, de modo que se conserva su orden de distancia. Las órbitas excéntricas conservan su forma.`,
        'pt-BR': `<strong>Educativa</strong> não está em escala: as distâncias são comprimidas para √UA × ${SQRT_K} ao longo da direção verdadeira, e os corpos são desenhados em tamanhos didáticos ampliados para que todos permaneçam visíveis. Em torno de ${listNames(spreadParents)}, as distâncias das luas são ainda multiplicadas por um fator comum por planeta, o menor que mantém cada lua fora do seu planeta ampliado, de modo que a sua ordem de distância é preservada. As órbitas excêntricas conservam a sua forma.`,
      })}</li></ul>`
    )
  );

  // 8. Validation
  const method = `<p>${L({
    en: `Every source is compared with the NASA/JPL Horizons API (geometric state vectors, J2000 ecliptic, time in UT) at ${summary.samplesPerCase} dates per row, spread over the window with a reproducible pseudo-random time of day. The error is the distance between Galaxy’s position and Horizons’ position, in kilometres and in radii of the body. Horizons is the reference here, not absolute truth: its own uncertainty is not included. Measured on ${escapeHtml(summary.generatedAt.slice(0, 10))} by <code>scripts/validate-against-horizons.mjs</code>, whose Horizons answers are cached so that the measurement can be replayed.`,
    fr: `Chaque source est comparée à l’API NASA/JPL Horizons (vecteurs d’état géométriques, écliptique J2000, temps UT) à ${summary.samplesPerCase} dates par ligne, réparties sur la fenêtre avec une heure pseudo-aléatoire reproductible. L’erreur est la distance entre la position de Galaxy et celle d’Horizons, en kilomètres et en rayons du corps. Horizons est ici la référence, pas la vérité absolue : sa propre incertitude n’est pas incluse. Mesuré le ${escapeHtml(summary.generatedAt.slice(0, 10))} par <code>scripts/validate-against-horizons.mjs</code>, dont les réponses Horizons sont mises en cache pour que la mesure puisse être rejouée.`,
    es: `Cada fuente se compara con la API NASA/JPL Horizons (vectores de estado geométricos, eclíptica J2000, tiempo en UT) en ${summary.samplesPerCase} fechas por fila, repartidas en la ventana con una hora del día pseudoaleatoria reproducible. El error es la distancia entre la posición de Galaxy y la de Horizons, en kilómetros y en radios del cuerpo. Horizons es aquí la referencia, no la verdad absoluta: su propia incertidumbre no está incluida. Medido el ${escapeHtml(summary.generatedAt.slice(0, 10))} por <code>scripts/validate-against-horizons.mjs</code>, cuyas respuestas de Horizons se guardan en caché para poder repetir la medición.`,
    'pt-BR': `Cada fonte é comparada com a API NASA/JPL Horizons (vetores de estado geométricos, eclíptica J2000, tempo em UT) em ${summary.samplesPerCase} datas por linha, distribuídas na janela com uma hora do dia pseudoaleatória reproduzível. O erro é a distância entre a posição da Galaxy e a da Horizons, em quilômetros e em raios do corpo. A Horizons é aqui a referência, não a verdade absoluta: a sua própria incerteza não está incluída. Medido em ${escapeHtml(summary.generatedAt.slice(0, 10))} por <code>scripts/validate-against-horizons.mjs</code>, cujas respostas da Horizons ficam em cache para que a medição possa ser repetida.`,
  })}</p>`;
  const kmHeaders = [
    L({
      en: 'Mean (km)',
      fr: 'Moyenne (km)',
      es: 'Media (km)',
      'pt-BR': 'Média (km)',
    }),
    L({
      en: '95th pct (km)',
      fr: '95ᵉ centile (km)',
      es: 'Percentil 95 (km)',
      'pt-BR': 'Percentil 95 (km)',
    }),
    L({
      en: 'Max (km)',
      fr: 'Max (km)',
      es: 'Máx. (km)',
      'pt-BR': 'Máx. (km)',
    }),
  ];
  const radiiHeader = L({
    en: 'Mean (body radii)',
    fr: 'Moyenne (rayons du corps)',
    es: 'Media (radios del cuerpo)',
    'pt-BR': 'Média (raios do corpo)',
  });
  const productionTable = docTable(
    L({
      en: `What the app shows, ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}: heliocentric position as the scene composes it (a moon includes its planet’s error)`,
      fr: `Ce que montre l’application, ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)} : position héliocentrique telle que la scène la compose (une lune inclut l’erreur de sa planète)`,
      es: `Lo que muestra la aplicación, ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}: posición heliocéntrica tal como la compone la escena (una luna incluye el error de su planeta)`,
      'pt-BR': `O que o aplicativo mostra, ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}: posição heliocêntrica tal como a cena a compõe (uma lua inclui o erro do seu planeta)`,
    }),
    [
      L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
      L({
        en: 'Source used',
        fr: 'Source retenue',
        es: 'Fuente utilizada',
        'pt-BR': 'Fonte utilizada',
      }),
      ...kmHeaders,
      radiiHeader,
    ],
    production.map((r) => [
      escapeHtml(name(r.body, locale)),
      sourceLabel(r, locale),
      num(r.km?.mean),
      num(r.km?.p95),
      num(r.km?.max),
      num(r.radii?.mean),
    ]),
    2
  );

  const keplerNames = new Set(keplerOnly.map((r) => r.body));
  const nearEpoch = rows.filter(
    (r) =>
      r.provider === 'kepler' &&
      r.n > 0 &&
      ((r.windowKind === 'epoch' && keplerNames.has(r.body)) ||
        r.windowKind === 'perihelion')
  );
  // Depuis le lot 11, chaque corps du catalogue a un fichier Horizons sur la période du tableau
  // de production : la liste des corps « képlériens seuls » y est VIDE, et les phrases écrites
  // pour elle (une liste entre parenthèses, un tableau titré pour eux) diraient faux. Les deux
  // formes restent, choisies par le résumé : un corps qui perdrait son fichier y reviendrait.
  const hasKeplerOnly = keplerOnly.length > 0;
  const productionSpan = `${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}`;
  const epochTable = docTable(
    L(
      hasKeplerOnly
        ? {
            en: 'Keplerian bodies close to their elements’ epoch; interstellar objects over their drawn window',
            fr: 'Corps képlériens près de l’époque de leurs éléments ; objets interstellaires sur leur fenêtre dessinée',
            es: 'Cuerpos keplerianos cerca de la época de sus elementos; objetos interestelares en su ventana dibujada',
            'pt-BR':
              'Corpos keplerianos perto da época dos seus elementos; objetos interestelares na sua janela desenhada',
          }
        : {
            en: 'Interstellar objects over their drawn window',
            fr: 'Objets interstellaires sur leur fenêtre dessinée',
            es: 'Objetos interestelares en su ventana dibujada',
            'pt-BR': 'Objetos interestelares na sua janela desenhada',
          }
    ),
    [
      L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
      L({ en: 'Window', fr: 'Fenêtre', es: 'Ventana', 'pt-BR': 'Janela' }),
      ...kmHeaders,
    ],
    nearEpoch.map((r) => [
      escapeHtml(name(r.body, locale)),
      windowLabel(r),
      num(r.km?.mean),
      num(r.km?.p95),
      num(r.km?.max),
    ]),
    2
  );

  const spacecraftRows = rows.filter(
    (r) =>
      r.provider === 'horizons-binary' && spacecraftNames.has(r.body) && r.n > 0
  );
  const spacecraftTable = docTable(
    L({
      en: 'Spacecraft, over each mission’s file coverage',
      fr: 'Sondes, sur la couverture du fichier de chaque mission',
      es: 'Sondas, en la cobertura del archivo de cada misión',
      'pt-BR': 'Sondas, na cobertura do arquivo de cada missão',
    }),
    [
      L({ en: 'Mission', fr: 'Mission', es: 'Misión', 'pt-BR': 'Missão' }),
      L({
        en: 'Coverage',
        fr: 'Couverture',
        es: 'Cobertura',
        'pt-BR': 'Cobertura',
      }),
      L({
        en: 'Median (km)',
        fr: 'Médiane (km)',
        es: 'Mediana (km)',
        'pt-BR': 'Mediana (km)',
      }),
      L({
        en: '95th pct (km)',
        fr: '95ᵉ centile (km)',
        es: 'Percentil 95 (km)',
        'pt-BR': 'Percentil 95 (km)',
      }),
      L({
        en: 'Max (km)',
        fr: 'Max (km)',
        es: 'Máx. (km)',
        'pt-BR': 'Máx. (km)',
      }),
    ],
    spacecraftRows.map((r) => [
      escapeHtml(name(r.body, locale)),
      windowLabel(r),
      num(r.km?.median),
      num(r.km?.p95),
      num(r.km?.max),
    ]),
    2
  );

  // Rapport complet par source : chaque ligne du résumé, repliée par défaut.
  const detailTables = (
    Object.keys(PROVIDER_TITLES) as (keyof typeof PROVIDER_TITLES)[]
  )
    .map((provider) => {
      const providerRows = rows.filter(
        (r) =>
          r.provider === provider &&
          // Les millénaires profonds ont leur propre section, qui porte leur référence et son
          // plancher : les répéter ici doublerait cent lignes sans leur contexte.
          r.windowKind !== 'deep' &&
          !(provider === 'horizons-binary' && spacecraftNames.has(r.body)) &&
          !(provider === 'spk' && r.n === 0)
      );
      if (providerRows.length === 0) return '';
      const table = docTable(
        L(PROVIDER_TITLES[provider]),
        [
          L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
          L({ en: 'Frame', fr: 'Repère', es: 'Marco', 'pt-BR': 'Referencial' }),
          L({ en: 'Window', fr: 'Fenêtre', es: 'Ventana', 'pt-BR': 'Janela' }),
          L({ en: 'Dates', fr: 'Dates', es: 'Fechas', 'pt-BR': 'Datas' }),
          L({
            en: 'Mean (km)',
            fr: 'Moyenne (km)',
            es: 'Media (km)',
            'pt-BR': 'Média (km)',
          }),
          L({
            en: 'Median (km)',
            fr: 'Médiane (km)',
            es: 'Mediana (km)',
            'pt-BR': 'Mediana (km)',
          }),
          L({
            en: '95th pct (km)',
            fr: '95ᵉ centile (km)',
            es: 'Percentil 95 (km)',
            'pt-BR': 'Percentil 95 (km)',
          }),
          L({
            en: 'Max (km)',
            fr: 'Max (km)',
            es: 'Máx. (km)',
            'pt-BR': 'Máx. (km)',
          }),
          radiiHeader,
        ],
        providerRows.map((r) => [
          escapeHtml(name(r.body, locale)),
          r.relative
            ? L({
                en: 'relative to planet',
                fr: 'relatif à la planète',
                es: 'relativa al planeta',
                'pt-BR': 'relativa ao planeta',
              })
            : L({
                en: 'heliocentric',
                fr: 'héliocentrique',
                es: 'heliocéntrica',
                'pt-BR': 'heliocêntrica',
              }),
          windowLabel(r),
          String(r.n),
          num(r.km?.mean),
          num(r.km?.median),
          num(r.km?.p95),
          num(r.km?.max),
          num(r.radii?.mean),
        ]),
        3
      );
      return `<details class="doc-details"><summary>${escapeHtml(L(PROVIDER_TITLES[provider]))} (${providerRows.length})</summary>${table}</details>`;
    })
    .join('');

  sections.push(
    docSection(
      'validation',
      L({
        en: 'Measured accuracy',
        fr: 'Précision mesurée',
        es: 'Exactitud medida',
        'pt-BR': 'Exatidão medida',
      }),
      method +
        productionTable +
        `<p>${L(
          hasKeplerOnly
            ? {
                en: 'Keplerian elements describe an orbit without the pull of the planets, so their error grows with the distance in time from their epoch. Over two centuries it is large; near the epoch it is much smaller:',
                fr: 'Des éléments képlériens décrivent une orbite sans l’attraction des planètes : leur erreur croît avec l’écart en temps à leur époque. Sur deux siècles elle est grande ; près de l’époque elle est bien plus petite :',
                es: 'Los elementos keplerianos describen una órbita sin la atracción de los planetas, así que su error crece con la distancia en el tiempo a su época. En dos siglos es grande; cerca de la época es mucho menor:',
                'pt-BR':
                  'Os elementos keplerianos descrevem uma órbita sem a atração dos planetas, então o seu erro cresce com a distância no tempo até a sua época. Em dois séculos ele é grande; perto da época é muito menor:',
              }
            : {
                en: `Keplerian elements describe an orbit without the pull of the planets, so their error grows with the distance in time from their epoch. No body in the production table (${productionSpan}) is positioned by them alone. They remain the fallback outside the coverage of the Horizons files (full measurements below), and the only source for the interstellar objects, measured over their drawn window:`,
                fr: `Des éléments képlériens décrivent une orbite sans l’attraction des planètes : leur erreur croît avec l’écart en temps à leur époque. Aucun corps du tableau de production (${productionSpan}) n’est positionné par eux seuls. Ils restent le repli hors de la couverture des fichiers Horizons (mesures complètes ci-dessous), et la seule source des objets interstellaires, mesurés sur leur fenêtre dessinée :`,
                es: `Los elementos keplerianos describen una órbita sin la atracción de los planetas, así que su error crece con la distancia en el tiempo a su época. Ningún cuerpo de la tabla de producción (${productionSpan}) se sitúa solo con ellos. Siguen siendo el respaldo fuera de la cobertura de los archivos Horizons (mediciones completas más abajo), y la única fuente para los objetos interestelares, medida en su ventana dibujada:`,
                'pt-BR': `Os elementos keplerianos descrevem uma órbita sem a atração dos planetas, então o seu erro cresce com a distância no tempo até a sua época. Nenhum corpo da tabela de produção (${productionSpan}) é posicionado só por eles. Eles continuam a ser a reserva fora da cobertura dos arquivos Horizons (medições completas abaixo), e a única fonte para os objetos interestelares, medida na sua janela desenhada:`,
              }
        )}</p>` +
        epochTable +
        `<p>${L({
          en: 'For spacecraft the median is the meaningful figure: errors peak briefly around close flybys and perihelia, where the trajectory bends faster than the file’s step can resolve.',
          fr: 'Pour les sondes, la médiane est le chiffre parlant : l’erreur culmine brièvement autour des survols rapprochés et des périhélies, où la trajectoire se courbe plus vite que le pas du fichier ne peut le résoudre.',
          es: 'Para las sondas la cifra significativa es la mediana: los errores culminan brevemente alrededor de los sobrevuelos cercanos y de los perihelios, donde la trayectoria se curva más rápido de lo que el paso del archivo puede resolver.',
          'pt-BR':
            'Para as sondas o número significativo é a mediana: os erros atingem um pico breve em torno dos sobrevoos próximos e dos periélios, onde a trajetória se curva mais rápido do que o passo do arquivo consegue resolver.',
        })}</p>` +
        spacecraftTable +
        `<h3>${L({ en: 'Full measurements, by source', fr: 'Mesures complètes, par source', es: 'Mediciones completas, por fuente', 'pt-BR': 'Medições completas, por fonte' })}</h3><p>${L(
          {
            en: 'Each source measured on its own, over its own windows, including those the app only uses as a fallback. “Dates” is the number of dates at which the source gave a position.',
            fr: 'Chaque source mesurée seule, sur ses propres fenêtres, y compris celles que l’application n’emploie qu’en repli. « Dates » est le nombre de dates auxquelles la source a donné une position.',
            es: 'Cada fuente medida por separado, en sus propias ventanas, incluidas aquellas que la aplicación solo usa como respaldo. «Fechas» es el número de fechas en las que la fuente dio una posición.',
            'pt-BR':
              'Cada fonte medida separadamente, nas suas próprias janelas, incluindo aquelas que o aplicativo só usa como reserva. “Datas” é o número de datas em que a fonte deu uma posição.',
          }
        )}</p>` +
        detailTables
    )
  );

  // 8c. La profondeur du temps (lot 39)
  // Tout ce qui suit est DÉRIVÉ du résumé de validation : les millénaires, les bornes, les
  // planchers, les refus, les corps. Aucun chiffre et aucune liste ne sont saisis ici.
  const deepRows = rows.filter((r) => r.windowKind === 'deep');
  if (deepRows.length > 0) {
    const deepPublished = deepRows.filter((r) => r.km);
    const deepRefused = deepRows.filter((r) => r.floorRefused);
    const deepBodies = new Set(deepPublished.map((r) => r.body)).size;
    // Trier les DATES, pas les objets : `[...deepRows].sort()` compare des « [object Object] »
    // et rend donc le premier élément dans l'ordre d'émission, ce qui n'est juste que par
    // accident. Défaut trouvé en relisant le lot 39 après sa fusion.
    const byTime = (dates: string[]): string[] =>
      [...dates].sort((a, b) => isoTime(a) - isoTime(b));
    const firstYear = yearText(
      byTime(deepRows.map((r) => r.windowFrom))[0] ?? ''
    );
    const lastYear = yearText(
      byTime(deepRows.map((r) => r.windowTo)).at(-1) ?? ''
    );
    const substituted = Object.entries(summary.deep?.bodies ?? {});
    // Corps où Horizons n'est pas d'accord avec lui-même : le plancher du chemin réel dépasse
    // largement la distance géométrique corps ↔ barycentre.
    const disagreeing = substituted.filter(
      ([, d]) => d.floorKm > 2 * d.separationMaxKm
    );
    const outsideBody = substituted.filter(([, d]) => !d.insideBody);
    // `PROVIDER_TITLES` ne nomme pas « production », qui n'a pas de ligne profonde : la lecture
    // est donc partielle et déclarée telle, plutôt que forcée par une conversion de type.
    const deepProviderTitles: Partial<
      Record<ValidationRow['provider'], DocText>
    > = PROVIDER_TITLES;
    const deepProviderLabel = (provider: ValidationRow['provider']): string =>
      escapeHtml(
        L(
          deepProviderTitles[provider] ?? {
            en: provider,
            fr: provider,
            es: provider,
            'pt-BR': provider,
          }
        )
      );
    /** « Uranus et Neptune », pas « Uranus, Neptune » : c'est du texte publié, pas une liste. */
    const bodyList = (names: readonly string[]): string => {
      const written = names.map((b) => escapeHtml(name(b, locale)));
      if (written.length < 2) return written.join('');
      const last = written.pop()!;
      const and = L({ en: 'and', fr: 'et', es: 'y', 'pt-BR': 'e' });
      return `${written.join(', ')} ${and} ${last}`;
    };
    /**
     * Le résumé publie un CODE, pas une phrase : la raison se rédige ici, dans la langue de la
     * page. Un code inconnu s'affiche tel quel plutôt que de disparaître.
     */
    const REFUSAL_REASONS: Record<string, DocText> = {
      'floor-over-hundredth': {
        en: 'the floor of the substitution is more than a hundredth of the gap measured there',
        fr: 'le plancher de la substitution dépasse un centième de l’écart mesuré sur cette fenêtre',
        es: 'el piso de la sustitución supera una centésima de la diferencia medida en esa ventana',
        'pt-BR':
          'o piso da substituição ultrapassa um centésimo da diferença medida nessa janela',
      },
    };
    const refusalReason = (code: string): string => {
      const text = REFUSAL_REASONS[code];
      return text ? escapeHtml(L(text)) : escapeHtml(code);
    };
    const refusedSentence = L(
      deepRefused.length === 0
        ? {
            en: 'No window is held back for that reason.',
            fr: 'Aucune fenêtre n’est retenue pour cette raison.',
            es: 'Ninguna ventana se retiene por ese motivo.',
            'pt-BR': 'Nenhuma janela é retida por esse motivo.',
          }
        : {
            en: `${deepRefused.length} windows are held back, all on ${bodyList([...new Set(deepRefused.map((r) => r.body))])}, and they are listed above with their floor. There, the info card keeps saying that the gap is not measured, which is true.`,
            fr: `${deepRefused.length} fenêtres sont retenues, toutes sur ${bodyList([...new Set(deepRefused.map((r) => r.body))])}, et elles sont listées ci-dessus avec leur plancher. La fiche y continue de dire que l’écart n’est pas mesuré, ce qui est vrai.`,
            es: `${deepRefused.length} ventanas quedan retenidas, todas sobre ${bodyList([...new Set(deepRefused.map((r) => r.body))])}, y están listadas más arriba con su piso. Allí la ficha sigue diciendo que la diferencia no está medida, lo cual es cierto.`,
            'pt-BR': `${deepRefused.length} janelas ficam retidas, todas sobre ${bodyList([...new Set(deepRefused.map((r) => r.body))])}, e estão listadas acima com o seu piso. Ali a ficha continua a dizer que a diferença não está medida, o que é verdade.`,
          }
    );
    const outsideSentence = L(
      outsideBody.length === 0
        ? {
            en: 'every substituted barycentre falls inside its own body.',
            fr: 'chaque barycentre substitué tombe dans son propre corps.',
            es: 'cada baricentro sustituido cae dentro de su propio cuerpo.',
            'pt-BR':
              'cada baricentro substituído cai dentro do seu próprio corpo.',
          }
        : {
            en: `the barycentre falls outside the body itself for ${bodyList(outsideBody.map(([b]) => b))}, which is also why the app’s own Horizons service takes that wobble out and puts it back.`,
            fr: `le barycentre tombe hors du corps lui-même pour ${bodyList(outsideBody.map(([b]) => b))}, ce qui est aussi la raison pour laquelle le service Horizons de l’application retire puis rend ce balancement.`,
            es: `el baricentro cae fuera del propio cuerpo para ${bodyList(outsideBody.map(([b]) => b))}, lo cual es también la razón por la que el servicio Horizons de la aplicación quita ese bamboleo y luego lo devuelve.`,
            'pt-BR': `o baricentro cai fora do próprio corpo para ${bodyList(outsideBody.map(([b]) => b))}, o que é também a razão pela qual o serviço Horizons do aplicativo retira esse balanço e depois o devolve.`,
          }
    );
    // Un tableau par source, comme les mesures complètes plus haut : mettre la source en
    // COLONNE répétait « astronomy-engine (VSOP87 et modèles analytiques) » sur 95 lignes.
    const deepTables = [...new Set(deepPublished.map((r) => r.provider))]
      .map((provider) => {
        const providerRows = deepPublished.filter(
          (r) => r.provider === provider
        );
        return docTable(
          `${L({
            en: 'Gap to JPL Horizons, millennium by millennium',
            fr: 'Écart à JPL Horizons, millénaire par millénaire',
            es: 'Diferencia con JPL Horizons, milenio a milenio',
            'pt-BR': 'Diferença para a JPL Horizons, milênio a milênio',
          })} ${deepProviderLabel(provider)}`,
          [
            L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
            L({
              en: 'Window',
              fr: 'Fenêtre',
              es: 'Ventana',
              'pt-BR': 'Janela',
            }),
            ...kmHeaders,
            radiiHeader,
          ],
          providerRows.map((r) => [
            escapeHtml(name(r.body, locale)),
            windowLabel(r),
            num(r.km?.mean),
            num(r.km?.p95),
            num(r.km?.max),
            num(r.radii?.mean),
          ]),
          2
        );
      })
      .join('');

    // Les fenêtres mesurées mais NON publiées restent visibles avec leur raison : une mesure
    // faite et cachée serait exactement ce que cette page reproche au reste du monde.
    const refusedTable =
      deepRefused.length === 0
        ? ''
        : docTable(
            L({
              en: 'Measured windows held back, and why',
              fr: 'Fenêtres mesurées et retenues, et pourquoi',
              es: 'Ventanas medidas y retenidas, y por qué',
              'pt-BR': 'Janelas medidas e retidas, e por quê',
            }),
            [
              L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
              L({
                en: 'Window',
                fr: 'Fenêtre',
                es: 'Ventana',
                'pt-BR': 'Janela',
              }),
              L({
                en: 'Floor (km)',
                fr: 'Plancher (km)',
                es: 'Piso (km)',
                'pt-BR': 'Piso (km)',
              }),
              L({
                en: 'Reason',
                fr: 'Raison',
                es: 'Motivo',
                'pt-BR': 'Motivo',
              }),
            ],
            deepRefused.map((r) => [
              escapeHtml(name(r.body, locale)),
              windowLabel(r),
              num(r.floorKm),
              refusalReason(r.floorRefused ?? ''),
            ])
          );
    const floorTable = docTable(
      L({
        en: 'Deep reference and its floor, per body',
        fr: 'Référence profonde et son plancher, par corps',
        es: 'Referencia profunda y su piso, por cuerpo',
        'pt-BR': 'Referência profunda e o seu piso, por corpo',
      }),
      [
        L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
        L({
          en: 'Horizons target',
          fr: 'Cible Horizons',
          es: 'Objetivo Horizons',
          'pt-BR': 'Alvo Horizons',
        }),
        L({
          en: 'Floor along the real path (km)',
          fr: 'Plancher du chemin réel (km)',
          es: 'Piso por el camino real (km)',
          'pt-BR': 'Piso pelo caminho real (km)',
        }),
        L({
          en: 'Geometric body to barycentre distance (km)',
          fr: 'Distance géométrique corps au barycentre (km)',
          es: 'Distancia geométrica cuerpo a baricentro (km)',
          'pt-BR': 'Distância geométrica corpo a baricentro (km)',
        }),
        L({
          en: 'Barycentre inside the body',
          fr: 'Barycentre dans le corps',
          es: 'Baricentro dentro del cuerpo',
          'pt-BR': 'Baricentro dentro do corpo',
        }),
      ],
      substituted.map(([body, d]) => [
        escapeHtml(name(body, locale)),
        escapeHtml(d.target),
        num(d.floorKm),
        num(d.separationMaxKm),
        d.insideBody
          ? L({ en: 'yes', fr: 'oui', es: 'sí', 'pt-BR': 'sim' })
          : L({ en: 'no', fr: 'non', es: 'no', 'pt-BR': 'não' }),
      ]),
      2
    );
    // AVANT L'AN 1, ET CE QUE L'HORLOGE NE SAIT PAS (ligne 22.10). Tout est dérivé du résumé :
    // le désaccord des deux ΔT, une date au milieu de chaque tranche.
    const deltaT = summary.deep?.deltaT ?? [];
    const yearOfNumber = (n: number): string =>
      n >= 1
        ? String(n)
        : `${1 - n} ${L({ en: 'BC', fr: 'av. J.-C.', es: 'a. C.', 'pt-BR': 'a.C.' })}`;
    const hours = (d: { horizonsS: number; galaxyS: number }): string =>
      num(Math.abs(d.horizonsS - d.galaxyS) / 3600);
    const worst = deltaT.reduce<(typeof deltaT)[number] | null>(
      (w, d) =>
        !w ||
        Math.abs(d.horizonsS - d.galaxyS) > Math.abs(w.horizonsS - w.galaxyS)
          ? d
          : w,
      null
    );
    const deltaTSection =
      deltaT.length === 0 || !worst
        ? ''
        : `<p>${L({
            en: `Before year 1, a year is written BC: the astronomical year 0 is 1 BC, and the year -1000 is 1001 BC. The app computes, and writes its links, in the Gregorian calendar extended into the past, whereas historians date antiquity in the Julian calendar, which Horizons itself uses to print its dates before 1582. The same day therefore carries two different dates, and the gap grows the further back one goes: this is why the time bar shows the Julian date before 15 October 1582, while the link keeps the Gregorian one.`,
            fr: `Avant l’an 1, une année s’écrit avant J.-C. : l’année astronomique 0 est 1 av. J.-C., et l’année -1000 est 1001 av. J.-C. L’application calcule, et écrit ses liens, dans le calendrier grégorien prolongé dans le passé, alors que les historiens datent l’Antiquité dans le calendrier julien, qu’Horizons emploie lui-même pour imprimer ses dates d’avant 1582. Un même jour porte donc deux dates différentes, et l’écart grandit à mesure qu’on remonte : c’est pourquoi la barre de temps affiche la date julienne avant le 15 octobre 1582, le lien gardant la grégorienne.`,
            es: `Antes del año 1, un año se escribe antes de Cristo: el año astronómico 0 es 1 a. C., y el año -1000 es 1001 a. C. La aplicación calcula, y escribe sus enlaces, en el calendario gregoriano prolongado hacia el pasado, mientras que los historiadores fechan la Antigüedad en el calendario juliano, que Horizons emplea él mismo para imprimir sus fechas anteriores a 1582. Un mismo día lleva por tanto dos fechas distintas, y la diferencia crece cuanto más se retrocede: por eso la barra de tiempo muestra la fecha juliana antes del 15 de octubre de 1582, y el enlace conserva la gregoriana.`,
            'pt-BR': `Antes do ano 1, um ano se escreve antes de Cristo: o ano astronômico 0 é 1 a.C., e o ano -1000 é 1001 a.C. O aplicativo calcula, e escreve os seus links, no calendário gregoriano estendido para o passado, enquanto os historiadores datam a Antiguidade no calendário juliano, que a própria Horizons emprega para imprimir as suas datas anteriores a 1582. Um mesmo dia leva portanto duas datas diferentes, e a diferença cresce quanto mais se recua: por isso a barra de tempo mostra a data juliana antes de 15 de outubro de 1582, e o link mantém a gregoriana.`,
          })}</p><p>${L({
            en: `Each gap above compares two positions at the same Universal Time. Each side converts that time into dynamical time with its own ΔT, which follows the slowing of the Earth’s rotation. Before the age of observations ΔT is not measured: both values are extrapolations, and their disagreement enters the gap without being a position error. It is measured here in the middle of each window; around ${yearOfNumber(worst.year)}, it reaches ${hours(worst)} h. For the future, both sides freeze ΔT at today’s value, so their agreement says nothing about the Earth’s actual rotation.`,
            fr: `Chaque écart ci-dessus compare deux positions à un même Temps universel. Chaque côté convertit ce temps en temps dynamique avec son propre ΔT, qui suit le ralentissement de la rotation de la Terre. Avant l’époque des observations, ΔT n’est pas mesuré : les deux valeurs sont des extrapolations, et leur désaccord entre dans l’écart sans être une erreur de position. Il est mesuré ici au milieu de chaque fenêtre ; vers ${yearOfNumber(worst.year)}, il atteint ${hours(worst)} h. Pour le futur, les deux côtés figent ΔT à sa valeur actuelle : leur accord ne dit donc rien de la rotation réelle de la Terre.`,
            es: `Cada diferencia de arriba compara dos posiciones en un mismo Tiempo universal. Cada lado convierte ese tiempo en tiempo dinámico con su propio ΔT, que sigue la desaceleración de la rotación de la Tierra. Antes de la época de las observaciones, ΔT no está medido: los dos valores son extrapolaciones, y su desacuerdo entra en la diferencia sin ser un error de posición. Se mide aquí en el centro de cada ventana; hacia ${yearOfNumber(worst.year)}, alcanza ${hours(worst)} h. Para el futuro, los dos lados congelan ΔT en su valor actual: su acuerdo no dice nada de la rotación real de la Tierra.`,
            'pt-BR': `Cada diferença acima compara duas posições num mesmo Tempo universal. Cada lado converte esse tempo em tempo dinâmico com o seu próprio ΔT, que acompanha a desaceleração da rotação da Terra. Antes da época das observações, ΔT não é medido: os dois valores são extrapolações, e o seu desacordo entra na diferença sem ser um erro de posição. Ele é medido aqui no meio de cada janela; por volta de ${yearOfNumber(worst.year)}, chega a ${hours(worst)} h. Para o futuro, os dois lados congelam ΔT no seu valor atual: o acordo entre eles não diz nada da rotação real da Terra.`,
          })}</p><details class="doc-details"><summary>${escapeHtml(
            L({
              en: 'ΔT of JPL Horizons and of the app, in the middle of each window',
              fr: 'ΔT de JPL Horizons et de l’application, au milieu de chaque fenêtre',
              es: 'ΔT de JPL Horizons y de la aplicación, en el centro de cada ventana',
              'pt-BR':
                'ΔT da JPL Horizons e do aplicativo, no meio de cada janela',
            })
          )} (${deltaT.length})</summary>${docTable(
            L({
              en: 'ΔT, in seconds, and their disagreement',
              fr: 'ΔT, en secondes, et leur désaccord',
              es: 'ΔT, en segundos, y su desacuerdo',
              'pt-BR': 'ΔT, em segundos, e o seu desacordo',
            }),
            [
              L({ en: 'Year', fr: 'Année', es: 'Año', 'pt-BR': 'Ano' }),
              L({
                en: 'JPL Horizons (TDB−UT)',
                fr: 'JPL Horizons (TDB−UT)',
                es: 'JPL Horizons (TDB−UT)',
                'pt-BR': 'JPL Horizons (TDB−UT)',
              }),
              L({
                en: 'The app (TT−UT)',
                fr: 'L’application (TT−UT)',
                es: 'La aplicación (TT−UT)',
                'pt-BR': 'O aplicativo (TT−UT)',
              }),
              L({
                en: 'Disagreement (h)',
                fr: 'Désaccord (h)',
                es: 'Desacuerdo (h)',
                'pt-BR': 'Desacordo (h)',
              }),
            ],
            deltaT.map((d) => [
              escapeHtml(yearOfNumber(d.year)),
              num(d.horizonsS),
              num(d.galaxyS),
              hours(d),
            ]),
            1
          )}</details>`;

    sections.push(
      docSection(
        'depth-of-time',
        L({
          en: 'The depth of time',
          fr: 'La profondeur du temps',
          es: 'La profundidad del tiempo',
          'pt-BR': 'A profundidade do tempo',
        }),
        `<p>${L({
          en: `The clock accepts any date, and the app used to say so honestly: outside the windows measured above, an info card reads “gap to JPL Horizons not measured at this date”. It is measured now, one millennium at a time, from year ${firstYear} to year ${lastYear}: ${deepPublished.length} windows over ${deepBodies} bodies. Measuring them changed nothing in the card: it already named the window next to the figure, and it now has one to name. When that gap exceeds the diameter of the body, the card adds that, at this date, the body is drawn away from its true place: beyond one diameter, the sphere drawn and the true one no longer overlap at all.`,
          fr: `L’horloge accepte n’importe quelle date, et l’application le disait honnêtement : hors des fenêtres mesurées plus haut, une fiche affiche « écart à JPL Horizons non mesuré à cette date ». C’est mesuré désormais, millénaire par millénaire, de l’an ${firstYear} à l’an ${lastYear} : ${deepPublished.length} fenêtres sur ${deepBodies} corps. Les mesurer n’a rien changé à la fiche : elle nommait déjà la fenêtre à côté du chiffre, et elle en a maintenant une à nommer. Quand cet écart dépasse le diamètre du corps, la fiche ajoute qu’à cette date le corps est dessiné hors de sa place réelle : au-delà d’un diamètre, la sphère dessinée et la vraie ne se recouvrent plus du tout.`,
          es: `El reloj acepta cualquier fecha, y la aplicación lo decía honestamente: fuera de las ventanas medidas más arriba, una ficha muestra «diferencia con JPL Horizons no medida en esta fecha». Ahora está medida, milenio a milenio, del año ${firstYear} al año ${lastYear}: ${deepPublished.length} ventanas sobre ${deepBodies} cuerpos. Medirlas no cambió nada en la ficha: ya nombraba la ventana junto a la cifra, y ahora tiene una que nombrar. Cuando esa diferencia supera el diámetro del cuerpo, la ficha añade que, en esa fecha, el cuerpo se dibuja fuera de su lugar real: más allá de un diámetro, la esfera dibujada y la verdadera ya no se superponen en absoluto.`,
          'pt-BR': `O relógio aceita qualquer data, e o aplicativo dizia isso honestamente: fora das janelas medidas acima, uma ficha mostra “diferença para a JPL Horizons não medida nesta data”. Agora ela está medida, milênio a milênio, do ano ${firstYear} ao ano ${lastYear}: ${deepPublished.length} janelas sobre ${deepBodies} corpos. Medi-las não mudou nada na ficha: ela já nomeava a janela ao lado do número, e agora tem uma para nomear. Quando essa diferença supera o diâmetro do corpo, a ficha acrescenta que, nessa data, o corpo é desenhado fora do seu lugar real: além de um diâmetro, a esfera desenhada e a verdadeira já não se sobrepõem de forma alguma.`,
        })}</p><p>${L({
          en: `One measured limit closes that window, and it is not a choice: the Horizons API serves the bodies of the DE441 planetary ephemeris from 21 March 9999 BC (a date in the Julian calendar, which is how Horizons prints it) to 30 December 9999 AD, and refuses anything beyond. A browser date field cannot write a negative year, nor 29 February 1500, which the Julian calendar has and the Gregorian does not: before 15 October 1582 the time bar therefore replaces it with a day, a month, a year and an era, in the Julian calendar, and says so next to them.`,
          fr: `Une borne mesurée ferme cette fenêtre, et elle n’est pas un choix : l’API Horizons sert les corps de l’éphéméride planétaire DE441 du 21 mars 9999 av. J.-C. (une date du calendrier julien, celui dans lequel Horizons l’imprime) au 30 décembre 9999, et refuse au-delà. Un champ de date de navigateur ne sait écrire ni une année négative, ni le 29 février 1500, que le calendrier julien a et que le grégorien n’a pas : avant le 15 octobre 1582, la barre de temps le remplace donc par un jour, un mois, une année et une ère, dans le calendrier julien, et le dit à côté.`,
          es: `Un límite medido cierra esa ventana, y no es una elección: la API Horizons sirve los cuerpos de la efeméride planetaria DE441 del 21 de marzo de 9999 a. C. (una fecha del calendario juliano, en el que Horizons la imprime) al 30 de diciembre de 9999, y rechaza más allá. Un campo de fecha de navegador no sabe escribir ni un año negativo ni el 29 de febrero de 1500, que el calendario juliano tiene y el gregoriano no: antes del 15 de octubre de 1582, la barra de tiempo lo sustituye por un día, un mes, un año y una era, en el calendario juliano, y lo dice al lado.`,
          'pt-BR': `Um limite medido fecha essa janela, e não é uma escolha: a API Horizons serve os corpos da efeméride planetária DE441 de 21 de março de 9999 a.C. (uma data do calendário juliano, no qual a Horizons a imprime) a 30 de dezembro de 9999, e recusa além disso. Um campo de data de navegador não sabe escrever nem um ano negativo nem o 29 de fevereiro de 1500, que o calendário juliano tem e o gregoriano não: antes de 15 de outubro de 1582, a barra de tempo o substitui por um dia, um mês, um ano e uma era, no calendário juliano, e o diz ao lado.`,
        })}</p>` +
          deltaTSection +
          `<details class="doc-details"><summary>${escapeHtml(
            L({
              en: 'Gap to JPL Horizons, millennium by millennium',
              fr: 'Écart à JPL Horizons, millénaire par millénaire',
              es: 'Diferencia con JPL Horizons, milenio a milenio',
              'pt-BR': 'Diferença para a JPL Horizons, milênio a milênio',
            })
          )} (${deepPublished.length})</summary>${deepTables}</details>` +
          `<p>${L({
            en: `Before 1600 the API refuses the centre of a planet, because that centre comes from a satellite theory fitted over a bounded span. It serves the barycentre of that planet’s system instead, which comes from DE441. The deep windows of ${substituted.length} bodies are therefore measured against that barycentre, and the substitution has a floor: the same source, at the same dates, measured against the body and against its barycentre where Horizons serves both (${escapeHtml(summary.deep?.witnessFrom ?? '')} to ${escapeHtml(summary.deep?.witnessTo ?? '')}). The largest difference between the two is the bias it introduces.`,
            fr: `Avant 1600, l’API refuse le centre d’une planète, parce que ce centre vient d’une théorie de satellites ajustée sur une plage bornée. Elle sert à la place le barycentre du système de cette planète, qui vient de DE441. Les fenêtres profondes de ${substituted.length} corps sont donc mesurées contre ce barycentre, et la substitution a un plancher : la même source, aux mêmes dates, mesurée contre le corps et contre son barycentre là où Horizons sert les deux (du ${escapeHtml(summary.deep?.witnessFrom ?? '')} au ${escapeHtml(summary.deep?.witnessTo ?? '')}). La plus grande différence entre les deux est le biais qu’elle introduit.`,
            es: `Antes de 1600, la API rechaza el centro de un planeta, porque ese centro proviene de una teoría de satélites ajustada sobre un intervalo acotado. Sirve en su lugar el baricentro del sistema de ese planeta, que viene de DE441. Las ventanas profundas de ${substituted.length} cuerpos se miden por tanto contra ese baricentro, y la sustitución tiene un piso: la misma fuente, en las mismas fechas, medida contra el cuerpo y contra su baricentro allí donde Horizons sirve ambos (del ${escapeHtml(summary.deep?.witnessFrom ?? '')} al ${escapeHtml(summary.deep?.witnessTo ?? '')}). La mayor diferencia entre las dos es el sesgo que introduce.`,
            'pt-BR': `Antes de 1600, a API recusa o centro de um planeta, porque esse centro vem de uma teoria de satélites ajustada sobre um intervalo limitado. Ela serve no lugar o baricentro do sistema daquele planeta, que vem do DE441. As janelas profundas de ${substituted.length} corpos são portanto medidas contra esse baricentro, e a substituição tem um piso: a mesma fonte, nas mesmas datas, medida contra o corpo e contra o seu baricentro onde a Horizons serve os dois (de ${escapeHtml(summary.deep?.witnessFrom ?? '')} a ${escapeHtml(summary.deep?.witnessTo ?? '')}). A maior diferença entre as duas é o viés que ela introduz.`,
          })}</p>` +
          floorTable +
          (disagreeing.length === 0
            ? ''
            : `<p>${L({
                en: `For ${bodyList(disagreeing.map(([b]) => b))} the two columns do not agree, and the difference is not ours. Horizons is not consistent with itself on those bodies: the barycentre it serves as a target and the one implied by the body’s own ephemeris are not the same point, and they coincide around the single Voyager 2 flyby that characterised each of those systems. The floor that counts is the one along the path actually taken, and that is the one applied.`,
                fr: `Pour ${bodyList(disagreeing.map(([b]) => b))}, les deux colonnes ne s’accordent pas, et l’écart n’est pas le nôtre. Horizons n’est pas cohérent avec lui-même sur ces corps : le barycentre qu’il sert comme cible et celui qu’implique l’éphéméride du corps ne sont pas le même point, et ils coïncident autour du survol unique de Voyager 2 qui a caractérisé chacun de ces systèmes. Le plancher qui compte est celui du chemin réellement emprunté, et c’est lui qui est appliqué.`,
                es: `Para ${bodyList(disagreeing.map(([b]) => b))} las dos columnas no coinciden, y la diferencia no es nuestra. Horizons no es coherente consigo misma en esos cuerpos: el baricentro que sirve como objetivo y el que implica la efeméride del cuerpo no son el mismo punto, y coinciden en torno al único sobrevuelo de la Voyager 2 que caracterizó cada uno de esos sistemas. El piso que cuenta es el del camino realmente recorrido, y es el que se aplica.`,
                'pt-BR': `Para ${bodyList(disagreeing.map(([b]) => b))} as duas colunas não concordam, e a diferença não é nossa. A Horizons não é coerente consigo mesma nesses corpos: o baricentro que ela serve como alvo e o que a efeméride do corpo implica não são o mesmo ponto, e eles coincidem em torno do único sobrevoo da Voyager 2 que caracterizou cada um desses sistemas. O piso que conta é o do caminho realmente percorrido, e é ele que se aplica.`,
              })}</p>`) +
          (refusedTable === ''
            ? ''
            : `<details class="doc-details"><summary>${escapeHtml(
                L({
                  en: 'Measured windows held back, and why',
                  fr: 'Fenêtres mesurées et retenues, et pourquoi',
                  es: 'Ventanas medidas y retenidas, y por qué',
                  'pt-BR': 'Janelas medidas e retidas, e por quê',
                })
              )} (${deepRefused.length})</summary>${refusedTable}</details>`) +
          `<p>${L({
            en: `A window is published only when its floor stays below a hundredth of the gap measured there, well under the resolution of the two significant digits an info card shows. ${refusedSentence} The body’s radius decides nothing here, but it is worth knowing: ${outsideSentence}`,
            fr: `Une fenêtre n’est publiée que si son plancher reste sous un centième de l’écart qui y est mesuré, bien en deçà de la résolution des deux chiffres significatifs qu’affiche une fiche. ${refusedSentence} Le rayon du corps ne décide de rien ici, mais il vaut d’être connu : ${outsideSentence}`,
            es: `Una ventana solo se publica si su piso se mantiene por debajo de una centésima de la diferencia medida allí, muy por debajo de la resolución de las dos cifras significativas que muestra una ficha. ${refusedSentence} El radio del cuerpo no decide nada aquí, pero vale la pena conocerlo: ${outsideSentence}`,
            'pt-BR': `Uma janela só é publicada se o seu piso ficar abaixo de um centésimo da diferença medida ali, bem abaixo da resolução dos dois algarismos significativos que uma ficha mostra. ${refusedSentence} O raio do corpo não decide nada aqui, mas vale a pena saber: ${outsideSentence}`,
          })}</p>`
      )
    );
  }

  // 8b. Ce que dit une date
  // Les LIBELLÉS viennent du dictionnaire de l'application : la page et la fiche ne peuvent pas
  // diverger. Le type impose une explication par catégorie — en ajouter une sans l'expliquer ici
  // ne compile pas.
  const CATEGORY_NOTES: Record<TemporalCategory, DocText> = {
    live: {
      en: 'the scene is at the present moment, within five minutes, and the data describes it.',
      fr: 'la scène est au présent, à cinq minutes près, et la donnée décrit ce présent.',
      es: 'la escena está en el momento presente, con menos de cinco minutos de diferencia, y el dato lo describe.',
      'pt-BR':
        'a cena está no momento presente, com menos de cinco minutos de diferença, e o dado a descreve.',
    },
    observed: {
      en: 'a measurement of a past instant, such as a satellite image of that day.',
      fr: 'une mesure d’un instant passé, par exemple l’image satellite de ce jour.',
      es: 'una medición de un instante pasado, como una imagen de satélite de ese día.',
      'pt-BR':
        'uma medição de um instante passado, como uma imagem de satélite daquele dia.',
    },
    reported: {
      en: 'an event a third party reported and another party gathered, such as a wildfire or a storm listed by NASA EONET. It is neither a measurement nor a model, and EONET itself asks that its extents not be taken as official. An event with no declared end is shown as ongoing rather than given an invented end date.',
      fr: 'un événement rapporté par un tiers et agrégé par un autre, par exemple un incendie ou une tempête listés par NASA EONET. Ce n’est ni une mesure ni un modèle, et EONET demande lui-même que ses emprises ne soient pas tenues pour officielles. Un événement sans fin déclarée est affiché « en cours » plutôt que doté d’une date de fin inventée.',
      es: 'un evento que un tercero comunicó y que otro recopiló, como un incendio o una tormenta listados por NASA EONET. No es ni una medición ni un modelo, y EONET misma pide que sus extensiones no se tomen como oficiales. Un evento sin fin declarado se muestra como en curso en lugar de recibir una fecha de fin inventada.',
      'pt-BR':
        'um evento que um terceiro relatou e que outro reuniu, como um incêndio ou uma tempestade listados pela NASA EONET. Não é nem uma medição nem um modelo, e a própria EONET pede que as suas extensões não sejam tomadas como oficiais. Um evento sem fim declarado é mostrado como em andamento em vez de receber uma data de fim inventada.',
    },
    reconstructed: {
      en: 'a model of a past or present instant, such as a reanalysis (ERA5, MERRA-2) or a position computed for a date already behind us.',
      fr: 'un modèle sur un instant passé ou présent, par exemple une réanalyse (ERA5, MERRA-2) ou une position calculée pour une date déjà derrière nous.',
      es: 'un modelo de un instante pasado o presente, como un reanálisis (ERA5, MERRA-2) o una posición calculada para una fecha ya pasada.',
      'pt-BR':
        'um modelo de um instante passado ou presente, como uma reanálise (ERA5, MERRA-2) ou uma posição calculada para uma data já passada.',
    },
    predicted: {
      en: 'a model of a future instant, inside the window where its source has been measured. A weather forecast beyond a week is marked as having low confidence.',
      fr: 'un modèle sur un instant futur, dans la fenêtre où sa source a été mesurée. Une prévision météo au-delà d’une semaine est signalée en confiance réduite.',
      es: 'un modelo de un instante futuro, dentro de la ventana en la que su fuente ha sido medida. Una previsión meteorológica de más de una semana se marca como de baja confianza.',
      'pt-BR':
        'um modelo de um instante futuro, dentro da janela na qual a sua fonte foi medida. Uma previsão do tempo além de uma semana é marcada como de baixa confiança.',
    },
    extrapolated: {
      en: 'a calculation outside every window where its gap to the reference was measured. It still draws something, and says that nothing establishes it.',
      fr: 'un calcul hors de toute fenêtre où son écart à la référence a été mesuré. Il dessine quand même quelque chose, et le dit.',
      es: 'un cálculo fuera de toda ventana en la que se midió su diferencia con la referencia. Sigue dibujando algo, y dice que nada lo establece.',
      'pt-BR':
        'um cálculo fora de toda janela na qual a sua diferença com a referência foi medida. Ele continua a desenhar algo, e diz que nada o estabelece.',
    },
    unavailable: {
      en: 'no data for that instant, so nothing is drawn rather than something borrowed from another date.',
      fr: 'aucune donnée pour cet instant : rien n’est dessiné, plutôt qu’une donnée empruntée à une autre date.',
      es: 'ningún dato para ese instante, así que no se dibuja nada en lugar de algo tomado de otra fecha.',
      'pt-BR':
        'nenhum dado para aquele instante, então nada é desenhado em vez de algo tomado de outra data.',
    },
  };
  sections.push(
    docSection(
      'temporal',
      L({
        en: 'What a date says',
        fr: 'Ce que dit une date',
        es: 'Lo que dice una fecha',
        'pt-BR': 'O que uma data diz',
      }),
      `<p>${L({
        en: 'The scene shows one instant, but each piece of data describes an instant of its own, and they rarely coincide. Satellite imagery does not exist for a scene set in 2030, so the latest real image is shown and the gap to the scene is written next to it. Every dated element therefore carries its own label, and there is no single control saying the whole scene is accurate: the label says what the data is, the measured gap says how far it is.',
        fr: 'La scène montre un instant, mais chaque donnée décrit le sien, et les deux coïncident rarement. L’imagerie satellite n’existe pas pour une scène en 2030 : la dernière image réelle est affichée, et l’écart à la scène est écrit à côté. Chaque élément daté porte donc son étiquette, et aucun réglage unique ne prétend que toute la scène est exacte : l’étiquette dit ce qu’est la donnée, l’écart mesuré dit de combien elle s’en écarte.',
        es: 'La escena muestra un instante, pero cada dato describe el suyo, y ambos rara vez coinciden. La imagen de satélite no existe para una escena situada en 2030: se muestra la última imagen real y la diferencia con la escena se escribe al lado. Cada elemento fechado lleva por tanto su propia etiqueta, y ningún ajuste único pretende que toda la escena sea exacta: la etiqueta dice qué es el dato, la diferencia medida dice cuánto se aparta.',
        'pt-BR':
          'A cena mostra um instante, mas cada dado descreve o seu, e os dois raramente coincidem. A imagem de satélite não existe para uma cena situada em 2030: a última imagem real é mostrada e a diferença com a cena é escrita ao lado. Cada elemento datado carrega então o seu próprio rótulo, e nenhum ajuste único pretende que toda a cena seja exata: o rótulo diz o que o dado é, a diferença medida diz o quanto ele se afasta.',
      })}</p><ul class="doc-list">${TEMPORAL_CATEGORIES.map(
        (category) =>
          `<li><strong>${escapeHtml(
            messages[locale][temporalCategoryLabelKey(category)] ?? category
          )}</strong>${L({ en: ':', fr: ' :', es: ':', 'pt-BR': ':' })} ${L(CATEGORY_NOTES[category])}</li>`
      ).join('')}</ul>`
    )
  );

  // 9. Limites connues
  const earth = productionOf('earth');
  const limits: DocText[] = [
    {
      en: `The Earth is drawn at the Earth-Moon barycentre, not at its own centre, to avoid a monthly wobble that would show as a zigzag at true scale and high speed; the Moon is placed correctly relative to that point. This offset is what the Earth row of the accuracy table measures${earth ? ` (${num(earth.km?.mean)} km on average)` : ''}.`,
      fr: `La Terre est dessinée au barycentre Terre-Lune, pas en son propre centre, pour éviter un ballant mensuel qui se verrait comme un zigzag à vraie échelle et à grande vitesse ; la Lune est placée correctement par rapport à ce point. Ce décalage est ce que mesure la ligne Terre du tableau de précision${earth ? ` (${num(earth.km?.mean)} km en moyenne)` : ''}.`,
      es: `La Tierra se dibuja en el baricentro Tierra-Luna, no en su propio centro, para evitar un bamboleo mensual que aparecería como un zigzag a escala real y a gran velocidad; la Luna se sitúa correctamente respecto a ese punto. Este desplazamiento es lo que mide la fila de la Tierra en la tabla de exactitud${earth ? ` (${num(earth.km?.mean)} km de media)` : ''}.`,
      'pt-BR': `A Terra é desenhada no baricentro Terra-Lua, não no seu próprio centro, para evitar uma oscilação mensal que apareceria como um ziguezague em escala real e em alta velocidade; a Lua é posicionada corretamente em relação a esse ponto. Esse deslocamento é o que a linha da Terra na tabela de exatidão mede${earth ? ` (${num(earth.km?.mean)} km em média)` : ''}.`,
    },
    hasKeplerOnly
      ? {
          en: `Bodies positioned by Keplerian elements alone (${listNames(keplerOnly.map((r) => r.body))}) drift away from their true position far from their epoch, because the two-body model ignores planetary perturbations. The tables above give the size of that drift.`,
          fr: `Les corps positionnés par leurs seuls éléments képlériens (${listNames(keplerOnly.map((r) => r.body))}) s’écartent de leur vraie position loin de leur époque, parce que le modèle à deux corps ignore les perturbations des planètes. Les tableaux ci-dessus donnent l’ampleur de cette dérive.`,
          es: `Los cuerpos situados solo por elementos keplerianos (${listNames(keplerOnly.map((r) => r.body))}) se apartan de su posición verdadera lejos de su época, porque el modelo de dos cuerpos ignora las perturbaciones planetarias. Las tablas anteriores dan la magnitud de esa desviación.`,
          'pt-BR': `Os corpos posicionados só por elementos keplerianos (${listNames(keplerOnly.map((r) => r.body))}) se afastam da sua posição verdadeira longe da sua época, porque o modelo de dois corpos ignora as perturbações planetárias. As tabelas acima dão a magnitude desse desvio.`,
        }
      : {
          en: `Keplerian elements drift away from the true position far from their epoch, because the two-body model ignores planetary perturbations. No body in the production table (${productionSpan}) depends on them alone; outside the coverage of the Horizons files they are the fallback described in the next point, and the full measurements give the size of that drift.`,
          fr: `Des éléments képlériens s’écartent de la vraie position loin de leur époque, parce que le modèle à deux corps ignore les perturbations des planètes. Aucun corps du tableau de production (${productionSpan}) n’en dépend seul ; hors de la couverture des fichiers Horizons, ils sont le repli décrit au point suivant, et les mesures complètes donnent l’ampleur de cette dérive.`,
          es: `Los elementos keplerianos se apartan de la posición verdadera lejos de su época, porque el modelo de dos cuerpos ignora las perturbaciones planetarias. Ningún cuerpo de la tabla de producción (${productionSpan}) depende solo de ellos; fuera de la cobertura de los archivos Horizons son el respaldo descrito en el punto siguiente, y las mediciones completas dan la magnitud de esa desviación.`,
          'pt-BR': `Os elementos keplerianos se afastam da posição verdadeira longe da sua época, porque o modelo de dois corpos ignora as perturbações planetárias. Nenhum corpo da tabela de produção (${productionSpan}) depende só deles; fora da cobertura dos arquivos Horizons eles são a reserva descrita no ponto seguinte, e as medições completas dão a magnitude desse desvio.`,
        },
    {
      en: `Outside ${escapeHtml(manifest.coverage.start)} to ${escapeHtml(manifest.coverage.stop)}, the Horizons files do not apply: planets fall back to astronomy-engine, other bodies to their Keplerian elements. The production table covers ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)} only; the full measurements show the sources over wider windows.`,
      fr: `Hors de la période du ${escapeHtml(manifest.coverage.start)} au ${escapeHtml(manifest.coverage.stop)}, les fichiers Horizons ne s’appliquent pas : les planètes retombent sur astronomy-engine, les autres corps sur leurs éléments képlériens. Le tableau de production ne couvre que ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)} ; les mesures complètes montrent les sources sur des fenêtres plus larges.`,
      es: `Fuera de ${escapeHtml(manifest.coverage.start)} a ${escapeHtml(manifest.coverage.stop)}, los archivos Horizons no se aplican: los planetas recurren a astronomy-engine, los demás cuerpos a sus elementos keplerianos. La tabla de producción solo cubre ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}; las mediciones completas muestran las fuentes en ventanas más amplias.`,
      'pt-BR': `Fora de ${escapeHtml(manifest.coverage.start)} a ${escapeHtml(manifest.coverage.stop)}, os arquivos Horizons não se aplicam: os planetas recorrem à astronomy-engine, os outros corpos aos seus elementos keplerianos. A tabela de produção cobre somente ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}; as medições completas mostram as fontes em janelas mais amplas.`,
    },
    {
      en: 'The asteroids and comets of the optional small-body layer, several thousand of them, come from a dated snapshot of the JPL Small-Body Database shipped with the build, and are propagated from its elements. They are not part of this measurement.',
      fr: 'Les astéroïdes et comètes de la couche optionnelle des petits corps, plusieurs milliers, viennent d’un instantané daté de la JPL Small-Body Database livré avec le build, et sont propagés depuis ses éléments. Ils ne font pas partie de cette mesure.',
      es: 'Los asteroides y cometas de la capa opcional de cuerpos menores, varios miles, vienen de una muestra fechada de la JPL Small-Body Database entregada con la compilación, y se propagan a partir de sus elementos. No forman parte de esta medición.',
      'pt-BR':
        'Os asteroides e cometas da camada opcional de corpos menores, vários milhares, vêm de uma amostra datada da JPL Small-Body Database entregue com a compilação, e são propagados a partir dos seus elementos. Eles não fazem parte desta medição.',
    },
    ...(drifts.length > 0
      ? [
          {
            en: `Some synchronous moons do not spin exactly at their orbital period in the catalogue, so the face they turn towards their planet slowly drifts: ${drifts.map((d) => `${escapeHtml(name(d.body, 'en'))} ${formatQuantity(d.degreesPerYear, 'en')}° per year`).join(', ')}. The other synchronous moons are locked exactly.`,
            fr: `Certaines lunes synchrones ne tournent pas exactement à leur période orbitale dans le catalogue : la face qu’elles tournent vers leur planète dérive lentement, ${drifts.map((d) => `${escapeHtml(name(d.body, 'fr'))} ${formatQuantity(d.degreesPerYear, 'fr')}° par an`).join(', ')}. Les autres lunes synchrones sont verrouillées exactement.`,
            es: `Algunas lunas sincrónicas no giran exactamente a su periodo orbital en el catálogo, así que la cara que vuelven hacia su planeta se desplaza lentamente: ${drifts.map((d) => `${escapeHtml(name(d.body, 'es'))} ${formatQuantity(d.degreesPerYear, 'es')}° por año`).join(', ')}. Las demás lunas sincrónicas están bloqueadas exactamente.`,
            'pt-BR': `Algumas luas sincronizadas não giram exatamente no seu período orbital no catálogo, então a face que elas voltam para o seu planeta se desloca lentamente: ${drifts.map((d) => `${escapeHtml(name(d.body, 'pt-BR'))} ${formatQuantity(d.degreesPerYear, 'pt-BR')}° por ano`).join(', ')}. As outras luas sincronizadas estão travadas exatamente.`,
          },
        ]
      : []),
    {
      en: `A body ships the texture sizes its source actually supports, never more: we do not enlarge a published map, and a size is only shipped when it carries detail the size below does not. So a body served at 2k is not a body we neglected, it is a body whose published map stops there. ${TEXTURE_LADDER_ROWS} texture sets are measured this way at every build.`,
      fr: `Un corps livre les tailles de texture que sa source porte réellement, jamais plus : on n’agrandit pas une carte publiée, et une taille n’est livrée que si elle porte du détail que la taille du dessous ne porte pas. Un corps servi en 2k n’est donc pas un corps négligé, c’est un corps dont la carte publiée s’arrête là. ${TEXTURE_LADDER_ROWS} jeux de textures sont mesurés ainsi à chaque build.`,
      es: `Un cuerpo entrega los tamaños de textura que su fuente admite realmente, nunca más: no ampliamos un mapa publicado, y un tamaño solo se entrega cuando aporta detalle que el tamaño inferior no tiene. Así que un cuerpo servido en 2k no es un cuerpo descuidado, es un cuerpo cuyo mapa publicado se detiene ahí. ${TEXTURE_LADDER_ROWS} conjuntos de texturas se miden así en cada compilación.`,
      'pt-BR': `Um corpo entrega os tamanhos de textura que a sua fonte realmente admite, nunca mais: não ampliamos um mapa publicado, e um tamanho só é entregue quando ele traz detalhe que o tamanho inferior não tem. Então um corpo servido em 2k não é um corpo negligenciado, é um corpo cujo mapa publicado para ali. ${TEXTURE_LADDER_ROWS} conjuntos de texturas são medidos assim em cada compilação.`,
    },
    {
      en: `${ILLUSTRATIVE_SURFACES.size} bodies have never been mapped globally: their surfaces are illustrative, not scientific. The <a href="${docPath('sources', locale)}">sources page</a> lists them.`,
      fr: `${ILLUSTRATIVE_SURFACES.size} corps n’ont jamais été cartographiés globalement : leur surface est illustrative, pas scientifique. La <a href="${docPath('sources', locale)}">page des sources</a> les énumère.`,
      es: `${ILLUSTRATIVE_SURFACES.size} cuerpos nunca han sido cartografiados por completo: sus superficies son ilustrativas, no científicas. La <a href="${docPath('sources', locale)}">página de fuentes</a> los enumera.`,
      'pt-BR': `${ILLUSTRATIVE_SURFACES.size} corpos nunca foram mapeados por completo: as suas superfícies são ilustrativas, não científicas. A <a href="${docPath('sources', locale)}">página de fontes</a> os lista.`,
    },
  ];
  sections.push(
    docSection(
      'limits',
      L({
        en: 'Known limits',
        fr: 'Limites connues',
        es: 'Límites conocidos',
        'pt-BR': 'Limites conhecidos',
      }),
      `<ul class="doc-list">${limits.map((l) => `<li>${L(l)}</li>`).join('')}</ul>`
    )
  );

  // Dernière section : comment citer ce travail. Le DOI n'est pas écrit ici, il est LU.
  sections.push(citationSection(input.citation, locale));

  return {
    slug: 'methodology',
    locale,
    canonical: `${origin}${docPath('methodology', locale)}`,
    title: L(T.title),
    description: L(T.description),
    body: sections.join('\n'),
    updated: summary.generatedAt.slice(0, 10),
  };
}
