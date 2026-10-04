/**
 * PAGES PUBLIQUES DES OBJETS D'INSTRUMENT : les onze sondes et les trois interstellaires
 * (2026-10-03).
 *
 * Chaque corps du catalogue avait sa page indexable et sa vignette ; ces quatorze objets n'en
 * avaient aucune. C'était une décision écrite (`docs/ARCHITECTURE.md` § « Objets d'instrument
 * navigables » : une sonde « n'a rien » de ce qu'une page présente), juste à son époque. Elle ne
 * l'est plus : les sondes portent depuis des faits de lancement sourcés et ce que l'archive du
 * PDS déclare qu'elles embarquent, et les interstellaires leurs éléments d'orbite de la SBDB.
 *
 * Ce module ne fait PAS entrer ces objets dans le catalogue des corps, et c'est le choix qui
 * reste : il lit `NAVIGABLE_TARGETS`, la table que la fiche de l'application lit déjà, et rend
 * des pages par le même `renderLandingPage` que les corps et les éclipses. Les faits passent par
 * `core/bodyFacts.ts`, comme sur la fiche : une valeur sans source ne se montre pas plus ici
 * qu'ailleurs.
 *
 * PUR, comme les autres générateurs : les fichiers (archive du PDS, manifeste des éphémérides)
 * sont lus par le greffon de build et passés en argument.
 */
import type { CelestialBodyConfig, FactField } from '@/types';
import {
  bodyFact,
  citationOrder,
  displayedAbsoluteUncertainty,
  SCIENTIFIC_MASS_KG,
  type FactEntry,
} from '@/core/bodyFacts';
import { groupByHost, type SpacecraftArchive } from '@/core/instruments';
import { factSource } from '@/config/factSources';
import { messages } from '@/i18n/allDictionaries';
import { INTL_LOCALE, LOCALE_PATH, LOCALES, type Locale } from '@/i18n/locales';
import {
  bodyPagePath,
  escapeHtml,
  formatMass,
  formatNumber,
  renderLandingPage,
  trimForMeta,
  type BodyFact,
  type BodySource,
  type LandingPage,
} from './bodyLandingPage';

/** Ce que le greffon fournit pour une sonde : son archive du PDS, ou la raison de son absence. */
export type ArchiveInput =
  { status: 'declared'; archive: SpacecraftArchive } | { status: 'absent' };

export interface InstrumentPageInputs {
  /** Archive du PDS par sonde (absente pour un interstellaire). */
  archives: ReadonlyMap<string, ArchiveInput>;
  /** Date de lecture de l'archive du PDS (`AAAA-MM-JJ`). */
  archiveRetrieved: string;
  /** Couverture du fichier Horizons de chaque sonde, en jours ISO, lue dans le manifeste. */
  coverage: ReadonlyMap<string, { from: string; to: string }>;
  /**
   * Identifiant PDS d'une mission → chemin de sa page sans la langue (`missions/juno`). Une
   * investigation qui n'a pas de page (une campagne d'observation n'est pas une mission) reste
   * un nom sans lien.
   */
  missionPages?: ReadonlyMap<string, string>;
}

export interface InstrumentPage extends LandingPage {
  slug: string;
  /** Clé de l'objet, indépendante de la langue : elle nomme la vignette. */
  body: string;
  kind: 'spacecraft' | 'interstellar';
  locale: Locale;
  displayName: string;
  summary: string;
  facts: BodyFact[];
  sources: BodySource[];
  /** Le bloc propre à l'objet (instruments, trajectoire), déjà en HTML échappé. */
  extra: string;
  /** Couleur du marqueur dans l'application, `#rrggbb` : la vignette peint le même point. */
  color: string;
}

/** Les faits d'une page d'objet, dans l'ordre de la fiche ; `bodyFact` écarte les non-applicables. */
const INSTRUMENT_FACT_ORDER: readonly FactField[] = [
  'massKg',
  'launchDate',
  'launchVehicle',
  'launchSite',
  'firstObservation',
  'eccentricity',
  'perihelionAU',
  'absoluteMagnitude',
];

