/**
 * PAGES D'ATTERRISSAGE PAR ÉCLIPSE — une page indexable par éclipse de 2024 à 2035.
 *
 * Même contrat que les pages de corps (`bodyLandingPage.ts`, lire son en-tête d'abord) : un
 * FICHIER statique `dist/eclipse/2026-08-12/index.html`, copie du `index.html` construit dont
 * seules les balises de tête et le contenu textuel changent. La page EST l'application : elle
 * relit son chemin (`core/eclipsePages.ts::eclipseFromPathname`), voyage jusqu'au pic et cadre
 * la Terre ou la Lune.
 *
 * Ce que ce module ajoute au contrat :
 *
 *   - **Aucune date n'est inventée ici.** Les éclipses viennent de
 *     `findUpcomingAstronomicalEvents`, via `eclipsesInPageWindow` — la même fonction que
 *     l'application appelle à l'arrivée. La page et le voyage qu'elle déclenche ne peuvent pas
 *     annoncer deux instants différents.
 *   - **Le titre vient du dictionnaire anglais de l'interface**, pas d'une chaîne écrite ici :
 *     l'onglet réécrit le titre pendant la navigation, et les deux doivent coïncider au
 *     caractère près (cf. `titleParity.test.ts`).
 *   - **La vignette est celle du corps cadré** (Terre ou Lune). Elle montre ce que la page
 *     ouvre ; un rendu d'éclipse dédié serait un autre chantier.
 *
 * Module PUR, comme son voisin : l'écriture des fichiers vit dans le plugin Vite.
 */
import {
  eclipseFocusBody,
  eclipsePathname,
  eclipseSlug,
  eclipseTitleKey,
  eclipsesInPageWindow,
  formatEclipseDate,
  type EclipseEvent,
} from '@/core/eclipsePages';
import { messages } from '@/i18n/allDictionaries';
import { LOCALES, LOCALE_PATH, type Locale } from '@/i18n/locales';
import {
  escapeHtml,
  renderLandingPage,
  type BodyFact,
  type LandingPage,
} from './bodyLandingPage';

export interface EclipsePage extends LandingPage {
  /** `2026-08-12` — le jour UTC, identique dans toutes les langues. */
  slug: string;
  locale: Locale;
  event: EclipseEvent;
  /** Corps sur lequel l'application s'ouvre — et dont la page réutilise la vignette. */
  focusBody: string;
  summary: string;
  facts: BodyFact[];
}

/** Nom affiché du corps cadré, pour le texte et le texte alternatif de la vignette. */
const FOCUS_NAME: Record<Locale, Record<string, string>> = {
  en: { earth: 'Earth', moon: 'Moon' },
  fr: { earth: 'Terre', moon: 'Lune' },
  es: { earth: 'Tierra', moon: 'Luna' },
  'pt-BR': { earth: 'Terra', moon: 'Lua' },
};

/**
 * Le texte propre aux pages d'éclipse, dans les quatre langues.
 *
 * Il était écrit en anglais dans le corps des fonctions. Une page espagnole d'éclipse aurait
 * alors porté un titre espagnol au-dessus d'un paragraphe anglais, ce qui est exactement ce que
 * le lot 20 corrige.
 */
