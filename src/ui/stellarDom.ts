/**
 * Les petits outils DOM et numériques de la vue du voisinage, partagés avec le volume étendu
 * (`ui/stellarVolumePanel`, GAL-UNIVERSE-008) au lieu d'être recopiés.
 */
import { getLocale } from '@/i18n';

/** Un nombre à `digits` chiffres significatifs, dans la langue courante. */
export function number(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    maximumSignificantDigits: digits,
  }).format(value);
}

/** Un nombre à `digits` décimales exactement, dans la langue courante. */
export function fixed(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  id?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  return node;
}

/** Une ligne de fiche : terme et valeur. */
export function fact(label: string, value: string): HTMLElement[] {
  const dt = el('dt');
  dt.textContent = label;
  const dd = el('dd');
  dd.textContent = value;
  return [dt, dd];
}