const TEXT = {
  intro: {
    spacecraft: {
      // Sans accord de genre : « la sonde » Voyager, mais « le télescope » James Webb.
      en: 'The real position of {name} is shown, from the trajectory computed by NASA JPL Horizons. The view opens on {name}; you can travel in time, follow its route and compare it with the planets.',
      fr: 'La position réelle de {name} est montrée, d’après la trajectoire calculée par NASA JPL Horizons. La vue s’ouvre sur {name} ; vous pouvez voyager dans le temps, suivre sa route et la comparer à celle des planètes.',
      es: 'Se muestra la posición real de {name}, según la trayectoria calculada por NASA JPL Horizons. La vista se abre sobre {name}; puede viajar en el tiempo, seguir su ruta y compararla con la de los planetas.',
      'pt-BR':
        'A posição real de {name} é mostrada, segundo a trajetória calculada pelo NASA JPL Horizons. A vista se abre sobre {name}; você pode viajar no tempo, acompanhar a sua rota e compará-la com a dos planetas.',
    },
    interstellar: {
      en: '{name} comes from outside the solar system: its orbit is open (eccentricity above 1), so it passes the Sun once and leaves. The view opens on {name} and its trajectory; you can travel in time along its passage.',
      fr: '{name} vient de l’extérieur du système solaire : son orbite est ouverte (excentricité supérieure à 1), il passe donc une seule fois près du Soleil et repart. La vue s’ouvre sur {name} et sa trajectoire ; vous pouvez voyager dans le temps le long de son passage.',
      es: '{name} viene de fuera del sistema solar: su órbita es abierta (excentricidad mayor que 1), así que pasa una sola vez cerca del Sol y se aleja. La vista se abre sobre {name} y su trayectoria; puede viajar en el tiempo a lo largo de su paso.',
      'pt-BR':
        '{name} vem de fora do Sistema Solar: a sua órbita é aberta (excentricidade maior que 1), por isso passa uma única vez perto do Sol e vai embora. A vista se abre sobre {name} e a sua trajetória; você pode viajar no tempo ao longo da sua passagem.',
    },
  },
  callToAction: {
    en: 'See {name} in 3D, at its real position right now.',
    fr: 'Voir {name} en 3D, à sa position réelle en ce moment.',
    es: 'Ver {name} en 3D, en su posición real en este momento.',
    'pt-BR': 'Veja {name} em 3D, na sua posição real neste momento.',
  },
  imageAlt: {
    en: '{name} shown as a point of light, the way Galaxy marks it',
    fr: '{name} représenté par un point lumineux, comme Galaxy le marque',
    es: '{name} representado por un punto de luz, como lo marca Galaxy',
    'pt-BR': '{name} representado por um ponto de luz, como a Galaxy o marca',
  },
  coverage: {
    en: 'Trajectory: JPL Horizons, precomputed from {from} to {to}.',
    fr: 'Trajectoire : JPL Horizons, précalculée du {from} au {to}.',
    es: 'Trayectoria: JPL Horizons, precalculada del {from} al {to}.',
    'pt-BR': 'Trajetória: JPL Horizons, pré-calculada de {from} a {to}.',
  },
  sources: { en: 'Sources', fr: 'Sources', es: 'Fuentes', 'pt-BR': 'Fontes' },
} as const;

const fill = (text: string, name: string): string =>
  text.replace(/\{name\}/g, name);

/** `AAAA-MM-JJ` en toutes lettres, dans la langue de la page. */
export function longDay(iso: string, locale: Locale): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** La valeur affichée d'un fait, avec la même précision que la fiche de l'application. */
function factValue(entry: FactEntry, locale: Locale): string | null {
  if (entry.status !== 'value') return null;
  const value = entry.value;
  if (value.kind === 'date') return longDay(value.iso, locale);
  if (value.kind === 'name') return value.text;
  const v = value.value;
  const au = messages[locale]['unit.au'];
  let text: string;
  switch (entry.field) {
    case 'massKg':
      // Comme la fiche : 721,9 kg pour Voyager 1, pas « 7,22 × 10² kg ».
      text =
        v < SCIENTIFIC_MASS_KG
          ? `${new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 }).format(v)} kg`
          : formatMass(v, locale);
      break;
    case 'eccentricity':
      text = formatNumber(v, 4, locale);
      break;
    case 'perihelionAU':
      text = `${formatNumber(v, 3, locale)} ${au}`;
      break;
    case 'absoluteMagnitude':
      text = formatNumber(v, 2, locale);
      break;
    default:
      return null;
  }
  const absolute = displayedAbsoluteUncertainty(entry);
  if (absolute !== null) {
    const decimals = entry.field === 'eccentricity' ? 5 : 2;
    text += ` (± ${formatNumber(absolute, decimals, locale)})`;
  }
  return text;
}

