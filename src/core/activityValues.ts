/**
 * LES VALEURS D'UN CORRIGÉ, ÉVALUÉES PUIS ÉCRITES (lot 58). Module PUR.
 *
 * Une fiche d'activité déclare ses valeurs (`src/registry/schema/activity.ts`) ; ce module les
 * calcule sur le domaine d'années de la fiche, vérifie ce qu'elles revendiquent, et les écrit dans
 * une langue. Deux refus, et ce sont eux qui empêchent un corrigé faux d'être publié :
 *
 *   - **une précision qui n'est pas tenue** : une mesure de la scène dont l'arrondi déclaré change
 *     d'une année à l'autre du domaine lève, au lieu d'écrire une valeur qui ne vaut que pour une
 *     année. La phrase imprimée vaut donc pour TOUT le domaine qu'elle annonce ;
 *   - **un désaccord** : une mesure qui déclare `agrees` doit tomber, chaque année, à la tolérance
 *     déclarée de la valeur qu'elle illustre (le plus souvent un fait sourcé).
 *
 * Les faits arrivent par un lecteur passé en argument, en degrés : ce module ne connaît pas le
 * catalogue, et un test peut lui en donner un faux pour le falsifier.
 */
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import type { ActivityRecord, ActivityValue } from '@/registry/schema/activity';
import {
  apsisFluxGainPercent,
  apsisGapPercent,
  dayLengthHours,
  eventInYear,
  polarDayLatitudeDeg,
  subsolarLatitudeDeg,
} from './activityMeasures';
import { formatDateText } from './dateText';

/** Lit un fait de la fiche d'un corps, en degrés ; `undefined` s'il n'est pas publié. */
export type FactReader = (
  body: string,
  fact: 'axialTilt'
) => number | undefined;

export type EvaluatedValue =
  | { kind: 'degrees'; value: number; decimals: number }
  | { kind: 'percent'; value: number; decimals: number }
  | { kind: 'hours'; value: number }
  | { kind: 'date'; date: Date };

const years = (record: ActivityRecord): number[] =>
  Array.from(
    { length: record.years.to - record.years.from + 1 },
    (_, i) => record.years.from + i
  );

/** Une seule valeur à la précision déclarée, ou une erreur qui nomme les années en désaccord. */
function constant(
  name: string,
  perYear: readonly { year: number; value: number }[],
  round: (value: number) => string
): number {
  const rounded = new Set(perYear.map(({ value }) => round(value)));
  if (rounded.size !== 1)
    throw new Error(
      `valeur « ${name} » : la précision déclarée n'est pas tenue sur le domaine (${[...rounded].join(', ')})`
    );
  const sum = perYear.reduce((total, { value }) => total + value, 0);
  return sum / perYear.length;
}

const fixed = (decimals: number) => (value: number) =>
  // `+ 0` efface le zéro négatif : un équinoxe à −0,00004° s'écrit 0,0 et non −0,0.
  (Math.round(value * 10 ** decimals) / 10 ** decimals + 0).toFixed(decimals);
const minutes = (hours: number): string => String(Math.round(hours * 60));

function perYearMeasure(value: ActivityValue, year: number): number {
  switch (value.kind) {
    case 'subsolarLatitude': {
      const latitude = subsolarLatitudeDeg(eventInYear(value.event, year));
      return value.absolute ? Math.abs(latitude) : latitude;
    }
    case 'polarDayLatitude':
      return polarDayLatitudeDeg(eventInYear(value.event, year));
    case 'dayLength':
      return dayLengthHours(
        eventInYear(value.event, year),
        value.latitude,
        value.longitude
      );
    case 'apsisGapPercent':
      return apsisGapPercent(year);
    case 'apsisFluxGainPercent':
      return apsisFluxGainPercent(year);
    default:
      throw new Error(`mesure annuelle inattendue : ${value.kind}`);
  }
}

/**
 * Toutes les valeurs d'une fiche, évaluées et vérifiées. Lève sur un fait absent, une précision
 * non tenue ou un désaccord.
 */
