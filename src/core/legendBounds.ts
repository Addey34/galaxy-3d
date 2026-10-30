/**
 * LES BORNES DES LÉGENDES MÉTÉO, DANS L'UNITÉ CHOISIE (audit des panneaux, lot 1).
 *
 * Elles vivaient dans le dictionnaire (« −40 °C », « 960 hPa », « 20+ mm/h ») ou dans le code
 * (« 90+ km/h »), figées en unités métriques, alors que la température de la fiche suivait le
 * bouton d'unités. Une borne est maintenant calculée depuis le domaine de la palette qu'elle
 * décrit (`TEMPERATURE_DOMAIN`, `PRESSURE_DOMAIN`, `PRECIP_DOMAIN`, `WIND_DOMAIN`) : changer le
 * domaine change la légende, et le bouton change l'unité.
 *
 * Module pur : le seul état lu est le système d'unités de `./units`. Le nombre est mis en forme
 * par `Intl` dans la langue demandée (virgule décimale en français, point en anglais).
 */
import {
  convertPressureHpa,
  convertRainRateMmH,
  convertSpeedKmh,
  convertTemperatureC,
  getUnitSystem,
} from './units';

/** Espace insécable entre le nombre et son unité. */
const NBSP = String.fromCharCode(160);

const format = (
  value: number,
  decimals: number,
  locale?: string,
  fixed = false
): string =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: fixed ? decimals : 0,
  }).format(value);

/** Les décimales qui gardent deux chiffres significatifs à une petite valeur positive. */
function smallDecimals(value: number): number {
  if (!(value > 0)) return 0;
  return Math.min(6, Math.max(0, 1 - Math.floor(Math.log10(value))));
}

/**
 * Une borne de température : signe explicite (le vrai moins, U+2212), entier, unité. Le signe
 * se lit sur la valeur CONVERTIE : −40 °C vaut −40 °F, +45 °C vaut +113 °F.
 */
export function temperatureBound(celsius: number, locale?: string): string {
  const temp = convertTemperatureC(celsius);
  const rounded = Math.round(temp.value);
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${format(Math.abs(rounded), 0, locale)}${NBSP}${temp.unit}`;
}

/** Une borne de pression au niveau de la mer (hPa, ou inHg à deux décimales). */
export function pressureBound(hpa: number, locale?: string): string {
  const pressure = convertPressureHpa(hpa);
  const decimals = getUnitSystem() === 'imperial' ? 2 : 0;
  return `${format(pressure.value, decimals, locale, true)}${NBSP}${pressure.unit}`;
}

/**
 * Une borne de taux de pluie. `saturates` ajoute le « + » d'une borne haute : tout ce qui la
 * dépasse garde la dernière couleur.
 */
export function rainBound(
  mmPerHour: number,
  options: { saturates?: boolean; locale?: string } = {}
): string {
  const rate = convertRainRateMmH(mmPerHour);
  const decimals =
    getUnitSystem() === 'imperial' ? smallDecimals(rate.value) : 1;
  const plus = options.saturates ? '+' : '';
  return `${format(rate.value, decimals, options.locale)}${plus}${NBSP}${rate.unit}`;
}

/** Une borne de vitesse du vent (km/h, ou mph). */
export function windBound(
  kmPerHour: number,
  options: { saturates?: boolean; locale?: string } = {}
): string {
  const speed = convertSpeedKmh(kmPerHour);
  const plus = options.saturates ? '+' : '';
  return `${format(Math.round(speed.value), 0, options.locale)}${plus}${NBSP}${speed.unit}`;
}