const STAT_KEY: Partial<Record<FactField, string>> = {
  massKg: 'stat.mass',
  launchDate: 'stat.launchDate',
  launchVehicle: 'stat.launchVehicle',
  launchSite: 'stat.launchSite',
  firstObservation: 'stat.firstObservation',
  eccentricity: 'stat.eccentricity',
  perihelionAU: 'stat.perihelion',
  absoluteMagnitude: 'stat.absoluteMagnitude',
};

function factsWithSources(
  cfg: CelestialBodyConfig,
  locale: Locale
): { facts: BodyFact[]; sources: BodySource[] } {
  const dict = messages[locale] as Record<string, string>;
  const entries = INSTRUMENT_FACT_ORDER.map((field) => bodyFact(cfg, field));
  const citations = citationOrder(entries);
  const facts: BodyFact[] = [];
  for (const entry of entries) {
    const value = factValue(entry, locale);
    if (value === null || entry.status !== 'value') continue;
    facts.push({
      label: dict[STAT_KEY[entry.field]!]!,
      value,
      source: citations.get(entry.provenance.source),
      method: entry.provenance.method,
    });
  }
  const sources: BodySource[] = [];
  for (const [id, index] of citations) {
    const source = factSource(id);
    if (!source) throw new Error(`source inconnue du registre : ${id}`);
    sources.push({
      index,
      text: [
        `${source.publisher}, ${source.title}`,
        source.kind === 'preprint'
          ? dict['fact.kind.preprint']
          : source.journal,
        source.published?.slice(0, 4),
        dict['fact.accessed']!.replace('{date}', source.accessed),
      ]
        .filter(Boolean)
        .join('. '),
      url: source.url,
    });
  }
  return { facts, sources };
}

/** Le bloc « Instruments » d'une sonde : les mêmes textes que la fiche, dans la langue de la page. */
function instrumentsBlock(
  input: ArchiveInput | undefined,
  retrieved: string,
  locale: Locale,
  missionPages: ReadonlyMap<string, string> = new Map()
): string {
  if (!input) return '';
  const dict = messages[locale] as Record<string, string>;
  const heading = `<h2>${escapeHtml(dict['bi.instruments.label']!)}</h2>`;
  if (input.status === 'absent')
    return (
      heading +
      `<p>${escapeHtml(dict['bi.instruments.absent']!)} ` +
      `${escapeHtml(dict['bi.instruments.absentNote']!.replace('{date}', longDay(retrieved, locale)))}</p>`
    );
  const { groups, orphans } = groupByHost(input.archive);
  // Le nom publié, et sous lui l'identifiant du PDS qui en est la citation : c'est ce que dit la
  // note de fin de bloc, reprise de la fiche (`bi.instruments.note`).
  const list = (names: readonly { name: string; lid: string }[]): string =>
    names.length
      ? `<ul>${names.map((i) => `<li>${escapeHtml(i.name)}<br><code>${escapeHtml(i.lid)}</code></li>`).join('')}</ul>`
      : `<p>${escapeHtml(dict['bi.instruments.hostEmpty']!)}</p>`;
  // Un seul porteur : sa liste directement. Plusieurs (BepiColombo) : chacun sous son nom publié.
  const hosts =
    groups.length === 1
      ? list(groups[0]!.instruments)
      : groups
          .map(
            (g) => `<h3>${escapeHtml(g.host.name)}</h3>${list(g.instruments)}`
          )
          .join('');
  const investigations = input.archive.investigations.length
    ? `<h3>${escapeHtml(dict['bi.instruments.investigations']!)}</h3><ul>${input.archive.investigations
        .map((i) => {
          const slug = missionPages.get(i.lid);
          if (!slug) return `<li>${escapeHtml(i.name)}</li>`;
          const segment = LOCALE_PATH[locale];
          const href = segment === '' ? `/${slug}/` : `/${segment}/${slug}/`;
          return `<li><a href="${escapeHtml(href)}">${escapeHtml(i.name)}</a></li>`;
        })
        .join('')}</ul>`
    : '';
  return (
    heading +
    hosts +
    (orphans.length ? list(orphans) : '') +
    investigations +
    `<p>${escapeHtml(dict['bi.instruments.note']!.replace('{date}', longDay(retrieved, locale)))}</p>`
  );
}

