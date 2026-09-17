/**
 * Texte du BADGE DE TRAÇABILITÉ d'une donnée datée : source · date réelle · catégorie
 * temporelle · écart à la scène · (date la plus proche). Pur (candidat + deux dates + `t` →
 * texte) pour être testé sans DOM ; `weatherLayers.ts` le recalcule quand la scène change de
 * date, parce que la catégorie et l'écart dépendent de la scène et de l'instant réel, pas
 * seulement de la donnée chargée.
 */
import type { SourceCandidate } from '@/core/layerSource';
import {
  classifyTemporal,
  temporalCategoryLabelKey,
  UNAVAILABLE_STAMP,
} from '@/core/temporal';

type Translate = (
  key: string,
  vars?: Record<string, string | number>
) => string;

export function sourceBadgeText(
  candidate: SourceCandidate,
  simulationTime: Date,
  now: Date,
  t: Translate
): string {
  const stamp = candidate.product
    ? classifyTemporal(candidate.product, simulationTime, now)
    : UNAVAILABLE_STAMP;
  const parts = [
    `${t('weather.source.prefix')} ${candidate.label}`,
    candidate.realDate.slice(0, 10),
    t(temporalCategoryLabelKey(stamp.category)),
  ];
  if (stamp.confidence === 'reduced') parts.push(t('time.confidence.reduced'));
  if (stamp.offset) {
    parts.push(
      t('time.offset.scene', {
        date: simulationTime.toISOString().slice(0, 10),
      })
    );
  }
  if (candidate.approx) parts.push(t('weather.source.approx'));
  return parts.join(' · ');
}
