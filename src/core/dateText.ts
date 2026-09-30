/**
 * UNE DATE EN TOUTES LETTRES, ET LE PREMIER DU MOIS ÉCRIT COMME IL SE DIT. Module PUR, testé.
 *
 * `Intl` ne connaît pas l'ordinal : il écrit « 1 mars » là où le français écrit « 1er mars », et
 * « 1 de março » là où le portugais du Brésil écrit « 1º de março ». L'espagnol écrit bien
 * « 1 de agosto », et l'anglais place le jour après le mois, où la question ne se pose pas.
 *
 * LA RÈGLE EXISTAIT DÉJÀ, dans `core/eclipsePages.ts`, et QUATRE autres endroits l'ignoraient :
 * la fiche d'un corps, le bloc des missions, la note des petits corps et le panneau des
 * événements astronomiques. Ce n'était pas théorique — 66 des 337 bornes de missions livrées
 * tombent le 1er du mois, soit une sur cinq. Elle a donc UN seul propriétaire, ici, et c'est la
 * règle de l'utilisateur : une correction mise en place s'applique à TOUT, pas au seul dernier
 * ajout.
 *
 * LE REMPLACEMENT PASSE PAR `formatToParts` et non par une expression régulière ancrée. Une
 * ancre `/^1 /` marche pour « 1 mars » et manque « lun. 1 déc. », où le jour de la semaine
 * précède : le panneau des événements astronomiques est exactement ce cas. En retouchant la
 * PARTIE `day`, l'ordre des éléments n'a plus d'importance, quelles que soient les options.
 */
import type { Locale } from '@/i18n/locales';

/**
 * Le suffixe ordinal du premier du mois, par langue. Une table plutôt qu'un `if (fr)` : la
 * première version de cette règle ne connaissait que le français, et le portugais serait passé
 * inaperçu.
 */
const FIRST_DAY_ORDINAL: Partial<Record<Locale, string>> = {
  fr: '1er',
  'pt-BR': '1º',
};

/** Les langues dont le premier du mois s'écrit en ordinal, pour les tests et la documentation. */
export const ORDINAL_FIRST_DAY_LOCALES = Object.freeze(
  Object.keys(FIRST_DAY_ORDINAL) as Locale[]
);

/**
 * Met une date en forme avec `options`, puis écrit le premier du mois en ordinal si la langue le
 * demande. `locale` est la langue de l'application ; `intlLocale` est l'étiquette BCP 47 passée à
 * `Intl`, que l'appelant choisit (la page d'éclipse la FIXE par langue, l'interface prend celle
 * du navigateur).
 */
export function formatDateText(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  locale: Locale,
  intlLocale: string
): string {
  const parts = new Intl.DateTimeFormat(intlLocale, options).formatToParts(
    date
  );
  const ordinal = FIRST_DAY_ORDINAL[locale];
  return parts
    .map((part) =>
      ordinal && part.type === 'day' && part.value === '1'
        ? ordinal
        : part.value
    )
    .join('');
}

/** Options d'un jour en toutes lettres : « 15 octobre 1997 », « October 15, 1997 ». */
export const LONG_DAY: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
};

/**
 * Un jour ISO (`1997-10-15`) en toutes lettres, en UTC.
 *
 * Le découpage de la chaîne plutôt que `new Date(iso)` : ce dernier interprète une date seule
 * comme UTC mais une date-heure sans fuseau comme locale, et mélanger les deux donnerait des
 * décalages d'un jour selon l'appelant. Ici l'entrée est toujours un jour.
 */
export function formatIsoDay(
  iso: string,
  locale: Locale,
  intlLocale: string
): string {
  const [year, month, day] = iso.split('-').map(Number);
  return formatDateText(
    new Date(Date.UTC(year!, month! - 1, day!)),
    LONG_DAY,
    locale,
    intlLocale
  );
}
