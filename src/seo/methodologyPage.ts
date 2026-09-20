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
import { messages } from '@/i18n/locales';
import { escapeHtml } from './bodyLandingPage';
import {
  type Bilingual,
  type DocLocale,
  type DocPage,
  DOC_LOCALES,
  docPath,
  docSection,
  docTable,
  formatQuantity,
} from './documentPage';

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
  windowKind: 'fixed' | 'binary' | 'epoch' | 'perihelion';
  windowFrom: string;
  windowTo: string;
  windowClipped: boolean;
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

export interface ValidationSummary {
  generatedAt: string;
  samplesPerCase: number;
  spk: { kernel: boolean; enabledInProduction: boolean };
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
  const names = new Map<string, Partial<Bilingual>>();
  for (const [name, cfg] of flattenBodies(config))
    if (cfg.displayName) names.set(name, cfg.displayName);
  for (const mission of SPACECRAFT_MISSIONS)
    names.set(mission.name, mission.displayName);
  for (const object of INTERSTELLAR_OBJECTS)
    names.set(object.name, object.displayName);
  return (name, locale) =>
    names.get(name)?.[locale] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

const SOURCE_LABELS: Record<string, Bilingual> = {
  binaire: { en: 'JPL Horizons file', fr: 'fichier JPL Horizons' },
  'astronomy-engine': { en: 'astronomy-engine', fr: 'astronomy-engine' },
  kepler: { en: 'Keplerian elements', fr: 'éléments képlériens' },
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

const NA: Bilingual = { en: 'n/a', fr: 'n.d.' };

function q(value: number | null | undefined, locale: DocLocale): string {
  return value === null || value === undefined
    ? NA[locale]
    : formatQuantity(value, locale);
}

const year = (iso: string): string => iso.slice(0, 4);

/** Valeur EXACTE (un pas en jours, une constante), seulement la virgule décimale traduite. */
const exact = (value: number, locale: DocLocale): string =>
  locale === 'fr' ? String(value).replace('.', ',') : String(value);

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
  },
  description: {
    en: 'Reference frames, JPL Horizons ephemerides, Keplerian orbits, interpolation, scales and known limits of Galaxy, with every position source measured against NASA/JPL Horizons.',
    fr: 'Repères, éphémérides JPL Horizons, orbites képlériennes, interpolation, échelles et limites connues de Galaxy, chaque source de position étant mesurée contre NASA/JPL Horizons.',
  },
} satisfies Record<string, Bilingual>;

