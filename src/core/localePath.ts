import { LOCALE_PATH } from '@/i18n/locales';

/**
 * LE SEGMENT DE LANGUE D'UN CHEMIN : `/fr/moon/` est la page de la Lune EN FRANÇAIS, pas un
 * chemin à deux segments qui ne nommerait rien.
 *
 * Les pages de corps et d'éclipse existent dans les quatre langues depuis le lot 20
 * (`seo/bodyLandingPage.ts::bodyPagePath`), mais l'application ne lisait le chemin qu'en anglais :
 * `/fr/moon/` démarrait sur la vue d'ensemble et `/fr/eclipse/2026-08-12/` à la date du jour,
 * sans rien d'anormal à l'écran (mesuré en production le 2026-10-17, trouvé par le lien
 * « Le voir dans Galaxy » des pages des grands lieux, lot 55). Lecture et écriture passent donc
 * par ici, et une langue ajoutée à `LOCALE_PATH` est couverte sans que personne y pense.
 */
const LOCALE_SEGMENTS: ReadonlySet<string> = new Set(
  Object.values(LOCALE_PATH).filter((segment) => segment !== '')
);

export interface LocalePath {
  /** Segment de langue (`fr`, `pt-br`), `''` pour l'anglais servi à la racine. */
  readonly prefix: string;
  /** Les segments qui suivent, sans le préfixe. */
  readonly segments: readonly string[];
}

export function splitLocalePath(pathname: string): LocalePath {
  const segments = pathname.split('/').filter((part) => part.length > 0);
  const first = segments[0]?.trim().toLowerCase();
  return first !== undefined && LOCALE_SEGMENTS.has(first)
    ? { prefix: first, segments: segments.slice(1) }
    : { prefix: '', segments };
}

/** `/moon/` sous le préfixe `fr` donne `/fr/moon/` ; sans préfixe, le chemin tel quel. */
export function withLocalePrefix(prefix: string, path: string): string {
  return prefix === '' ? path : `/${prefix}${path}`;
}