export function evaluateActivityValues(
  record: ActivityRecord,
  readFact: FactReader
): Record<string, EvaluatedValue> {
  const out: Record<string, EvaluatedValue> = {};
  const span = years(record);
  const perYear: Record<string, { year: number; value: number }[]> = {};

  for (const [name, value] of Object.entries(record.values)) {
    switch (value.kind) {
      case 'fact': {
        const fact = readFact(value.body, value.fact);
        if (fact === undefined)
          throw new Error(
            `valeur « ${name} » : ${value.body}.${value.fact} n'est pas publié`
          );
        out[name] = {
          kind: 'degrees',
          value: value.form === 'complement90' ? 90 - fact : fact,
          decimals: value.decimals,
        };
        break;
      }
      case 'apsisDate': {
        const dates = span.map((year) => eventInYear(value.event, year));
        // Comparées au JOUR DE L'ANNÉE, pas à l'instant : « le plus précoce » est une date de
        // calendrier, celle qu'une fiche imprimée peut annoncer pour toutes les années.
        const dayOfYear = (d: Date): number =>
          d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1);
        const sorted = [...dates].sort((a, b) => dayOfYear(a) - dayOfYear(b));
        out[name] = {
          kind: 'date',
          date: value.bound === 'earliest' ? sorted[0]! : sorted.at(-1)!,
        };
        break;
      }
      default: {
        const measured = span.map((year) => ({
          year,
          value: perYearMeasure(value, year),
        }));
        perYear[name] = measured;
        if (value.kind === 'dayLength')
          out[name] = {
            kind: 'hours',
            value: constant(name, measured, minutes),
          };
        else
          out[name] = {
            kind:
              value.kind === 'apsisGapPercent' ||
              value.kind === 'apsisFluxGainPercent'
                ? 'percent'
                : 'degrees',
            value: constant(name, measured, fixed(value.decimals)),
            decimals: value.decimals,
          };
      }
    }
  }

  for (const [name, value] of Object.entries(record.values)) {
    if (!('agrees' in value) || value.agrees === undefined) continue;
    const reference = out[value.agrees.value];
    if (!reference || !('value' in reference))
      throw new Error(`valeur « ${name} » : référence d'accord non numérique`);
    for (const { year, value: measured } of perYear[name] ?? []) {
      const gap = Math.abs(measured - reference.value);
      if (gap > value.agrees.tolerance)
        throw new Error(
          `valeur « ${name} » en ${year} : ${measured} s'écarte de « ${value.agrees.value} » (${reference.value}) de ${gap}, au-delà de ${value.agrees.tolerance}`
        );
    }
  }
  return out;
}

const DECIMAL: Record<Locale, string> = {
  en: '.',
  fr: ',',
  es: ',',
  'pt-BR': ',',
};

/**
 * Une valeur écrite dans une langue. Les degrés et les pour cent n'ont pas d'unité ici : le
 * texte de la fiche écrit « {inclinaison}° » ou « {ecart} % », parce que l'espace devant le signe
 * pour cent est une convention de langue que la fiche tient déjà.
 */
function formatActivityValue(value: EvaluatedValue, locale: Locale): string {
  switch (value.kind) {
    case 'degrees':
    case 'percent':
      return fixed(value.decimals)(value.value).replace('.', DECIMAL[locale]);
    case 'hours': {
      const total = Math.round(value.value * 60);
      return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
    }
    case 'date':
      // Par la règle de l'ordinal du dépôt : « 1er juillet » en français, jamais « 1 juillet ».
      return formatDateText(
        value.date,
        { day: 'numeric', month: 'long', timeZone: 'UTC' },
        locale,
        INTL_LOCALE[locale]
      );
  }
}

/** Remplit les emplacements `{nom}` d'un texte ; lève sur un emplacement sans valeur. */
export function fillSlots(
  text: string,
  values: Readonly<Record<string, EvaluatedValue>>,
  locale: Locale
): string {
  return text.replace(/\{([^{}]*)\}/g, (_, name: string) => {
    const value = values[name];
    if (!value) throw new Error(`emplacement « {${name}} » sans valeur`);
    return formatActivityValue(value, locale);
  });
}
