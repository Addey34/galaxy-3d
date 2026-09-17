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
import { flattenBodies, ILLUSTRATIVE_SURFACES } from '@/config/catalog';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import {
  INTERSTELLAR_OBJECTS,
  INTERSTELLAR_WINDOW_YEARS,
} from '@/config/interstellar';
import { SMALL_BODY_ELEMENTS } from '@/config/smallBodies';
import { OBLIQUITY_RAD } from '@/core/frames';
import { SQRT_K } from '@/core/ScaleService';
import { MIN_SAMPLES_PER_ORBIT_FOR_HERMITE } from '@/core/HorizonsEphemerisService';
import { TT_MINUS_UTC } from '@/core/timeScale';
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

function methodologyPage(input: MethodologyInput, locale: DocLocale): DocPage {
  const { summary, manifest, config, origin } = input;
  const L = (text: Bilingual): string => text[locale];
  const name = displayNameResolver(config);
  const rows = summary.rows;
  const production = rows.filter((r) => r.provider === 'production');
  const spacecraftNames = new Set(SPACECRAFT_MISSIONS.map((m) => m.name));

  // ── Constantes lues dans le code qui les applique ──
  const obliquityDeg = ((OBLIQUITY_RAD * 180) / Math.PI).toFixed(4);
  const [lastLeapMs, lastTtMinusUtc] = TT_MINUS_UTC[TT_MINUS_UTC.length - 1]!;
  const lastLeapYear = new Date(lastLeapMs).getUTCFullYear();

  // ── Manifest des éphémérides ──
  const binaries = Object.entries(manifest.bodies);
  const binarySpacecraft = binaries.filter(([n]) => spacecraftNames.has(n));
  const binaryNatural = binaries.filter(([n]) => !spacecraftNames.has(n));
  const naturalSteps = [
    ...new Set(binaryNatural.map(([, e]) => e.stepDays)),
  ].sort((a, b) => a - b);
  const spacecraftSteps = [
    ...new Set(binarySpacecraft.map(([, e]) => e.stepDays)),
  ].sort((a, b) => a - b);
  const listNames = (names: readonly string[]): string =>
    names.map((n) => escapeHtml(name(n, locale))).join(', ');
  const days = (values: readonly number[]): string =>
    values.map((v) => exact(v, locale)).join(locale === 'fr' ? ' ou ' : ' or ');

  // ── Petits corps et objets interstellaires ──
  const barycentric = SMALL_BODY_ELEMENTS.filter((el) => el.barycentric).length;
  const keplerOnly = production.filter(
    (r) => Object.keys(r.sources).length === 1 && r.sources.kepler
  );

  const sections: string[] = [];

  // 1. Repères
  sections.push(
    docSection(
      'frames',
      L({ en: 'Reference frames', fr: 'Repères' }),
      `<p>${L({
        en: `Every position is a <strong>geometric</strong> position (no light-time or aberration correction): where a body is at that instant, not where it appears from Earth. Planetary theories and JPL files are expressed in the J2000 frame (ICRF); Galaxy works in the <strong>J2000 ecliptic</strong>, obtained from the equatorial frame by a rotation of the obliquity ε = ${exact(Number(obliquityDeg), locale)}° about the vernal equinox axis.`,
        fr: `Chaque position est une position <strong>géométrique</strong> (sans correction de temps de lumière ni d’aberration) : où se trouve le corps à cet instant, pas où il paraît depuis la Terre. Théories planétaires et fichiers JPL sont exprimés dans le repère J2000 (ICRF) ; Galaxy travaille dans l’<strong>écliptique J2000</strong>, obtenu du repère équatorial par une rotation de l’obliquité ε = ${exact(Number(obliquityDeg), locale)}° autour de l’axe de l’équinoxe vernal.`,
      })}</p><p>${L({
        en: 'The 3D scene then maps the ecliptic onto its horizontal plane: scene X = ecliptic x, scene Y = ecliptic z (towards the north ecliptic pole), scene Z = −ecliptic y. This is a proper rotation (determinant +1), not a mirror, so orbits keep their true direction of travel.',
        fr: 'La scène 3D place ensuite l’écliptique dans son plan horizontal : X scène = x écliptique, Y scène = z écliptique (vers le pôle nord de l’écliptique), Z scène = −y écliptique. C’est une rotation propre (déterminant +1), pas un miroir : les orbites gardent leur vrai sens de parcours.',
      })}</p>`
    )
  );

  // 2. Temps
  sections.push(
    docSection(
      'time',
      L({ en: 'Time scale', fr: 'Échelle de temps' }),
      `<p>${L({
        en: `The date you choose is read as UTC. It is converted to Terrestrial Time with the table of leap seconds since 1972, held constant after the last one (${lastLeapYear}, TT − UTC = ${exact(lastTtMinusUtc, locale)} s), which is the convention JPL Horizons applies. Before 1972 the date is read as UT1 and ΔT follows the Espenak and Meeus model. A single module performs this conversion for every source, so two sources never disagree about which instant is meant.`,
        fr: `La date choisie est lue en UTC. Elle est convertie en Temps terrestre par la table des secondes intercalaires depuis 1972, maintenue constante après la dernière (${lastLeapYear}, TT − UTC = ${exact(lastTtMinusUtc, locale)} s), ce qui est la convention appliquée par JPL Horizons. Avant 1972, la date est lue comme UT1 et ΔT suit le modèle d’Espenak et Meeus. Un seul module fait cette conversion pour toutes les sources : deux sources ne peuvent pas désigner deux instants différents.`,
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
        en: 'For each body, Galaxy tries the following sources in order and keeps the first that answers:',
        fr: 'Pour chaque corps, Galaxy essaie les sources suivantes dans cet ordre et garde la première qui répond :',
      })}</p><ol class="doc-list">` +
        `<li>${L({
          en: `<strong>Precomputed NASA/JPL Horizons files</strong> for ${binaryNatural.length} natural bodies and ${binarySpacecraft.length} spacecraft: exact position and velocity states in the ${escapeHtml(manifest.frame)} frame, every ${days(naturalSteps)} days for natural bodies and ${days(spacecraftSteps)} days for spacecraft, from ${escapeHtml(manifest.coverage.start)} to ${escapeHtml(manifest.coverage.stop)} (spacecraft: over each mission’s own span). A value from a file must pass a plausibility test that bounds its distance on both sides, otherwise the next source takes over.`,
          fr: `<strong>Fichiers NASA/JPL Horizons précalculés</strong> pour ${binaryNatural.length} corps naturels et ${binarySpacecraft.length} sondes : états exacts de position et de vitesse dans le repère ${escapeHtml(manifest.frame)}, tous les ${days(naturalSteps)} jours pour les corps naturels et ${days(spacecraftSteps)} jours pour les sondes, du ${escapeHtml(manifest.coverage.start)} au ${escapeHtml(manifest.coverage.stop)} (sondes : sur la durée propre de chaque mission). Une valeur issue d’un fichier doit passer un test de plausibilité qui borne sa distance des deux côtés, sinon la source suivante prend le relais.`,
        })}</li>` +
        `<li>${L({
          en: '<strong>An optional JPL SPK kernel</strong> (SAT441, Saturn’s moons), used only when the site is configured to serve it.',
          fr: '<strong>Un noyau SPK du JPL optionnel</strong> (SAT441, lunes de Saturne), utilisé seulement si le site est configuré pour le servir.',
        })}</li>` +
        `<li>${L({
          en: '<strong>astronomy-engine</strong>, an open-source library implementing VSOP87 for the planets and analytic models for the Moon and the four Galilean moons.',
          fr: '<strong>astronomy-engine</strong>, une bibliothèque libre qui implémente VSOP87 pour les planètes et des modèles analytiques pour la Lune et les quatre lunes galiléennes.',
        })}</li>` +
        `<li>${L({
          en: `<strong>Keplerian orbital elements</strong>: ${SMALL_BODY_ELEMENTS.length} small bodies (${barycentric} of them referred to the Solar System barycentre, beyond Neptune, where the heliocentric orbit carries the Sun’s own reflex motion), the ${INTERSTELLAR_OBJECTS.length} interstellar objects, and a fallback for every moon when its file is missing. Every element set comes from Horizons at a stated epoch and is checked by a test against a Horizons position at that epoch.`,
          fr: `<strong>Éléments orbitaux képlériens</strong> : ${SMALL_BODY_ELEMENTS.length} petits corps (dont ${barycentric} rapportés au barycentre du Système solaire, au-delà de Neptune, où l’orbite héliocentrique porte le mouvement réflexe du Soleil lui-même), les ${INTERSTELLAR_OBJECTS.length} objets interstellaires, et un repli pour chaque lune dont le fichier manque. Chaque jeu d’éléments vient d’Horizons à une époque déclarée et un test le confronte à une position Horizons à cette époque.`,
        })}</li></ol>`
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
        en: `A Horizons file holds exact states at a fixed step. Between two of them, a cubic (Hermite) curve is only valid if the body moves smoothly over the interval. Galaxy therefore counts how many samples one revolution spans, using the catalogue’s mean period: from ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} samples per orbit upwards it uses the cubic; below that, it propagates each of the two surrounding states along its own two-body orbit and blends them smoothly, so both ends stay exactly on the data.`,
        fr: `Un fichier Horizons contient des états exacts à pas fixe. Entre deux d’entre eux, une courbe cubique (Hermite) n’est valable que si le corps se déplace régulièrement sur l’intervalle. Galaxy compte donc combien d’échantillons couvre une révolution, d’après la période moyenne du catalogue : à partir de ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} échantillons par orbite, il emploie la cubique ; en dessous, il propage chacun des deux états qui encadrent la date le long de sa propre orbite à deux corps, puis les fond progressivement, si bien que chaque extrémité reste exactement sur les données.`,
      })}</p><p>${L({
        en: 'Two refinements follow the same rule of keeping the data and linking it with the right curve: when a moon is massive enough to pull its planet around a shared barycentre (Charon and Pluto), that wobble is removed before interpolation and added back at the requested date; and for moons close to a flattened planet, the conic is travelled at the measured mean rate rather than the instantaneous one.',
        fr: 'Deux raffinements suivent la même règle, garder les données et les relier par la bonne courbe : quand une lune est assez massive pour faire tourner sa planète autour d’un barycentre commun (Charon et Pluton), ce ballant est retiré avant l’interpolation puis rajouté à la date demandée ; et pour les lunes proches d’une planète aplatie, la conique est parcourue au rythme moyen mesuré plutôt qu’au rythme instantané.',
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
        en: `A moon’s elements are referred to its planet, whose mass sets the rate of motion; the period used is the measured mean sidereal period, not the one implied by an instantaneous state. An open trajectory has no full turn, so each interstellar object is only drawn within ±${INTERSTELLAR_WINDOW_YEARS} years of its perihelion. Orbit lines are sampled evenly in eccentric (or hyperbolic) anomaly rather than in time, so that very eccentric orbits reach their true closest point to the Sun.`,
        fr: `Les éléments d’une lune sont rapportés à sa planète, dont la masse fixe la vitesse de parcours ; la période employée est la période sidérale moyenne mesurée, pas celle qu’implique un état instantané. Une trajectoire ouverte n’a pas de tour complet : chaque objet interstellaire n’est dessiné qu’à ±${INTERSTELLAR_WINDOW_YEARS} ans de son périhélie. Les lignes d’orbite sont échantillonnées régulièrement en anomalie excentrique (ou hyperbolique) plutôt que dans le temps, pour que les orbites très excentriques atteignent leur vrai point le plus proche du Soleil.`,
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
        en: `SPK is JPL’s binary format for high-precision ephemerides. Galaxy can read the SAT441 kernel for Saturn’s moons in a background worker, by HTTP range requests, composing segments through their common centre when the kernel stores no direct pair. ${summary.spk.enabledInProduction ? 'It is <strong>enabled</strong> on this site.' : 'It is <strong>not enabled</strong> on this site, so Saturn’s moons use the Horizons files above.'}`,
        fr: `SPK est le format binaire du JPL pour les éphémérides de haute précision. Galaxy sait lire le noyau SAT441 des lunes de Saturne dans un worker en arrière-plan, par requêtes HTTP partielles, en composant les segments par leur centre commun quand le noyau ne stocke pas la paire directe. ${summary.spk.enabledInProduction ? 'Il est <strong>activé</strong> sur ce site.' : 'Il n’est <strong>pas activé</strong> sur ce site : les lunes de Saturne utilisent donc les fichiers Horizons ci-dessus.'}`,
      })}</p>` +
        (spkRows.length > 0
          ? docTable(
              L({
                en: 'SPK path measured locally against Horizons, position relative to Saturn',
                fr: 'Chemin SPK mesuré localement contre Horizons, position relative à Saturne',
              }),
              [
                L({ en: 'Moon', fr: 'Lune' }),
                L({ en: 'Window', fr: 'Fenêtre' }),
                L({ en: 'Mean (km)', fr: 'Moyenne (km)' }),
                L({ en: 'Max (km)', fr: 'Max (km)' }),
              ],
              spkRows.map((r) => [
                escapeHtml(name(r.body, locale)),
                `${year(r.windowFrom)}–${year(r.windowTo)}`,
                q(r.km?.mean, locale),
                q(r.km?.max, locale),
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
        en: `Positions are computed in astronomical units (AU), then placed in the scene with a single constant K = ${SQRT_K} scene units, so that the Earth, at 1 AU, sits at ${SQRT_K} units in both modes.`,
        fr: `Les positions sont calculées en unités astronomiques (UA), puis placées dans la scène avec une seule constante K = ${SQRT_K} unités de scène : la Terre, à 1 UA, est à ${SQRT_K} unités dans les deux modes.`,
      })}</p><ul class="doc-list"><li>${L({
        en: `<strong>Explore</strong> is true scale: distance = AU × ${SQRT_K}, with physical radii. A distant body can be too small to see, exactly as in space; navigation aids are drawn as labels, never by enlarging the body, and the optical zoom changes the camera’s field of view only.`,
        fr: `<strong>Exploration</strong> est à l’échelle réelle : distance = UA × ${SQRT_K}, avec les rayons physiques. Un corps lointain peut être trop petit pour être vu, exactement comme dans l’espace ; les aides à la navigation sont des étiquettes, jamais un corps agrandi, et le zoom optique ne change que le champ de la caméra.`,
      })}</li><li>${L({
        en: `<strong>Educational</strong> compresses distances only: distance = √AU × ${SQRT_K}, along the true direction. Eccentric orbits keep their shape, but the gaps between planets are not to scale.`,
        fr: `<strong>Éducatif</strong> ne compresse que les distances : distance = √UA × ${SQRT_K}, dans la vraie direction. Les orbites excentriques gardent leur forme, mais les écarts entre planètes ne sont pas à l’échelle.`,
      })}</li></ul>`
    )
  );

  // 8. Validation
  const method = `<p>${L({
    en: `Every source is compared with the NASA/JPL Horizons API (geometric vectors, ecliptic plane, time in UT) at ${summary.samplesPerCase} dates per row, spread over the window with a reproducible pseudo-random time of day. The error is the distance between Galaxy’s position and Horizons’ position. Horizons is the reference here, not absolute truth: its own uncertainty is not included. Measured on ${escapeHtml(summary.generatedAt.slice(0, 10))} by the script <code>scripts/validate-against-horizons.mjs</code>.`,
    fr: `Chaque source est comparée à l’API NASA/JPL Horizons (vecteurs géométriques, plan de l’écliptique, temps UT) à ${summary.samplesPerCase} dates par ligne, réparties sur la fenêtre avec une heure pseudo-aléatoire reproductible. L’erreur est la distance entre la position de Galaxy et celle d’Horizons. Horizons est ici la référence, pas la vérité absolue : sa propre incertitude n’est pas incluse. Mesuré le ${escapeHtml(summary.generatedAt.slice(0, 10))} par le script <code>scripts/validate-against-horizons.mjs</code>.`,
  })}</p>`;
  const productionTable = docTable(
    L({
      en: `What the app shows: heliocentric position as the scene composes it (a moon includes its planet’s error), ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}`,
      fr: `Ce que montre l’application : position héliocentrique telle que la scène la compose (une lune inclut l’erreur de sa planète), ${year(production[0]!.windowFrom)}–${year(production[0]!.windowTo)}`,
    }),
    [
      L({ en: 'Body', fr: 'Corps' }),
      L({ en: 'Source used', fr: 'Source retenue' }),
      L({ en: 'Mean (km)', fr: 'Moyenne (km)' }),
      L({ en: '95th pct (km)', fr: '95e centile (km)' }),
      L({ en: 'Max (km)', fr: 'Max (km)' }),
      L({ en: 'Mean (body radii)', fr: 'Moyenne (rayons du corps)' }),
    ],
    production.map((r) => [
      escapeHtml(name(r.body, locale)),
      sourceLabel(r, locale),
      q(r.km?.mean, locale),
      q(r.km?.p95, locale),
      q(r.km?.max, locale),
      q(r.radii?.mean, locale),
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
      en: 'Keplerian bodies close to their elements’ epoch (interstellar objects: over their drawn window)',
      fr: 'Corps képlériens près de l’époque de leurs éléments (objets interstellaires : sur leur fenêtre dessinée)',
    }),
    [
      L({ en: 'Body', fr: 'Corps' }),
      L({ en: 'Window', fr: 'Fenêtre' }),
      L({ en: 'Mean (km)', fr: 'Moyenne (km)' }),
      L({ en: '95th pct (km)', fr: '95e centile (km)' }),
      L({ en: 'Max (km)', fr: 'Max (km)' }),
    ],
    nearEpoch.map((r) => [
      escapeHtml(name(r.body, locale)),
      `${escapeHtml(r.windowFrom)} → ${escapeHtml(r.windowTo)}`,
      q(r.km?.mean, locale),
      q(r.km?.p95, locale),
      q(r.km?.max, locale),
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
      L({ en: '95th pct (km)', fr: '95e centile (km)' }),
      L({ en: 'Max (km)', fr: 'Max (km)' }),
    ],
    spacecraftRows.map((r) => [
      escapeHtml(name(r.body, locale)),
      `${escapeHtml(r.windowFrom)} → ${escapeHtml(r.windowTo)}`,
      q(r.km?.median, locale),
      q(r.km?.p95, locale),
      q(r.km?.max, locale),
    ]),
    2
  );

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
          en: 'For spacecraft the median is the meaningful figure: files are sampled at a fixed step of a day or a few days, and errors peak briefly around close flybys and perihelia, where the trajectory bends faster than that step can resolve.',
          fr: 'Pour les sondes, la médiane est le chiffre parlant : les fichiers sont échantillonnés à pas fixe d’un ou quelques jours, et l’erreur culmine brièvement autour des survols rapprochés et des périhélies, où la trajectoire se courbe plus vite que ce pas ne peut le résoudre.',
        })}</p>` +
        spacecraftTable
    )
  );

  // 9. Limites connues
  const limits: Bilingual[] = [
    {
      en: `Bodies positioned by Keplerian elements alone (${listNames(keplerOnly.map((r) => r.body))}) drift away from their true position far from their epoch: the two-body model ignores planetary perturbations. See the tables above for the size of that drift.`,
      fr: `Les corps positionnés par leurs seuls éléments képlériens (${listNames(keplerOnly.map((r) => r.body))}) s’écartent de leur vraie position loin de leur époque : le modèle à deux corps ignore les perturbations des planètes. Les tableaux ci-dessus donnent l’ampleur de cette dérive.`,
    },
    {
      en: `Outside ${escapeHtml(year(manifest.coverage.start))}–${escapeHtml(year(manifest.coverage.stop))}, the Horizons files do not apply and every body falls back to astronomy-engine or Keplerian elements. The accuracy table covers that period only.`,
      fr: `Hors de ${escapeHtml(year(manifest.coverage.start))}–${escapeHtml(year(manifest.coverage.stop))}, les fichiers Horizons ne s’appliquent pas et chaque corps retombe sur astronomy-engine ou sur ses éléments képlériens. Le tableau de précision ne couvre que cette période.`,
    },
    {
      en: 'The Galilean moons and the Earth’s Moon come from astronomy-engine’s analytic models rather than from JPL files; their measured error is in the table above.',
      fr: 'Les lunes galiléennes et la Lune viennent des modèles analytiques d’astronomy-engine et non de fichiers JPL ; leur erreur mesurée figure dans le tableau ci-dessus.',
    },
    {
      en: 'The rotation of synchronous moons is driven by rounded published periods, so the face they turn towards their planet can slowly drift over years.',
      fr: 'La rotation des lunes synchrones suit des périodes publiées arrondies : la face qu’elles tournent vers leur planète peut dériver lentement au fil des années.',
    },
    {
      en: `${ILLUSTRATIVE_SURFACES.size} bodies have never been imaged well enough for a global map: their surfaces are illustrative, not scientific. The <a href="${docPath('sources', locale)}">sources page</a> lists which ones and why.`,
      fr: `${ILLUSTRATIVE_SURFACES.size} corps n’ont jamais été photographiés assez bien pour une carte globale : leur surface est illustrative, pas scientifique. La <a href="${docPath('sources', locale)}">page des sources</a> dit lesquels et pourquoi.`,
    },
    {
      en: 'In Educational mode distances are compressed and body sizes are not to scale with them; only Explore mode is a true-scale view.',
      fr: 'En mode Éducatif, les distances sont compressées et les tailles ne sont pas à la même échelle qu’elles ; seul le mode Exploration est une vue à l’échelle réelle.',
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