const ECLIPSE_TEXT = {
  atPeak: {
    en: 'At its peak, at {time},',
    fr: 'À son maximum, à {time},',
    es: 'En su máximo, a las {time},',
    'pt-BR': 'No seu máximo, às {time},',
  },
  solarHides: {
    en: '{at} the Moon hides {percent} of the Sun{where}.',
    fr: '{at} la Lune cache {percent} du Soleil{where}.',
    es: '{at} la Luna oculta {percent} del Sol{where}.',
    'pt-BR': '{at} a Lua oculta {percent} do Sol{where}.',
  },
  solarWhere: {
    en: ' where its shadow falls, around {coords}',
    fr: ' là où son ombre tombe, autour de {coords}',
    es: ' allí donde cae su sombra, en torno a {coords}',
    'pt-BR': ' onde a sua sombra cai, em torno de {coords}',
  },
  solarPartialOnly: {
    en: '{at} the Moon covers only part of the Sun, and its central shadow misses the Earth.',
    fr: '{at} la Lune ne couvre qu’une partie du Soleil, et son ombre centrale manque la Terre.',
    es: '{at} la Luna solo cubre una parte del Sol, y su sombra central falla la Tierra.',
    'pt-BR':
      '{at} a Lua cobre apenas uma parte do Sol, e a sua sombra central passa longe da Terra.',
  },
  penumbral: {
    en: '{at} the Moon passes through the Earth’s penumbra only: a subtle dimming, no part of it enters the full shadow.',
    fr: '{at} la Lune ne traverse que la pénombre de la Terre : un assombrissement subtil, aucune partie n’entre dans l’ombre pleine.',
    es: '{at} la Luna solo atraviesa la penumbra de la Tierra: un oscurecimiento sutil, ninguna parte entra en la sombra plena.',
    'pt-BR':
      '{at} a Lua atravessa apenas a penumbra da Terra: um escurecimento subtil, nenhuma parte entra na sombra plena.',
  },
  lunarCovers: {
    en: '{at} the Earth’s shadow covers {percent} of the Moon.',
    fr: '{at} l’ombre de la Terre couvre {percent} de la Lune.',
    es: '{at} la sombra de la Tierra cubre {percent} de la Luna.',
    'pt-BR': '{at} a sombra da Terra cobre {percent} da Lua.',
  },
  lunarEnters: {
    en: '{at} the Moon enters the Earth’s shadow.',
    fr: '{at} la Lune entre dans l’ombre de la Terre.',
    es: '{at} la Luna entra en la sombra de la Tierra.',
    'pt-BR': '{at} a Lua entra na sombra da Terra.',
  },
  labelType: { en: 'Type', fr: 'Type', es: 'Tipo', 'pt-BR': 'Tipo' },
  labelPeak: { en: 'Peak', fr: 'Maximum', es: 'Máximo', 'pt-BR': 'Máximo' },
  labelSunHidden: {
    en: 'Sun hidden',
    fr: 'Soleil caché',
    es: 'Sol oculto',
    'pt-BR': 'Sol oculto',
  },
  labelMoonInShadow: {
    en: 'Moon in shadow',
    fr: 'Lune dans l’ombre',
    es: 'Luna en la sombra',
    'pt-BR': 'Lua na sombra',
  },
  labelGreatest: {
    en: 'Greatest eclipse',
    fr: 'Maximum de l’éclipse',
    es: 'Máximo del eclipse',
    'pt-BR': 'Máximo do eclipse',
  },
  labelOpensOn: {
    en: 'View opens on',
    fr: 'La vue s’ouvre sur',
    es: 'La vista se abre sobre',
    'pt-BR': 'A vista se abre sobre',
  },
  description: {
    en: '{name} on {date}, peak at {time}. See the Sun, the Earth and the Moon line up in 3D, at the real geometry of that instant.',
    fr: '{name} du {date}, maximum à {time}. Voir le Soleil, la Terre et la Lune s’aligner en 3D, à la géométrie réelle de cet instant.',
    es: '{name} del {date}, máximo a las {time}. Ver el Sol, la Tierra y la Luna alinearse en 3D, con la geometría real de ese instante.',
    'pt-BR':
      '{name} de {date}, máximo às {time}. Ver o Sol, a Terra e a Lua se alinharem em 3D, com a geometria real daquele instante.',
  },
  summary: {
    en: '{name} on {date}. {peak}',
    fr: '{name} du {date}. {peak}',
    es: '{name} del {date}. {peak}',
    'pt-BR': '{name} de {date}. {peak}',
  },
  intro: {
    en: 'The view opens at the peak of the eclipse, on the {focus}, with the Sun, the Earth and the Moon placed where they really are at that instant. You can move through time to watch the shadow come and go, or switch to the true-scale voyage.',
    fr: 'La vue s’ouvre au maximum de l’éclipse, sur la {focus}, avec le Soleil, la Terre et la Lune placés là où ils sont vraiment à cet instant. Vous pouvez parcourir le temps pour voir l’ombre venir et repartir, ou basculer sur le voyage à vraie échelle.',
    es: 'La vista se abre en el máximo del eclipse, sobre la {focus}, con el Sol, la Tierra y la Luna situados donde están realmente en ese instante. Puede recorrer el tiempo para ver la sombra llegar y marcharse, o pasar al viaje a escala real.',
    'pt-BR':
      'A vista se abre no máximo do eclipse, sobre a {focus}, com o Sol, a Terra e a Lua situados onde eles realmente estão naquele instante. Você pode percorrer o tempo para ver a sombra chegar e partir, ou passar para a viagem em escala real.',
  },
  imageAlt: {
    en: '{focus} rendered as a 3D sphere by Galaxy',
    fr: '{focus} rendue en sphère 3D par Galaxy',
    es: '{focus} representada como una esfera 3D por Galaxy',
    'pt-BR': '{focus} renderizada como uma esfera 3D pela Galaxy',
  },
} as const;

