/**
 * PAGES D'ÉCLIPSE — la règle partagée entre le build et l'application.
 *
 * Une éclipse a une adresse indexable, `/eclipse/2026-08-12/`, et cette adresse EST
 * l'application ouverte au pic de l'éclipse (comme `/jupiter/` est l'application ouverte sur
 * Jupiter). La CSP interdisant tout script en ligne, la page ne peut pas transmettre la date
 * par un `<script>` généré : c'est le CHEMIN qui la porte, et l'application le relit ici.
 *
 * La date exacte du pic n'est écrite nulle part. Le build (`src/seo/eclipseLandingPage.ts`)
 * et l'application la RECALCULENT par la même fonction, `findUpcomingAstronomicalEvents` : une
 * page et le permalien qu'elle ouvre ne peuvent donc pas diverger. Le chemin ne porte que le
 * JOUR UTC — deux éclipses ne tombent jamais le même jour (au plus près, une quinzaine de jours
 * les sépare, la moitié d'une lunaison) — et pas le type : astronomy-engine pourrait un jour
 * reclasser une éclipse limite (annulaire ↔ totale), et une URL déjà indexée ne doit pas en
 * dépendre.
 *
 * Fenêtre FIXE, décidée le 2026-09-15 : 2024-2035. Une fenêtre glissante sortirait chaque
 * éclipse passée du sitemap et laisserait son URL indexée finir en 404.
 */
import {
  eventFocusBody,
  findUpcomingAstronomicalEvents,
  type AstronomicalEvent,
} from './astronomicalEvents';

export type EclipseEvent = AstronomicalEvent & {
  kind: 'solar-eclipse' | 'lunar-eclipse';
};

/** Fenêtre couverte par les pages : `from` inclus, `to` exclu. */
export const ECLIPSE_PAGE_WINDOW = {
  from: new Date('2024-01-01T00:00:00.000Z'),
  to: new Date('2036-01-01T00:00:00.000Z'),
} as const;

/** Préfixe du chemin — deux segments, donc jamais confondu avec une page de corps. */
export const ECLIPSE_PATH_SEGMENT = 'eclipse';

/**
 * Écart toléré entre la date simulée et le pic pour considérer qu'on regarde encore CETTE
 * éclipse. La lecture est mise en pause à l'arrivée, donc la date ne dérive pas d'elle-même ;
 * la minute absorbe l'arrondi à la seconde du permalien.
 */
export const ECLIPSE_PEAK_TOLERANCE_MS = 60_000;

const DAY_MS = 86_400_000;
const SLUG_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isEclipseEvent(
  event: AstronomicalEvent
): event is EclipseEvent {
  return event.kind === 'solar-eclipse' || event.kind === 'lunar-eclipse';
}

/** Toutes les éclipses de la fenêtre, dans l'ordre chronologique. */
export function eclipsesInPageWindow(): EclipseEvent[] {
  const { from, to } = ECLIPSE_PAGE_WINDOW;
  // `findUpcomingAstronomicalEvents` exclut sa date de départ : on part une milliseconde avant.
  return findUpcomingAstronomicalEvents(new Date(from.getTime() - 1), {
    count: Number.MAX_SAFE_INTEGER,
    horizonDays: (to.getTime() - from.getTime()) / DAY_MS,
  })
    .filter(isEclipseEvent)
    .filter((event) => event.date < to);
}

/** Jour UTC du pic, `AAAA-MM-JJ` — le segment d'URL. */
export function eclipseSlug(event: AstronomicalEvent): string {
  return event.date.toISOString().slice(0, 10);
}

/** Chemin de la page d'une éclipse, slash final compris (forme servie, cf. `pathnameForBody`). */
export function eclipsePathname(event: AstronomicalEvent): string {
  return `/${ECLIPSE_PATH_SEGMENT}/${eclipseSlug(event)}/`;
}

/**
 * L'éclipse dont le pic tombe le jour UTC `slug`, recalculée — ou `undefined` si ce jour n'en
 * porte aucune, sort de la fenêtre, ou n'est pas une date réelle (`2026-02-30`).
 */
export function eclipseForSlug(slug: string): EclipseEvent | undefined {
  if (!SLUG_PATTERN.test(slug)) return undefined;
  const dayStart = Date.parse(`${slug}T00:00:00.000Z`);
  if (!Number.isFinite(dayStart)) return undefined;
  const { from, to } = ECLIPSE_PAGE_WINDOW;
  if (dayStart < from.getTime() || dayStart >= to.getTime()) return undefined;
  return (
    findUpcomingAstronomicalEvents(new Date(dayStart - 1), {
      count: 64,
      horizonDays: 1,
    })
      .filter(isEclipseEvent)
      // Cette égalité est le vrai garde-fou des dates impossibles : `Date.parse` accepte le
      // 31 février et le reporte au 3 mars — jour, justement, d'une éclipse totale de Lune en
      // 2026. Seule une éclipse dont le jour RÉÉCRIT est exactement le segment lu est acceptée.
      .find((event) => eclipseSlug(event) === slug)
  );
}

/** Éclipse nommée par le chemin (`/eclipse/2026-08-12/`), s'il en nomme une. */
export function eclipseFromPathname(
  pathname: string
): EclipseEvent | undefined {
  const segments = pathname.split('/').filter((part) => part.length > 0);
  if (segments.length !== 2) return undefined;
  if (segments[0]?.toLowerCase() !== ECLIPSE_PATH_SEGMENT) return undefined;
  return eclipseForSlug(segments[1] ?? '');
}

/** Corps cadré à l'arrivée : la Terre (l'ombre au sol) ou la Lune (l'astre dans l'ombre). */
export function eclipseFocusBody(event: EclipseEvent): string {
  return eventFocusBody(event);
}

/**
 * L'état affiché décrit-il encore cette éclipse ? Tant que oui, l'adresse reste celle de la
 * page d'éclipse ; au premier changement de corps ou de date, elle bascule sur le permalien
 * ordinaire (`/earth/?date=…`), qui, lui, dit la vérité sur ce qu'on regarde.
 */
export function eclipseStillDescribed(
  event: EclipseEvent,
  selectedBody: string | null | undefined,
  date: Date
): boolean {
  return (
    selectedBody === eclipseFocusBody(event) &&
    Math.abs(date.getTime() - event.date.getTime()) <= ECLIPSE_PEAK_TOLERANCE_MS
  );
}

/** Clé i18n du titre : type × astre. Le tableau des combinaisons réelles est tenu par un test. */
export function eclipseTitleKey(event: EclipseEvent): string {
  const body = event.kind === 'solar-eclipse' ? 'solar' : 'lunar';
  return `title.eclipse.${body}.${event.eclipseKind ?? 'partial'}`;
}

const DATE_LOCALE: Record<'en' | 'fr', string> = {
  en: 'en-US',
  fr: 'fr-FR',
};

/**
 * Date du pic en toutes lettres, en UTC — « August 12, 2026 », « 12 août 2026 ».
 *
 * Locale FIXÉE par langue, pas celle du navigateur : la page statique et l'onglet doivent
 * écrire le même titre anglais au caractère près (sinon le titre clignote au rechargement), et
 * un visiteur `en-GB` écrirait « 12 August 2026 ». Le « 1er » français est ajouté à la main,
 * `Intl` écrivant « 1 mars ».
 */
export function formatEclipseDate(date: Date, locale: 'en' | 'fr'): string {
  const text = new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return locale === 'fr' && date.getUTCDate() === 1
    ? text.replace(/^1 /, '1er ')
    : text;
}
