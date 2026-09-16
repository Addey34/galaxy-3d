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
import { messages } from '@/i18n/locales';
import {
  escapeHtml,
  renderLandingPage,
  type BodyFact,
  type LandingPage,
} from './bodyLandingPage';

export interface EclipsePage extends LandingPage {
  slug: string;
  event: EclipseEvent;
  /** Corps sur lequel l'application s'ouvre — et dont la page réutilise la vignette. */
  focusBody: string;
  summary: string;
  facts: BodyFact[];
}

/** Nom affiché du corps cadré, pour le texte et le texte alternatif de la vignette. */
const FOCUS_NAME: Record<string, string> = { earth: 'Earth', moon: 'Moon' };

/** Titre anglais — lu dans le dictionnaire de l'interface, jamais réécrit ici. */
export function eclipsePageTitle(event: EclipseEvent): string {
  const pattern = messages.en[eclipseTitleKey(event)];
  if (!pattern)
    throw new Error(`clé de titre absente : ${eclipseTitleKey(event)}`);
  return pattern.replace('{date}', formatEclipseDate(event.date, 'en'));
}

/** « Total solar eclipse » — le titre sans sa date ni « in 3D ». */
function eclipseName(event: EclipseEvent): string {
  return eclipsePageTitle(event).replace(/ of .*$/, '');
}

const utcTime = (date: Date): string =>
  `${date.toISOString().slice(11, 16)} UTC`;

function formatLatLon(latitude: number, longitude: number): string {
  const ns = latitude >= 0 ? 'N' : 'S';
  const ew = longitude >= 0 ? 'E' : 'W';
  return `${Math.abs(latitude).toFixed(1)}°${ns}, ${Math.abs(longitude).toFixed(1)}°${ew}`;
}

/** Ce qu'il se passe au pic, en une phrase — seulement ce que le calcul donne. */
function peakSentence(event: EclipseEvent): string {
  const at = `At its peak, at ${utcTime(event.date)},`;
  const percent =
    event.obscuration !== undefined && event.obscuration > 0
      ? `${Math.round(event.obscuration * 100)}%`
      : null;
  if (event.kind === 'solar-eclipse') {
    const where =
      event.peakLatitude !== undefined && event.peakLongitude !== undefined
        ? ` where its shadow falls, around ${formatLatLon(event.peakLatitude, event.peakLongitude)}`
        : '';
    return percent
      ? `${at} the Moon hides ${percent} of the Sun${where}.`
      : `${at} the Moon covers only part of the Sun, and its central shadow misses the Earth.`;
  }
  if (event.eclipseKind === 'penumbral')
    return `${at} the Moon passes through the Earth’s penumbra only: a subtle dimming, no part of it enters the full shadow.`;
  return percent
    ? `${at} the Earth’s shadow covers ${percent} of the Moon.`
    : `${at} the Moon enters the Earth’s shadow.`;
}

function eclipseFacts(event: EclipseEvent): BodyFact[] {
  const facts: BodyFact[] = [
    { label: 'Type', value: eclipseName(event) },
    {
      label: 'Peak',
      value: `${formatEclipseDate(event.date, 'en')}, ${utcTime(event.date)}`,
    },
  ];
  if (event.obscuration !== undefined && event.obscuration > 0)
    facts.push({
      label: event.kind === 'solar-eclipse' ? 'Sun hidden' : 'Moon in shadow',
      value: `${Math.round(event.obscuration * 100)}%`,
    });
  if (event.peakLatitude !== undefined && event.peakLongitude !== undefined)
    facts.push({
      label: 'Greatest eclipse',
      value: formatLatLon(event.peakLatitude, event.peakLongitude),
    });
  facts.push({
    label: 'View opens on',
    value: FOCUS_NAME[eclipseFocusBody(event)] ?? eclipseFocusBody(event),
  });
  return facts;
}

/** Une page par éclipse de la fenêtre, dans l'ordre chronologique. */
export function eclipseLandingPages(origin: string): EclipsePage[] {
  return eclipsesInPageWindow().map((event) => {
    const title = eclipsePageTitle(event);
    const name = eclipseName(event);
    const focusBody = eclipseFocusBody(event);
    const focusName = FOCUS_NAME[focusBody] ?? focusBody;
    const date = formatEclipseDate(event.date, 'en');
    return {
      slug: eclipseSlug(event),
      event,
      focusBody,
      title,
      heading: title,
      description:
        `${name} on ${date}, peak at ${utcTime(event.date)}. ` +
        'See the Sun, the Earth and the Moon line up in 3D, at the real geometry of that instant.',
      summary: `${name} on ${date}. ${peakSentence(event)}`,
      facts: eclipseFacts(event),
      canonical: `${origin}${eclipsePathname(event)}`,
      // La vignette du corps cadré : elle montre ce que la page ouvre (cf. en-tête).
      image: `${origin}/social/${focusBody}.jpg`,
      imageAlt: `${focusName} rendered as a 3D sphere — Galaxy`,
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
  const focusName = FOCUS_NAME[page.focusBody] ?? page.focusBody;
  return (
    `<p>${escapeHtml(page.summary)}</p>` +
    `<p>The view opens at the peak of the eclipse, on the ${escapeHtml(focusName)}, with the Sun, ` +
    'the Earth and the Moon placed where they really are at that instant. You can move through ' +
    'time to watch the shadow come and go, or switch to the true-scale voyage.</p>' +
    `<dl>${facts}</dl>`
  );
}

/** Une page d'éclipse à partir du `index.html` CONSTRUIT (cf. `renderLandingPage`). */
export function renderEclipsePage(
  baseHtml: string,
  page: EclipsePage,
  origin = new URL(page.canonical).origin
): string {
  return renderLandingPage(baseHtml, page, eclipseContentBlock(page), {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url: page.canonical,
    inLanguage: 'en',
    isPartOf: {
      '@type': 'WebApplication',
      name: 'Galaxy',
      url: `${origin}/`,
      applicationCategory: 'EducationalApplication',
    },
    about: {
      '@type': 'Thing',
      name: `${eclipseName(page.event)} of ${formatEclipseDate(page.event.date, 'en')}`,
    },
  });
}