/** Une phrase de page d'éclipse, dans une langue, avec ses gabarits remplis. */
function text(
  key: keyof typeof ECLIPSE_TEXT,
  locale: Locale,
  vars: Readonly<Record<string, string>> = {}
): string {
  let out: string = ECLIPSE_TEXT[key][locale];
  for (const [name, value] of Object.entries(vars))
    out = out.replace(`{${name}}`, value);
  return out;
}

/** Titre — lu dans le dictionnaire de l'interface, jamais réécrit ici. */
export function eclipsePageTitle(
  event: EclipseEvent,
  locale: Locale = 'en'
): string {
  const pattern = messages[locale][eclipseTitleKey(event)];
  if (!pattern)
    throw new Error(`clé de titre absente : ${eclipseTitleKey(event)}`);
  return pattern.replace('{date}', formatEclipseDate(event.date, locale));
}

/**
 * « Total solar eclipse » — le nom sans sa date ni « in 3D ».
 *
 * LU dans le dictionnaire (`eclipse.name.*`) et non plus découpé du titre : la version
 * précédente coupait à « of », ce qui ne veut rien dire en espagnol (« del ») ni en portugais.
 */
function eclipseName(event: EclipseEvent, locale: Locale): string {
  // `title.eclipse.lunar.total` -> `eclipse.name.lunar.total`.
  const key = eclipseTitleKey(event).replace('title.eclipse.', 'eclipse.name.');
  const name = messages[locale][key as 'eclipse.name.solar.total'];
  if (!name) throw new Error(`clé de nom absente : ${key}`);
  return name;
}

const utcTime = (date: Date): string =>
  `${date.toISOString().slice(11, 16)} UTC`;

function formatLatLon(
  latitude: number,
  longitude: number,
  locale: Locale
): string {
  // Les points cardinaux changent de lettre : N/S/E/O en espagnol, N/S/L/O en portugais.
  const marks = CARDINALS[locale];
  const ns = latitude >= 0 ? marks.north : marks.south;
  const ew = longitude >= 0 ? marks.east : marks.west;
  const decimal = locale === 'en' ? '.' : ',';
  const one = (value: number): string =>
    Math.abs(value).toFixed(1).replace('.', decimal);
  return `${one(latitude)}°${ns}, ${one(longitude)}°${ew}`;
}

/** Les points cardinaux, par langue. */
const CARDINALS: Record<
  Locale,
  { north: string; south: string; east: string; west: string }
> = {
  en: { north: 'N', south: 'S', east: 'E', west: 'W' },
  fr: { north: 'N', south: 'S', east: 'E', west: 'O' },
  es: { north: 'N', south: 'S', east: 'E', west: 'O' },
  'pt-BR': { north: 'N', south: 'S', east: 'L', west: 'O' },
};

/** Ce qu'il se passe au pic, en une phrase — seulement ce que le calcul donne. */
function peakSentence(event: EclipseEvent, locale: Locale): string {
  const at = text('atPeak', locale, { time: utcTime(event.date) });
  const percent =
    event.obscuration !== undefined && event.obscuration > 0
      ? `${Math.round(event.obscuration * 100)}%`
      : null;
  if (event.kind === 'solar-eclipse') {
    const where =
      event.peakLatitude !== undefined && event.peakLongitude !== undefined
        ? text('solarWhere', locale, {
            coords: formatLatLon(
              event.peakLatitude,
              event.peakLongitude,
              locale
            ),
          })
        : '';
    return percent
      ? text('solarHides', locale, { at, percent, where })
      : text('solarPartialOnly', locale, { at });
  }
  if (event.eclipseKind === 'penumbral')
    return text('penumbral', locale, { at });
  return percent
    ? text('lunarCovers', locale, { at, percent })
    : text('lunarEnters', locale, { at });
}