export function instrumentLandingPages(
  targets: ReadonlyMap<string, CelestialBodyConfig>,
  inputs: InstrumentPageInputs,
  origin: string,
  locale: Locale = 'en'
): InstrumentPage[] {
  const pages: InstrumentPage[] = [];
  for (const [name, cfg] of targets) {
    if (cfg.kind !== 'spacecraft' && cfg.kind !== 'interstellar')
      throw new Error(`objet d'instrument inattendu : ${name} (${cfg.kind})`);
    const kind = cfg.kind;
    const displayName =
      cfg.displayName?.[locale] ?? cfg.displayName?.en ?? name;
    const slug = bodyPagePath(name, locale);
    const { facts, sources } = factsWithSources(cfg, locale);
    const described =
      kind === 'spacecraft'
        ? (cfg.realData?.description?.[locale] ??
          cfg.realData?.description?.en ??
          '')
        : '';
    const intro = fill(TEXT.intro[kind][locale], displayName);
    const coverage = inputs.coverage.get(name);
    const extra =
      (coverage
        ? `<p>${escapeHtml(
            TEXT.coverage[locale]
              .replace('{from}', longDay(coverage.from, locale))
              .replace('{to}', longDay(coverage.to, locale))
          )}</p>`
        : '') +
      (kind === 'spacecraft'
        ? instrumentsBlock(
            inputs.archives.get(name),
            inputs.archiveRetrieved,
            locale,
            inputs.missionPages
          )
        : '');
    const metaBase = described || intro;
    // Le gabarit vient du DICTIONNAIRE, comme le titre de l'onglet (`ui/documentTitle`) : la
    // parité est tenue par `titleParity.test.ts`. « Trajectoire » et non « orbite » : Voyager
    // quitte le système solaire, et un interstellaire ne fait qu'y passer.
    const title = messages[locale]['title.instrument'].replace(
      '{name}',
      displayName
    );
    pages.push({
      slug,
      body: name,
      kind,
      locale,
      displayName,
      title,
      heading: title,
      description: `${trimForMeta(metaBase, 92)} ${fill(TEXT.callToAction[locale], displayName)}`,
      summary: described,
      facts,
      sources,
      extra,
      canonical: `${origin}/${slug}/`,
      image: `${origin}/social/${name.toLowerCase()}.jpg`,
      imageAlt: fill(TEXT.imageAlt[locale], displayName),
      color: `#${(cfg.orbitalColor ?? 0xffffff).toString(16).padStart(6, '0')}`,
    });
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

function contentBlock(page: InstrumentPage): string {
  const dict = messages[page.locale] as Record<string, string>;
  const facts = page.facts
    .map(
      (fact) =>
        `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}` +
        (fact.source === undefined
          ? ''
          : `<sup><a href="#source-${fact.source}">${fact.source}</a></sup>` +
            (fact.method === 'measured'
              ? ''
              : ` (${dict[`fact.method.${fact.method}`]})`)) +
        '</dd>'
    )
    .join('');
  const sources = page.sources.length
    ? `<h2>${escapeHtml(TEXT.sources[page.locale])}</h2><ol>${page.sources
        .map(
          (source) =>
            `<li id="source-${source.index}" value="${source.index}">${escapeHtml(source.text)}. ` +
            `<a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.url)}</a></li>`
        )
        .join('')}</ol>`
    : '';
  return (
    (page.summary ? `<p>${escapeHtml(page.summary)}</p>` : '') +
    `<p>${escapeHtml(fill(TEXT.intro[page.kind][page.locale], page.displayName))}</p>` +
    (facts ? `<dl>${facts}</dl>` : '') +
    page.extra +
    sources
  );
}

export function renderInstrumentPage(
  baseHtml: string,
  page: InstrumentPage,
  origin = new URL(page.canonical).origin
): string {
  const alternates = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      `${origin}/${bodyPagePath(page.body, locale)}/`,
    ])
  ) as Record<Locale, string>;
  return renderLandingPage(
    baseHtml,
    page,
    contentBlock(page),
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url: page.canonical,
      inLanguage: page.locale,
      isPartOf: {
        '@type': 'WebApplication',
        name: 'Galaxy',
        url: `${origin}/`,
        applicationCategory: 'EducationalApplication',
      },
      about: { '@type': 'Thing', name: page.displayName },
    },
    page.locale,
    alternates
  );
}
