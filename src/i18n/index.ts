/**
 * Cœur de l'internationalisation — état de langue + traduction.
 *
 * Détection au démarrage : préférence persistée (`localStorage`) sinon langue du navigateur,
 * repli anglais. `setLocale` persiste le choix, met à jour `<html lang>` et notifie les
 * observateurs (chaque module UI se réabonne pour se retraduire à chaud). Aucune dépendance
 * externe : dictionnaires plats dans `./locales`.
 */
import { messages, LOCALES, type Locale } from './locales';

export type { Locale } from './locales';
export { LOCALES } from './locales';

const STORAGE_KEY = 'ssv-locale';

/** `lang` HTML par langue (en-GB conserve l'horloge 24 h des inputs date/heure). */
const HTML_LANG: Record<Locale, string> = { en: 'en-GB', fr: 'fr' };

function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage indisponible (mode privé strict) — on retombe sur le navigateur.
  }
  const nav = navigator.language?.slice(0, 2).toLowerCase();
  return nav === 'fr' ? 'fr' : 'en';
}

let current: Locale = detect();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Change la langue : persiste, met à jour `<html lang>` et notifie les observateurs. */
export function setLocale(locale: Locale): void {
  if (locale === current || !isLocale(locale)) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Persistance best-effort : la session reste correcte même sans stockage.
  }
  document.documentElement.lang = HTML_LANG[locale];
  listeners.forEach((cb) => cb());
}

/** S'abonne aux changements de langue. Renvoie une fonction de désabonnement. */
export function onLocaleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Traduit une clé dans la langue courante. Repli : anglais, puis la clé brute.
 * `vars` interpole les gabarits `{nom}` (ex. `t('subtitle.planetOrdinal', { ordinal: '3ᵉ' })`).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = messages[current][key] ?? messages.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Locale BCP 47 pour `Number.toLocaleString` / `Intl` (fr-FR, en-US). */
export function intlLocale(): string {
  return current === 'fr' ? 'fr-FR' : 'en-US';
}
