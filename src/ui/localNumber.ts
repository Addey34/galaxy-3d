/**
 * Nombres écrits selon la langue de l'interface (audit des panneaux, A4/A5). `toFixed` et
 * `String(n)` écrivent un point décimal et aucun séparateur de milliers en français, en espagnol
 * et en portugais ; `Intl` suit la langue. Un formateur par (langue, options) est gardé, comme
 * `bodyInfo.num` : `Intl.NumberFormat` coûte cher à construire.
 */
import { intlLocale } from '@/i18n';

const formats = new Map<string, Intl.NumberFormat>();

function formatterFor(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = intlLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    formats.set(key, format);
  }
  return format;
}

/** Nombre avec exactement `digits` décimales (équivalent localisé de `toFixed(digits)`). */
export function formatFixed(n: number, digits: number): string {
  return formatterFor({
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Entier avec séparateur de milliers de la langue. */
export function formatInteger(n: number): string {
  return formatterFor({ maximumFractionDigits: 0 }).format(n);
}

/** Fraction (0,41) écrite en pourcentage de la langue (« 41% » en anglais, « 41 % » en français). */
export function formatPercent(fraction: number): string {
  return formatterFor({
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction);
}
