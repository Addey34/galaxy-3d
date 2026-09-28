/**
 * LES QUATRE LANGUES, ET LEUR CHARGEMENT — anglais, français, espagnol, portugais du Brésil.
 *
 * Ce module ne porte AUCUNE chaîne traduite : un dictionnaire par langue vit dans son propre
 * fichier (`dict-en.ts`, `dict-fr.ts`, `dict-es.ts`, `dict-pt-BR.ts`). Il porte la liste des
 * langues, leurs conventions (chemin, `lang` HTML, locale `Intl`) et la façon de les charger.
 *
 * SEUL L'ANGLAIS EST CHARGÉ AU DÉMARRAGE, et c'est la décision de poids du lot 20. Les trois
 * autres arrivent par import DYNAMIQUE, donc un visiteur télécharge exactement un dictionnaire.
 * Avant ce lot, un francophone téléchargeait `en` + `fr` : le démarrage d'un visiteur non
 * anglophone est donc plus LÉGER qu'avant, et une cinquième langue coûtera zéro octet au
 * démarrage. L'anglais reste statique parce qu'il est le repli de `t()` : le charger à la demande
 * ferait apparaître des clés brutes le temps qu'un dictionnaire arrive.
 *
 * Les descriptions et noms des corps ne vivent PAS ici : ils restent dans le catalogue
 * (`config/bodies.ts`, champ `LocalizedText`) — le catalogue est la source unique du contenu.
 */

import { en, type MessageKey } from './dict-en';

export type Locale = 'en' | 'fr' | 'es' | 'pt-BR';

/**
 * Les langues livrées, dans l'ordre où le sélecteur les montre.
 *
 * Le portugais est déclaré BRÉSILIEN et non « portugais » : le lexique diffère de celui du
 * Portugal (« ônibus »/« autocarro », et plus près du sujet « Terra » contre « Terra » mais
 * « bilhão » contre « mil milhões »), donc annoncer `pt` serait une promesse plus large que ce
 * qui est livré.
 */
export const LOCALES: readonly Locale[] = ['en', 'fr', 'es', 'pt-BR'];

export type Dict = Record<MessageKey, string>;

export { en };
export type { MessageKey };

/**
 * Segment d'URL de chaque langue, pour les pages générées (`/methodology/`, `/fr/methodology/`).
 *
 * L'anglais est à la RACINE, et cela ne se discute pas : ses URL sont indexées depuis le
 * 2026-09-10 et une URL publiée ne se déplace pas. Le brésilien s'écrit en minuscules dans un
 * chemin, comme tout le reste du site.
 */
export const LOCALE_PATH: Record<Locale, string> = {
  en: '',
  fr: 'fr',
  es: 'es',
  'pt-BR': 'pt-br',
};

/**
 * `lang` HTML par langue.
 *
 * `en-GB` conserve l'horloge 24 h des `input type="time"` — c'est la raison historique, et elle
 * vaut toujours. `es` est SANS RÉGION délibérément : le séparateur décimal n'est pas le même en
 * Espagne (virgule) qu'au Mexique (point), donc annoncer `es-ES` ou `es-419` serait revendiquer
 * une région qu'on n'a pas choisie.
 */
export const HTML_LANG: Record<Locale, string> = {
  en: 'en-GB',
  fr: 'fr',
  es: 'es',
  'pt-BR': 'pt-BR',
};

/** Locale BCP 47 pour `Number.toLocaleString` / `Intl`. Même raison qu'au-dessus pour `es`. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es',
  'pt-BR': 'pt-BR',
};

/**
 * Le nom de chaque langue DANS SA PROPRE LANGUE, et le libellé court du sélecteur.
 *
 * Ces chaînes ne sont pas dans les dictionnaires, et c'est volontaire : le segment espagnol
 * s'appelle « Español » pour tout le monde. Traduire un endonyme (« Spanish » dans l'interface
 * anglaise) obligerait à écrire quatre fois quatre noms, dont douze seraient faux du point de vue
 * de quelqu'un qui cherche sa langue dans une liste.
 */
export const LOCALE_ENDONYM: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
};

/** Libellé court du sélecteur. Ce que l'œil lit ; l'endonyme est ce que le lecteur d'écran dit. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  fr: 'FR',
  es: 'ES',
  'pt-BR': 'PT',
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/**
 * La langue à servir pour une liste de préférences de navigateur — PURE, donc testable.
 *
 * `navigator.language.slice(0, 2)` ne suffit pas, et c'est un piège nommé d'avance : il rend
 * `pt` pour `pt-BR`, qui ne correspond à aucune de nos langues. Deux passes, dans cet ordre :
 *
 *   1. une correspondance EXACTE de l'étiquette complète (`pt-br` → `pt-BR`) ;
 *   2. à défaut, la sous-étiquette primaire (`pt-PT`, `pt-AO` → `pt-BR` ; `es-MX` → `es`).
 *
 * La deuxième passe est une DÉCISION, pas un repli technique : un navigateur en portugais du
 * Portugal reçoit du portugais du Brésil, parce que c'est la seule variante livrée et qu'elle
 * reste très largement compréhensible. L'anglais termine la liste, comme repli général.
 */
export function negotiateLocale(
  preferences: readonly string[] | string | undefined | null
): Locale {
  const list =
    typeof preferences === 'string'
      ? [preferences]
      : (preferences ?? []).filter((tag) => typeof tag === 'string');
  const byPrimary = new Map<string, Locale>();
  for (const locale of LOCALES) {
    const primary = locale.split('-')[0]!.toLowerCase();
    if (!byPrimary.has(primary)) byPrimary.set(primary, locale);
  }
  for (const tag of list) {
    const lower = tag.toLowerCase();
    const exact = LOCALES.find((locale) => locale.toLowerCase() === lower);
    if (exact) return exact;
    const primary = byPrimary.get(lower.split('-')[0]!);
    if (primary) return primary;
  }
  return 'en';
}

/**
 * Les chargeurs des langues NON anglaises. Un `import()` littéral par langue, jamais calculé :
 * Vite n'analyse pas `import(\`./dict-${locale}\`)` et embarquerait alors tout le dossier.
 */
const LOADERS: Record<Exclude<Locale, 'en'>, () => Promise<Dict>> = {
  fr: () => import('./dict-fr').then((m) => m.fr),
  es: () => import('./dict-es').then((m) => m.es),
  'pt-BR': () => import('./dict-pt-BR').then((m) => m.ptBR),
};

/** Le dictionnaire d'une langue. L'anglais est déjà là ; les autres arrivent par le réseau. */
export async function loadDictionary(locale: Locale): Promise<Dict> {
  if (locale === 'en') return en;
  return LOADERS[locale]();
}
