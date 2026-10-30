/**
 * Textes de nombres partagés par la fiche (audit des panneaux, C7) : l'exposant Unicode et le
 * kelvin suivi de sa conversion existaient en deux exemplaires (`bodyInfo`, `atmosphereBlock`)
 * qui pouvaient diverger. Pur : la mise en forme d'un nombre (langue) est passée par l'appelant.
 */
import { convertTemperatureC } from './units';

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '-': '\u207b',
  '0': '\u2070',
  '1': '\u00b9',
  '2': '\u00b2',
  '3': '\u00b3',
  '4': '\u2074',
  '5': '\u2075',
  '6': '\u2076',
  '7': '\u2077',
  '8': '\u2078',
  '9': '\u2079',
};

/** Exposant en chiffres exposants Unicode (24 donne « ²⁴ », -3 donne « ⁻³ »). */
export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT_DIGITS[c] ?? c)
    .join('');
}

/**
 * Un kelvin publié suivi de sa conversion dans l'unité choisie (« 165 K (-108 °C) »). Insécables
 * entre un nombre et son unité : la coupure ne tombe qu'avant la conversion.
 */
export function kelvinWithConversion(
  kelvin: number,
  format: (n: number) => string
): string {
  const temp = convertTemperatureC(kelvin - 273.15);
  return `${format(kelvin)}\u00a0K (${format(temp.value)}\u00a0${temp.unit})`;
}