function eclipseFacts(event: EclipseEvent, locale: Locale): BodyFact[] {
  const facts: BodyFact[] = [
    { label: text('labelType', locale), value: eclipseName(event, locale) },
    {
      label: text('labelPeak', locale),
      value: `${formatEclipseDate(event.date, locale)}, ${utcTime(event.date)}`,
    },
  ];
  if (event.obscuration !== undefined && event.obscuration > 0)
    facts.push({
      label: text(
        event.kind === 'solar-eclipse' ? 'labelSunHidden' : 'labelMoonInShadow',
        locale
      ),
      value: `${Math.round(event.obscuration * 100)}%`,
    });
  if (event.peakLatitude !== undefined && event.peakLongitude !== undefined)
    facts.push({
      label: text('labelGreatest', locale),
      value: formatLatLon(event.peakLatitude, event.peakLongitude, locale),
    });
  const focus = eclipseFocusBody(event);
  facts.push({
    label: text('labelOpensOn', locale),
    value: FOCUS_NAME[locale][focus] ?? focus,
  });
  return facts;
}

/**
 * Le chemin d'une page d'éclipse dans une langue : `/eclipse/2026-08-12/`, `/es/eclipse/…`.
 * Même règle que les corps et les pages documentaires — l'anglais à la racine.
 */
export function eclipsePagePath(event: EclipseEvent, locale: Locale): string {
  const segment = LOCALE_PATH[locale];
  const path = eclipsePathname(event);
  return segment === '' ? path : `/${segment}${path}`;
}

/** Une page par éclipse de la fenêtre, dans l'ordre chronologique. */
export function eclipseLandingPages(
  origin: string,
  locale: Locale = 'en'
): EclipsePage[] {
  return eclipsesInPageWindow().map((event) => {
    const title = eclipsePageTitle(event, locale);
    const name = eclipseName(event, locale);
    const focusBody = eclipseFocusBody(event);
    const focusName = FOCUS_NAME[locale][focusBody] ?? focusBody;
    const date = formatEclipseDate(event.date, locale);
    return {
      slug: eclipseSlug(event),
      locale,
      event,
      focusBody,
      title,
      heading: title,
      description: text('description', locale, {
        name,
        date,
        time: utcTime(event.date),
      }),
      summary: text('summary', locale, {
        name,
        date,
        peak: peakSentence(event, locale),
      }),
      facts: eclipseFacts(event, locale),
      canonical: `${origin}${eclipsePagePath(event, locale)}`,
      // La vignette du corps cadré : elle montre ce que la page ouvre (cf. en-tête). Partagée
      // par les quatre langues, comme celle d'un corps.
      image: `${origin}/social/${focusBody}.jpg`,
      imageAlt: text('imageAlt', locale, { focus: focusName }),
    };
  });
}

/** Le contenu textuel indexable, réutilisé par `<noscript>` et le bloc lecteur. */
function eclipseContentBlock(page: EclipsePage): string {
  const facts = page.facts
    .map(
      (fact) =>
        `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`
    )
    .join('');
  const focusName = FOCUS_NAME[page.locale][page.focusBody] ?? page.focusBody;
  return (
    `<p>${escapeHtml(page.summary)}</p>` +
    `<p>${escapeHtml(text('intro', page.locale, { focus: focusName }))}</p>` +
    `<dl>${facts}</dl>`
  );
}

/** Une page d'éclipse à partir du `index.html` CONSTRUIT (cf. `renderLandingPage`). */
export function renderEclipsePage(
  baseHtml: string,
  page: EclipsePage,
  origin = new URL(page.canonical).origin
): string {
  const alternates = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      `${origin}${eclipsePagePath(page.event, locale)}`,
    ])
  ) as Record<Locale, string>;
  return renderLandingPage(
    baseHtml,
    page,
    eclipseContentBlock(page),
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
      about: {
        '@type': 'Thing',
        // Le titre de l'entité, sans « en 3D » : le nom de l'éclipse et sa date, dans la langue
        // de la page.
        name: `${eclipseName(page.event, page.locale)} ${formatEclipseDate(page.event.date, page.locale)}`,
      },
    },
    page.locale,
    alternates
  );
}
