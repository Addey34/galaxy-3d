/**
 * LE LIBELLÉ D'UN FAIT SUIT LA GRANDEUR QUE SA SOURCE DÉCLARE (2026-10-03).
 *
 * Un champ du catalogue ne dit pas toujours la même chose d'un corps à l'autre. `meanTempC` est
 * une température moyenne pour la Terre (NSSDCA, « Mean Temperature »), une température au niveau
 * de pression de 1 bar pour Jupiter (la même fiche : « or for the gas giants at the one bar
 * level »), la température EFFECTIVE pour le Soleil, et une température de SURFACE pour Encelade
 * (« the surface temperature is … about minus 201 degrees Celsius », NASA Science). Et
 * `rotationPeriod` est sidérale pour une planète (« relative to the fixed background stars »),
 * mais SYNODIQUE pour un petit corps de la SBDB (« body rotation period (synodic) », le champ
 * `desc` de la base elle-même). La fiche et les pages publiques écrivaient « température
 * moyenne » et « rotation sidérale » pour tous : des libellés plus affirmatifs que leur source
 * (le compte vit dans `src/config/factQuantity.test.ts`, qui le DÉRIVE du catalogue).
 *
 * Ce module rend la CLÉ de dictionnaire du libellé exact, à partir de la provenance du fait :
 * la fiche la traduit avec `t()`, les pages générées avec leur dictionnaire. Une seule règle,
 * deux lecteurs. Une source qui ne qualifie pas sa période (les articles
 * de Néréide et de Quaoar) reçoit le libellé NEUTRE : on n'ajoute pas un adjectif qu'elle n'a pas
 * écrit. Éris n'en est pas : son article la dit « tidally locked » à l'orbite de Dysnomia, donc sa
 * période est une période orbitale sidérale, comme celle d'une lune synchrone.
 */
import type { FactProvenance } from '@/types';

export type TemperatureLabelKey =
  | 'stat.meanTemperature'
  | 'stat.meanTemperature1Bar'
  | 'stat.effectiveTemperature'
  | 'stat.surfaceTemperature';

export type RotationLabelKey =
  | 'stat.siderealRotation'
  | 'stat.siderealRotationAt16'
  | 'stat.synodicRotation'
  | 'stat.rotationPeriod';

/** La clé `detail.…` que porte la provenance, ou `null` (texte libre ou pas de précision). */
function detailKey(provenance: FactProvenance | undefined): string | null {
  const detail = provenance?.detail;
  return detail && 'message' in detail ? detail.message : null;
}

export function temperatureLabelKey(
  provenance: FactProvenance | undefined
): TemperatureLabelKey {
  switch (detailKey(provenance)) {
    case 'detail.effectiveTemperature':
      return 'stat.effectiveTemperature';
    case 'detail.temperature1Bar':
      return 'stat.meanTemperature1Bar';
    case 'detail.surfaceTemperature':
      return 'stat.surfaceTemperature';
    default:
      return 'stat.meanTemperature';
  }
}

/**
 * Les deux sources dont la nature de la période est DÉCLARÉE : les fiches du NSSDCA (sidérale,
 * par leur note de définition) et la SBDB (synodique, par le `desc` de son champ, tenu par
 * `src/config/factQuantity.test.ts` sur le relevé livré). Toute autre source : libellé neutre.
 */
export function rotationLabelKey(
  provenance: FactProvenance | undefined
): RotationLabelKey {
  const detail = detailKey(provenance);
  if (detail === 'detail.solarRotationAt16Degrees')
    return 'stat.siderealRotationAt16';
  // Une rotation synchrone vaut la période orbitale SIDÉRALE du satellite.
  if (detail === 'detail.synchronousRotation') return 'stat.siderealRotation';
  switch (provenance?.source) {
    case 'nssdca-fact-sheets':
      return 'stat.siderealRotation';
    case 'jpl-sbdb':
      return 'stat.synodicRotation';
    default:
      return 'stat.rotationPeriod';
  }
}
