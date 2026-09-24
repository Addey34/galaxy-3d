/**
 * LE CURSEUR DE VITESSE, EN ARITHMÉTIQUE PURE.
 *
 * Extrait de `ui/playback.ts` à la phase 17D pour une raison de test : les tests unitaires de
 * ce dépôt tournent en environnement `node`, sans DOM, et `ui/playback.ts` lit ses éléments dès
 * son import. La décision « quelle vitesse pour quelle position de poignée, et que faire quand
 * la connexion ne suit pas » est donc ici, gardée, pendant que le module DOM garde le câblage.
 *
 * Le curseur est BIDIRECTIONNEL : le centre vaut le temps réel 1:1, la droite accélère vers le
 * futur, la gauche remonte le temps (`SimulationClock` accepte un `timeScale` négatif). Chaque
 * demi-course est exponentielle, de ±1 au centre à ±`MAX_SIMULATION_SCALE` au bord.
 */

import { getLocale, type Locale } from '@/i18n';

/** Un an simulé par seconde réelle. C'est la course maximale du curseur, pas une limite physique. */
export const MAX_SIMULATION_SCALE = 31_557_600;

export const SPEED_SLIDER_MAX = 100;
export const SPEED_SLIDER_CENTER = 50;
/** Petite zone morte autour du centre : facilite le retour exact au 1:1 sans viser au pixel. */
export const SPEED_CENTER_DEADZONE = 2;

const HALF_COURSE = SPEED_SLIDER_MAX - SPEED_SLIDER_CENTER;

/**
 * Position de curseur vers vitesse SIGNÉE. Centre = +1 (temps réel). L'écart au centre,
 * normalisé dans [0, 1], donne une magnitude exponentielle de 1 à `MAX_SIMULATION_SCALE` ; le
 * signe suit le côté.
 */
export function scaleFromSlider(value: number): number {
  const clamped = Math.max(0, Math.min(SPEED_SLIDER_MAX, value));
  const offset = clamped - SPEED_SLIDER_CENTER;
  if (Math.abs(offset) <= SPEED_CENTER_DEADZONE) return 1;
  const magnitudeNorm =
    (Math.abs(offset) - SPEED_CENTER_DEADZONE) /
    (HALF_COURSE - SPEED_CENTER_DEADZONE);
  const magnitude = Math.max(
    1,
    Math.round(Math.exp(magnitudeNorm * Math.log(MAX_SIMULATION_SCALE)))
  );
  return offset < 0 ? -magnitude : magnitude;
}

/**
 * Position de curseur qui rend EXACTEMENT cette magnitude : l'inverse de `scaleFromSlider`,
 * au demi-cours près (le signe est ajouté par l'appelant).
 *
 * Sert au plafond de vitesse : quand le lien ne soutient pas la vitesse demandée, la poignée
 * revient à la vitesse maximale soutenable, au lieu de rester posée sur une promesse que
 * l'application ne tient pas.
 */
export function sliderFromMagnitude(magnitude: number): number {
  const bounded = Math.max(1, Math.min(MAX_SIMULATION_SCALE, magnitude));
  if (bounded <= 1) return 0;
  const magnitudeNorm = Math.log(bounded) / Math.log(MAX_SIMULATION_SCALE);
  return (
    SPEED_CENTER_DEADZONE +
    magnitudeNorm * (HALF_COURSE - SPEED_CENTER_DEADZONE)
  );
}

/** Ce que le curseur applique vraiment, une fois le plafond du lien pris en compte. */
export interface CappedSpeed {
  /** Vitesse appliquée à l'horloge, signée. */
  readonly scale: number;
  /** Position de poignée à afficher : celle demandée, ou celle du plafond. */
  readonly sliderValue: number;
  /** Le plafond a-t-il mordu ? C'est ce qui décide si l'interface le DIT. */
  readonly limited: boolean;
}

/**
 * Applique le plafond mesuré à une position de curseur (§ 9b du plan du lot 17, option (c)
 * tranchée le 2026-09-24 : la date reste exacte, et c'est le curseur qui renonce, en le disant).
 *
 * `ceiling` à `null` veut dire qu'il n'y a RIEN à plafonner, ce qui est le cas courant : aucun
 * débit mesuré, ou un lien qui absorbe déjà la vitesse maximale (au-dessus de 2,34 Mbit/s,
 * mesuré). Le plafond s'applique à la MAGNITUDE, jamais au signe : remonter le temps coûte
 * exactement les mêmes octets que le parcourir vers l'avant.
 */
export function applyCeiling(
  sliderValue: number,
  ceiling: number | null
): CappedSpeed {
  const safe = Math.max(0, Math.min(SPEED_SLIDER_MAX, sliderValue));
  const asked = scaleFromSlider(safe);
  if (ceiling === null || !Number.isFinite(ceiling) || ceiling <= 0)
    return { scale: asked, sliderValue: safe, limited: false };
  if (Math.abs(asked) <= ceiling)
    return { scale: asked, sliderValue: safe, limited: false };
  const magnitude = Math.max(1, Math.min(MAX_SIMULATION_SCALE, ceiling));
  const sign = asked < 0 ? -1 : 1;
  return {
    scale: sign * magnitude,
    sliderValue: SPEED_SLIDER_CENTER + sign * sliderFromMagnitude(magnitude),
    limited: true,
  };
}

const SPEED_UNITS = [
  { scale: 31_557_600, fr: 'an', en: 'y' },
  { scale: 2_592_000, fr: 'mois', en: 'mo' },
  { scale: 604_800, fr: 'sem', en: 'wk' },
  { scale: 86_400, fr: 'j', en: 'd' },
  { scale: 3_600, fr: 'h', en: 'h' },
  { scale: 60, fr: 'min', en: 'min' },
] as const;

/**
 * Quantité affichée sur le curseur, AVEC LE SÉPARATEUR DÉCIMAL DE LA LANGUE.
 *
 * Défaut trouvé le 2026-09-24 en relisant le rendu français, comme la règle du texte publié
 * l'exige : `toFixed` écrit un POINT, donc l'interface française annonçait « 5.5 mois/s ». Il est
 * antérieur à la phase 17D, mais le plafond de vitesse rend une valeur décimale systématique
 * (une vitesse soutenable n'a aucune raison de tomber sur un compte rond), donc il se voyait
 * désormais à chaque lien lent.
 */
export function formatQuantity(value: number, locale: Locale): string {
  if (value >= 100) return String(Math.round(value / 10) * 10);
  if (value >= 10) return String(Math.round(value));
  const one = value.toFixed(1).replace(/\.0$/, '');
  return locale === 'fr' ? one.replace('.', ',') : one;
}

export function speedLabel(
  scale: number,
  locale: Locale = getLocale()
): string {
  if (scale === 1)
    return locale === 'fr'
      ? '1:1 · Échelle réelle Terre'
      : '1:1 · Earth real time';

  // Vitesse signée : magnitude commune, préfixe directionnel pour le passé (temps qui recule).
  const magnitude = Math.abs(scale);
  const reversed = scale < 0;
  const unit = SPEED_UNITS.find((candidate) => magnitude >= candidate.scale);
  const body = unit
    ? `${formatQuantity(magnitude / unit.scale, locale)} ${
        locale === 'fr' ? unit.fr : unit.en
      }/s`
    : `× ${formatQuantity(magnitude, locale)}`;
  if (!reversed) return body;
  // Préfixe « ◀ » + mention passé : on remonte le temps.
  return locale === 'fr' ? `◀ ${body} (passé)` : `◀ ${body} (past)`;
}