export interface MethodologyInput {
  summary: ValidationSummary;
  manifest: EphemerisManifest;
  config: CelestialConfig;
  origin: string;
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
  Bilingual
> = {
  'astronomy-engine': {
    en: 'astronomy-engine (VSOP87 and analytic models)',
    fr: 'astronomy-engine (VSOP87 et modèles analytiques)',
  },
  'horizons-binary': {
    en: 'Precomputed JPL Horizons files',
    fr: 'Fichiers JPL Horizons précalculés',
  },
  kepler: {
    en: 'Keplerian elements (catalogue, moon fallbacks, interstellar objects)',
    fr: 'Éléments képlériens (catalogue, replis des lunes, objets interstellaires)',
  },
  spk: {
    en: 'SPK kernel SAT441 (measured locally, not enabled on this site)',
    fr: 'Noyau SPK SAT441 (mesuré localement, non activé sur ce site)',
  },
};

function methodologyPage(input: MethodologyInput, locale: DocLocale): DocPage {
  const { summary, manifest, config, origin } = input;
  const L = (text: Bilingual): string => text[locale];
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
  const days = (values: readonly number[]): string =>
    values.map((v) => exact(v, locale)).join(locale === 'fr' ? ' ou ' : ' or ');
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

  /** Libellé d'une fenêtre de mesure, dans la langue de la page. */
  const windowLabel = (r: ValidationRow): string => {
    const span = `${year(r.windowFrom)}–${year(r.windowTo)}`;
    const clipped = r.windowClipped
      ? L({
          en: ' (limited to Horizons coverage)',
          fr: ' (limitée à la couverture Horizons)',
        })
      : '';
    switch (r.windowKind) {
      case 'binary':
        return `${escapeHtml(r.windowFrom)} → ${escapeHtml(r.windowTo)}`;
      case 'epoch':
        return (
          L({ en: 'epoch ±10 yr', fr: 'époque ±10 ans' }) +
          ` (${span})${clipped}`
        );
      case 'perihelion':
        return (
          L({
            en: `perihelion ±${INTERSTELLAR_WINDOW_YEARS} yr`,
            fr: `périhélie ±${INTERSTELLAR_WINDOW_YEARS} ans`,
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
      L({ en: 'Reference frames', fr: 'Repères' }),
      `<p>${L({
        en: `Every position is a <strong>geometric</strong> position, with no light-time or aberration correction: where a body is at that instant, not where it appears from Earth. Galaxy works in the <strong>J2000 ecliptic</strong> frame, the frame of the JPL Horizons files and of the orbital elements. astronomy-engine returns J2000 equatorial vectors (ICRF axes); they are rotated into the ecliptic by the J2000 obliquity, ε = ${exact(Number(obliquityArcsec), locale)}″ (${exact(Number(obliquityDeg), locale)}°), the IAU 1976 value that defines the Horizons ecliptic, so that every source shares one frame.`,
        fr: `Chaque position est une position <strong>géométrique</strong>, sans correction de temps de lumière ni d’aberration : où se trouve le corps à cet instant, pas où il paraît depuis la Terre. Galaxy travaille dans l’<strong>écliptique J2000</strong>, le repère des fichiers JPL Horizons et des éléments orbitaux. astronomy-engine fournit des vecteurs équatoriaux J2000 (axes ICRF) ; ils sont tournés vers l’écliptique d’un angle égal à l’obliquité J2000, ε = ${exact(Number(obliquityArcsec), locale)}″ (${exact(Number(obliquityDeg), locale)}°), la valeur IAU 1976 qui définit l’écliptique d’Horizons, pour que toutes les sources partagent un même repère.`,
      })}</p><p>${L({
        en: 'The Sun is fixed at the origin: positions are heliocentric. The 3D scene maps the ecliptic onto its horizontal plane: scene X = ecliptic x, scene Y = ecliptic z (towards the north ecliptic pole), scene Z = −ecliptic y. This is a proper rotation (determinant +1), not a mirror, so orbits keep their true direction of travel.',
        fr: 'Le Soleil est fixé à l’origine : les positions sont héliocentriques. La scène 3D place l’écliptique dans son plan horizontal : X scène = x écliptique, Y scène = z écliptique (vers le pôle nord de l’écliptique), Z scène = −y écliptique. C’est une rotation propre (déterminant +1), pas un miroir : les orbites gardent leur vrai sens de parcours.',
      })}</p>`
    )
  );

  // 2. Temps
  sections.push(
    docSection(
      'time',
      L({ en: 'Time scale', fr: 'Échelle de temps' }),
      `<p>${L({
        en: `The date you choose is read as UTC. From 1972 onwards it is converted to Terrestrial Time with the table of leap seconds, held constant after the last one (TT − UTC = ${exact(lastTtMinusUtc, locale)} s since ${lastLeapDate}), which is the convention JPL Horizons applies to dates given in UT. Before 1972 the date is read as UT1 and ΔT = TT − UT1 follows the Espenak and Meeus model. A single module performs this conversion for every source, and installs it into astronomy-engine, so two sources never disagree about which instant is meant.`,
        fr: `La date choisie est lue en UTC. À partir de 1972, elle est convertie en Temps terrestre par la table des secondes intercalaires, maintenue constante après la dernière (TT − UTC = ${exact(lastTtMinusUtc, locale)} s depuis le ${lastLeapDate}), ce qui est la convention appliquée par JPL Horizons aux dates données en UT. Avant 1972, la date est lue comme UT1 et ΔT = TT − UT1 suit le modèle d’Espenak et Meeus. Un seul module fait cette conversion pour toutes les sources, et l’installe dans astronomy-engine : deux sources ne peuvent pas désigner deux instants différents.`,
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
      }),
      `<p>${L({
        en: 'For a planet, a moon or a small body, Galaxy tries the following sources in order and keeps the first that answers:',
        fr: 'Pour une planète, une lune ou un petit corps, Galaxy essaie les sources suivantes dans cet ordre et garde la première qui répond :',
      })}</p><ol class="doc-list">` +
        `<li>${L({
          en: `<strong>A JPL SPK kernel</strong> (SAT441, Saturn’s moons), when the site is configured to serve one. It then takes precedence over the Horizons files. ${summary.spk.enabledInProduction ? 'It is <strong>enabled</strong> on this site.' : 'It is <strong>not enabled</strong> on this site.'}`,
          fr: `<strong>Un noyau SPK du JPL</strong> (SAT441, lunes de Saturne), quand le site est configuré pour en servir un. Il passe alors avant les fichiers Horizons. ${summary.spk.enabledInProduction ? 'Il est <strong>activé</strong> sur ce site.' : 'Il n’est <strong>pas activé</strong> sur ce site.'}`,
        })}</li>` +
        `<li>${L({
          en: `<strong>Precomputed NASA/JPL Horizons files</strong> for ${binaryNatural.length} natural bodies: exact position and velocity states in the ${escapeHtml(manifest.frame)} frame, every ${days(naturalSteps)} days, from ${escapeHtml(manifest.coverage.start)} to ${escapeHtml(manifest.coverage.stop)}. A value from a file is compared with the body’s catalogue orbit and rejected if its distance is implausibly large or small; the next source then takes over.`,
          fr: `<strong>Fichiers NASA/JPL Horizons précalculés</strong> pour ${binaryNatural.length} corps naturels : états exacts de position et de vitesse dans le repère ${escapeHtml(manifest.frame)}, tous les ${days(naturalSteps)} jours, du ${escapeHtml(manifest.coverage.start)} au ${escapeHtml(manifest.coverage.stop)}. Une valeur issue d’un fichier est confrontée à l’orbite du corps dans le catalogue et rejetée si sa distance est trop grande ou trop petite pour être plausible ; la source suivante prend alors le relais.`,
        })}</li>` +
        `<li>${L({
          en: '<strong>astronomy-engine</strong>, an open-source library: VSOP87 for the planets, and analytic models for the Moon and the four Galilean moons.',
          fr: '<strong>astronomy-engine</strong>, une bibliothèque libre : VSOP87 pour les planètes, et des modèles analytiques pour la Lune et les quatre lunes galiléennes.',
        })}</li>` +
        `<li>${L({
          en: `<strong>Keplerian orbital elements</strong>: ${SMALL_BODY_ELEMENTS.length} small bodies, whose osculating elements come from Horizons at a stated epoch and are checked by a test against a Horizons position at that epoch (${barycentric} of them are referred to the Solar System barycentre: beyond Neptune, a heliocentric orbit carries the Sun’s own reflex motion); and a fallback for ${moonFallbacks} moons, derived by script from their Horizons files, used only when a file is missing, out of range or rejected.`,
          fr: `<strong>Éléments orbitaux képlériens</strong> : ${SMALL_BODY_ELEMENTS.length} petits corps, dont les éléments osculateurs viennent d’Horizons à une époque déclarée et qu’un test confronte à une position Horizons à cette époque (${barycentric} d’entre eux sont rapportés au barycentre du Système solaire : au-delà de Neptune, une orbite héliocentrique porte le mouvement réflexe du Soleil lui-même) ; et un repli pour ${moonFallbacks} lunes, dérivé par script de leurs fichiers Horizons, utilisé seulement quand un fichier manque, sort de sa couverture ou est rejeté.`,
        })}</li></ol><p>${L({
          en: `The ${binarySpacecraft.length} spacecraft and the ${INTERSTELLAR_OBJECTS.length} interstellar objects follow their own rule. A spacecraft is positioned only by its Horizons file, sampled at a step of ${days(spacecraftSteps)} days (${exact(spacecraftSteps[0]!, locale)} for: ${listNames(finestSpacecraft)}), and is not drawn outside the file’s coverage. An interstellar object is positioned by its hyperbolic elements and drawn only within ±${INTERSTELLAR_WINDOW_YEARS} years of perihelion, the range over which they were checked against Horizons.`,
          fr: `Les ${binarySpacecraft.length} sondes et les ${INTERSTELLAR_OBJECTS.length} objets interstellaires suivent leur propre règle. Une sonde est positionnée uniquement par son fichier Horizons, échantillonné à un pas de ${days(spacecraftSteps)} jours (${exact(spacecraftSteps[0]!, locale)} jour pour : ${listNames(finestSpacecraft)}), et n’est pas dessinée hors de la couverture de ce fichier. Un objet interstellaire est positionné par ses éléments hyperboliques et dessiné seulement à ±${INTERSTELLAR_WINDOW_YEARS} ans de son périhélie, la plage sur laquelle ils ont été vérifiés contre Horizons.`,
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
      }),
      `<p>${L({
        en: `A Horizons file holds exact states at a fixed step. Between two of them, a cubic (Hermite) curve is only valid if the body moves smoothly over the interval, which is false as soon as it completes several turns within one step. Galaxy therefore counts how many samples one revolution spans, using the catalogue’s mean period. From ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} samples per orbit upwards it uses the cubic. Below that, it propagates each of the two surrounding states along its own two-body orbit and blends them smoothly, so both ends stay exactly on the data.`,
        fr: `Un fichier Horizons contient des états exacts à pas fixe. Entre deux d’entre eux, une courbe cubique (Hermite) n’est valable que si le corps se déplace régulièrement sur l’intervalle, ce qui est faux dès qu’il fait plusieurs tours en un pas. Galaxy compte donc combien d’échantillons couvre une révolution, d’après la période moyenne du catalogue. À partir de ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} échantillons par orbite, il emploie la cubique. En dessous, il propage chacun des deux états qui encadrent la date le long de sa propre orbite à deux corps, puis les fond progressivement : chaque extrémité reste exactement sur les données.`,
      })}</p><p>${L({
        en: 'Two refinements follow the same rule, keeping the data and linking it with the right curve. When a moon is massive enough to pull its planet around a shared barycentre (Charon and Pluto), that wobble is removed before interpolation and added back at the requested date. For a declared list of moons close to a flattened planet, the conic is travelled at the measured mean rate rather than the instantaneous one.',
        fr: 'Deux raffinements suivent la même règle, garder les données et les relier par la bonne courbe. Quand une lune est assez massive pour faire tourner sa planète autour d’un barycentre commun (Charon et Pluton), ce ballant est retiré avant l’interpolation puis rajouté à la date demandée. Pour une liste déclarée de lunes proches d’une planète aplatie, la conique est parcourue au rythme moyen mesuré plutôt qu’au rythme instantané.',
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
      }),
      `<p>${L({
        en: 'For a closed orbit (eccentricity below 1), Kepler’s equation M = E − e sin E is solved for the eccentric anomaly. For an open orbit (eccentricity above 1, the interstellar objects), the hyperbolic form M = e sinh F − F is solved instead; the mean anomaly is then not an angle and is never reduced modulo 360°.',
        fr: 'Pour une orbite fermée (excentricité inférieure à 1), l’équation de Kepler M = E − e sin E est résolue pour l’anomalie excentrique. Pour une orbite ouverte (excentricité supérieure à 1, les objets interstellaires), c’est la forme hyperbolique M = e sinh F − F qui est résolue ; l’anomalie moyenne n’est alors pas un angle et n’est jamais ramenée modulo 360°.',
      })}</p><p>${L({
        en: `A small body orbiting the Sun moves at the rate set by the Sun’s gravitational parameter. A moon’s elements are referred to its planet, and its rate comes from its measured mean sidereal period, not from the Sun, nor from the instantaneous state the elements were taken from. Orbit lines of orbits with an eccentricity of ${exact(ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY, locale)} or more are sampled evenly in eccentric anomaly rather than in time, so that they reach their true closest point; hyperbolic trajectories are sampled evenly in hyperbolic anomaly.`,
        fr: `Un petit corps en orbite autour du Soleil se déplace au rythme fixé par le paramètre gravitationnel du Soleil. Les éléments d’une lune sont rapportés à sa planète, et son rythme vient de sa période sidérale moyenne mesurée, et non du Soleil ni de l’état instantané d’où les éléments ont été tirés. Les lignes des orbites d’excentricité ${exact(ORBIT_SAMPLE_WARP_MIN_ECCENTRICITY, locale)} ou plus sont échantillonnées régulièrement en anomalie excentrique plutôt que dans le temps, pour atteindre leur vrai point le plus proche ; les trajectoires hyperboliques le sont en anomalie hyperbolique.`,
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
      L({ en: 'SPK kernel', fr: 'Noyau SPK' }),
      `<p>${L({
        en: 'SPK is JPL’s binary format for high-precision ephemerides. Galaxy can read the SAT441 kernel for Saturn’s moons in a background worker, by HTTP range requests, composing segments through their common centre when the kernel stores no direct pair.',
        fr: 'SPK est le format binaire du JPL pour les éphémérides de haute précision. Galaxy sait lire le noyau SAT441 des lunes de Saturne dans un worker en arrière-plan, par requêtes HTTP partielles, en composant les segments par leur centre commun quand le noyau ne stocke pas la paire directe.',
      })} ${L(
        summary.spk.enabledInProduction
          ? {
              en: 'It is <strong>enabled</strong> on this site.',
              fr: 'Il est <strong>activé</strong> sur ce site.',
            }
          : {
              en: 'It is <strong>not enabled</strong> on this site, so Saturn’s moons use the Horizons files; the figures below were measured locally with the kernel.',
              fr: 'Il n’est <strong>pas activé</strong> sur ce site : les lunes de Saturne utilisent donc les fichiers Horizons ; les chiffres ci-dessous ont été mesurés localement avec le noyau.',
            }
      )}</p>` +
        (spkRows.length > 0
          ? docTable(
              L({
                en: 'SPK path against Horizons, position relative to Saturn',
                fr: 'Chemin SPK contre Horizons, position relative à Saturne',
              }),
              [
                L({ en: 'Moon', fr: 'Lune' }),
                L({ en: 'Window', fr: 'Fenêtre' }),
                L({ en: 'Mean (km)', fr: 'Moyenne (km)' }),
                L({ en: 'Max (km)', fr: 'Max (km)' }),
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
      }),
      `<p>${L({
        en: `Positions are computed in astronomical units (AU), then placed in the scene with a single constant K = ${SQRT_K} scene units, so that the Earth, at 1 AU, sits at ${SQRT_K} units in both modes. Only the display changes between the two modes; the computed position is the same.`,
        fr: `Les positions sont calculées en unités astronomiques (UA), puis placées dans la scène avec une seule constante K = ${SQRT_K} unités de scène : la Terre, à 1 UA, est à ${SQRT_K} unités dans les deux modes. Seul l’affichage change entre les deux modes ; la position calculée est la même.`,
      })}</p><ul class="doc-list"><li>${L({
        en: `<strong>Explore</strong> is true scale: distance = AU × ${SQRT_K}, and every body has its physical radius. A distant body can be too small to see, exactly as in space; navigation aids are drawn as labels, never by enlarging a body, and the optical zoom changes only the camera’s field of view.`,
        fr: `<strong>Exploration</strong> est à l’échelle réelle : distance = UA × ${SQRT_K}, et chaque corps a son rayon physique. Un corps lointain peut être trop petit pour être vu, exactement comme dans l’espace ; les aides à la navigation sont des étiquettes, jamais un corps agrandi, et le zoom optique ne change que le champ de la caméra.`,
      })}</li><li>${L({
        en: `<strong>Educational</strong> is not to scale: distances are compressed to √AU × ${SQRT_K} along the true direction, and bodies are drawn at enlarged teaching sizes so that all of them stay visible. Around ${listNames(spreadParents)}, the moons’ distances are then multiplied by one common factor per planet, the smallest that keeps every moon outside its enlarged planet, so their order of distance is preserved. Eccentric orbits keep their shape.`,
        fr: `<strong>Éducatif</strong> n’est pas à l’échelle : les distances sont compressées en √UA × ${SQRT_K} dans la vraie direction, et les corps sont dessinés à des tailles pédagogiques agrandies pour rester tous visibles. Autour de ${listNames(spreadParents)}, les distances des lunes sont ensuite multipliées par un facteur commun à chaque planète, le plus petit qui garde chaque lune hors de sa planète agrandie : leur ordre de distance est conservé. Les orbites excentriques gardent leur forme.`,
      })}</li></ul>`
    )
  );

  // 8. Validation
  const method = `<p>${L({
    en: `Every source is compared with the NASA/JPL Horizons API (geometric state vectors, J2000 ecliptic, time in UT) at ${summary.samplesPerCase} dates per row, spread over the window with a reproducible pseudo-random time of day. The error is the distance between Galaxy’s position and Horizons’ position, in kilometres and in radii of the body. Horizons is the reference here, not absolute truth: its own uncertainty is not included. Measured on ${escapeHtml(summary.generatedAt.slice(0, 10))} by <code>scripts/validate-against-horizons.mjs</code>, whose Horizons answers are cached so that the measurement can be replayed.`,
    fr: `Chaque source est comparée à l’API NASA/JPL Horizons (vecteurs d’état géométriques, écliptique J2000, temps UT) à ${summary.samplesPerCase} dates par ligne, réparties sur la fenêtre avec une heure pseudo-aléatoire reproductible. L’erreur est la distance entre la position de Galaxy et celle d’Horizons, en kilomètres et en rayons du corps. Horizons est ici la référence, pas la vérité absolue : sa propre incertitude n’est pas incluse. Mesuré le ${escapeHtml(summary.generatedAt.slice(0, 10))} par <code>scripts/validate-against-horizons.mjs</code>, dont les réponses Horizons sont mises en cache pour que la mesure puisse être rejouée.`,
  })}</p>`;
  const kmHeaders = [
    L({ en: 'Mean (km)', fr: 'Moyenne (km)' }),
    L({ en: '95th pct (km)', fr: '95ᵉ centile (km)' }),
    L({ en: 'Max (km)', fr: 'Max (km)' }),
  ];
  const radiiHeader = L({
    en: 'Mean (body radii)',
    fr: 'Moyenne (rayons du corps)',
  });
  const productionTable = docTable(
    L({
      en: `What the app shows, ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}: heliocentric position as the scene composes it (a moon includes its planet’s error)`,
      fr: `Ce que montre l’application, ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)} : position héliocentrique telle que la scène la compose (une lune inclut l’erreur de sa planète)`,
    }),
    [
      L({ en: 'Body', fr: 'Corps' }),
      L({ en: 'Source used', fr: 'Source retenue' }),
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
  const epochTable = docTable(
    L({
      en: 'Keplerian bodies close to their elements’ epoch; interstellar objects over their drawn window',
      fr: 'Corps képlériens près de l’époque de leurs éléments ; objets interstellaires sur leur fenêtre dessinée',
    }),
    [
      L({ en: 'Body', fr: 'Corps' }),
      L({ en: 'Window', fr: 'Fenêtre' }),
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
    }),
    [
      L({ en: 'Mission', fr: 'Mission' }),
      L({ en: 'Coverage', fr: 'Couverture' }),
      L({ en: 'Median (km)', fr: 'Médiane (km)' }),
      L({ en: '95th pct (km)', fr: '95ᵉ centile (km)' }),
      L({ en: 'Max (km)', fr: 'Max (km)' }),
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
          !(provider === 'horizons-binary' && spacecraftNames.has(r.body)) &&
          !(provider === 'spk' && r.n === 0)
      );
      if (providerRows.length === 0) return '';
      const table = docTable(
        L(PROVIDER_TITLES[provider]),
        [
          L({ en: 'Body', fr: 'Corps' }),
          L({ en: 'Frame', fr: 'Repère' }),
          L({ en: 'Window', fr: 'Fenêtre' }),
          L({ en: 'Dates', fr: 'Dates' }),
          L({ en: 'Mean (km)', fr: 'Moyenne (km)' }),
          L({ en: 'Median (km)', fr: 'Médiane (km)' }),
          L({ en: '95th pct (km)', fr: '95ᵉ centile (km)' }),
          L({ en: 'Max (km)', fr: 'Max (km)' }),
          radiiHeader,
        ],
        providerRows.map((r) => [
          escapeHtml(name(r.body, locale)),
          r.relative
            ? L({ en: 'relative to planet', fr: 'relatif à la planète' })
            : L({ en: 'heliocentric', fr: 'héliocentrique' }),
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
      L({ en: 'Measured accuracy', fr: 'Précision mesurée' }),
      method +
        productionTable +
        `<p>${L({
          en: 'Keplerian elements describe an orbit without the pull of the planets, so their error grows with the distance in time from their epoch. Over two centuries it is large; near the epoch it is much smaller:',
          fr: 'Des éléments képlériens décrivent une orbite sans l’attraction des planètes : leur erreur croît avec l’écart en temps à leur époque. Sur deux siècles elle est grande ; près de l’époque elle est bien plus petite :',
        })}</p>` +
        epochTable +
        `<p>${L({
          en: 'For spacecraft the median is the meaningful figure: errors peak briefly around close flybys and perihelia, where the trajectory bends faster than the file’s step can resolve.',
          fr: 'Pour les sondes, la médiane est le chiffre parlant : l’erreur culmine brièvement autour des survols rapprochés et des périhélies, où la trajectoire se courbe plus vite que le pas du fichier ne peut le résoudre.',
        })}</p>` +
        spacecraftTable +
        `<h3>${L({ en: 'Full measurements, by source', fr: 'Mesures complètes, par source' })}</h3><p>${L(
          {
            en: 'Each source measured on its own, over its own windows, including those the app only uses as a fallback. “Dates” is the number of dates at which the source gave a position.',
            fr: 'Chaque source mesurée seule, sur ses propres fenêtres, y compris celles que l’application n’emploie qu’en repli. « Dates » est le nombre de dates auxquelles la source a donné une position.',
          }
        )}</p>` +
        detailTables
    )
  );

  // 8b. Ce que dit une date
  // Les LIBELLÉS viennent du dictionnaire de l'application : la page et la fiche ne peuvent pas
  // diverger. Le type impose une explication par catégorie — en ajouter une sans l'expliquer ici
  // ne compile pas.
  const CATEGORY_NOTES: Record<TemporalCategory, Bilingual> = {
    live: {
      en: 'the scene is at the present moment, within five minutes, and the data describes it.',
      fr: 'la scène est au présent, à cinq minutes près, et la donnée décrit ce présent.',
    },
    observed: {
      en: 'a measurement of a past instant, such as a satellite image of that day.',
      fr: 'une mesure d’un instant passé, par exemple l’image satellite de ce jour.',
    },
    reported: {
      en: 'an event a third party reported and another party gathered, such as a wildfire or a storm listed by NASA EONET. It is neither a measurement nor a model, and EONET itself asks that its extents not be taken as official. An event with no declared end is shown as ongoing rather than given an invented end date.',
      fr: 'un événement rapporté par un tiers et agrégé par un autre, par exemple un incendie ou une tempête listés par NASA EONET. Ce n’est ni une mesure ni un modèle, et EONET demande lui-même que ses emprises ne soient pas tenues pour officielles. Un événement sans fin déclarée est affiché « en cours » plutôt que doté d’une date de fin inventée.',
    },
    reconstructed: {
      en: 'a model of a past or present instant, such as a reanalysis (ERA5, MERRA-2) or a position computed for a date already behind us.',
      fr: 'un modèle sur un instant passé ou présent, par exemple une réanalyse (ERA5, MERRA-2) ou une position calculée pour une date déjà derrière nous.',
    },
    predicted: {
      en: 'a model of a future instant, inside the window where its source has been measured. A weather forecast beyond a week is marked as having low confidence.',
      fr: 'un modèle sur un instant futur, dans la fenêtre où sa source a été mesurée. Une prévision météo au-delà d’une semaine est signalée en confiance réduite.',
    },
    extrapolated: {
      en: 'a calculation outside every window where its gap to the reference was measured. It still draws something, and says that nothing establishes it.',
      fr: 'un calcul hors de toute fenêtre où son écart à la référence a été mesuré. Il dessine quand même quelque chose, et le dit.',
    },
    unavailable: {
      en: 'no data for that instant, so nothing is drawn rather than something borrowed from another date.',
      fr: 'aucune donnée pour cet instant : rien n’est dessiné, plutôt qu’une donnée empruntée à une autre date.',
    },
  };
  sections.push(
    docSection(
      'temporal',
      L({ en: 'What a date says', fr: 'Ce que dit une date' }),
      `<p>${L({
        en: 'The scene shows one instant, but each piece of data describes an instant of its own, and they rarely coincide. Satellite imagery does not exist for a scene set in 2030, so the latest real image is shown and the gap to the scene is written next to it. Every dated element therefore carries its own label, and there is no single control saying the whole scene is accurate: the label says what the data is, the measured gap says how far it is.',
        fr: 'La scène montre un instant, mais chaque donnée décrit le sien, et les deux coïncident rarement. L’imagerie satellite n’existe pas pour une scène en 2030 : la dernière image réelle est affichée, et l’écart à la scène est écrit à côté. Chaque élément daté porte donc son étiquette, et aucun réglage unique ne prétend que toute la scène est exacte : l’étiquette dit ce qu’est la donnée, l’écart mesuré dit de combien elle s’en écarte.',
      })}</p><ul class="doc-list">${TEMPORAL_CATEGORIES.map(
        (category) =>
          `<li><strong>${escapeHtml(
            messages[locale][temporalCategoryLabelKey(category)] ?? category
          )}</strong>${L({ en: ':', fr: ' :' })} ${L(CATEGORY_NOTES[category])}</li>`
      ).join('')}</ul>`
    )
  );

  // 9. Limites connues
  const earth = productionOf('earth');
  const limits: Bilingual[] = [
    {
      en: `The Earth is drawn at the Earth-Moon barycentre, not at its own centre, to avoid a monthly wobble that would show as a zigzag at true scale and high speed; the Moon is placed correctly relative to that point. This offset is what the Earth row of the accuracy table measures${earth ? ` (${num(earth.km?.mean)} km on average)` : ''}.`,
      fr: `La Terre est dessinée au barycentre Terre-Lune, pas en son propre centre, pour éviter un ballant mensuel qui se verrait comme un zigzag à vraie échelle et à grande vitesse ; la Lune est placée correctement par rapport à ce point. Ce décalage est ce que mesure la ligne Terre du tableau de précision${earth ? ` (${num(earth.km?.mean)} km en moyenne)` : ''}.`,
    },
    {
      en: `Bodies positioned by Keplerian elements alone (${listNames(keplerOnly.map((r) => r.body))}) drift away from their true position far from their epoch, because the two-body model ignores planetary perturbations. The tables above give the size of that drift.`,
      fr: `Les corps positionnés par leurs seuls éléments képlériens (${listNames(keplerOnly.map((r) => r.body))}) s’écartent de leur vraie position loin de leur époque, parce que le modèle à deux corps ignore les perturbations des planètes. Les tableaux ci-dessus donnent l’ampleur de cette dérive.`,
    },
    {
      en: `Outside ${escapeHtml(manifest.coverage.start)} to ${escapeHtml(manifest.coverage.stop)}, the Horizons files do not apply: planets fall back to astronomy-engine, other bodies to their Keplerian elements. The production table covers ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)} only; the full measurements show the sources over wider windows.`,
      fr: `Hors de la période du ${escapeHtml(manifest.coverage.start)} au ${escapeHtml(manifest.coverage.stop)}, les fichiers Horizons ne s’appliquent pas : les planètes retombent sur astronomy-engine, les autres corps sur leurs éléments képlériens. Le tableau de production ne couvre que ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)} ; les mesures complètes montrent les sources sur des fenêtres plus larges.`,
    },
    {
      en: 'The asteroids and comets of the optional small-body layer, several thousand of them, come from a dated snapshot of the JPL Small-Body Database shipped with the build, and are propagated from its elements. They are not part of this measurement.',
      fr: 'Les astéroïdes et comètes de la couche optionnelle des petits corps, plusieurs milliers, viennent d’un instantané daté de la JPL Small-Body Database livré avec le build, et sont propagés depuis ses éléments. Ils ne font pas partie de cette mesure.',
    },
    ...(drifts.length > 0
      ? [
          {
            en: `Some synchronous moons do not spin exactly at their orbital period in the catalogue, so the face they turn towards their planet slowly drifts: ${drifts.map((d) => `${escapeHtml(name(d.body, 'en'))} ${formatQuantity(d.degreesPerYear, 'en')}° per year`).join(', ')}. The other synchronous moons are locked exactly.`,
            fr: `Certaines lunes synchrones ne tournent pas exactement à leur période orbitale dans le catalogue : la face qu’elles tournent vers leur planète dérive lentement, ${drifts.map((d) => `${escapeHtml(name(d.body, 'fr'))} ${formatQuantity(d.degreesPerYear, 'fr')}° par an`).join(', ')}. Les autres lunes synchrones sont verrouillées exactement.`,
          },
        ]
      : []),
    {
      en: `${ILLUSTRATIVE_SURFACES.size} bodies have never been mapped globally: their surfaces are illustrative, not scientific. The <a href="${docPath('sources', locale)}">sources page</a> lists them.`,
      fr: `${ILLUSTRATIVE_SURFACES.size} corps n’ont jamais été cartographiés globalement : leur surface est illustrative, pas scientifique. La <a href="${docPath('sources', locale)}">page des sources</a> les énumère.`,
    },
  ];
  sections.push(
    docSection(
      'limits',
      L({ en: 'Known limits', fr: 'Limites connues' }),
      `<ul class="doc-list">${limits.map((l) => `<li>${L(l)}</li>`).join('')}</ul>`
    )
  );

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
