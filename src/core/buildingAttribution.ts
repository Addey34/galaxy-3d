/**
 * Confronte l'attribution d'un jeu de bâtiments Overture aux jeux sources RÉELLEMENT présents dans
 * sa boîte (relevés au cuisage, `source.datasets` du manifeste). Pur, sans DOM ni réseau.
 *
 * Overture déclare une licence pour tout le thème mais y mêle plusieurs sources ; créditer « le
 * thème » plutôt que ce qui est dans la zone cite des sources absentes ou en oublie des présentes.
 * Un jeu source inconnu de cette table est un ÉCART : il faut décider comment le créditer.
 */
export const OVERTURE_DATASET_CREDIT: Readonly<Record<string, RegExp>> = {
  OpenStreetMap: /OpenStreetMap/,
  'Google Open Buildings': /Google Open Buildings/,
  'Microsoft ML Buildings': /Microsoft/,
  'USGS Lidar': /USGS/,
};

export interface AttributionGaps {
  /** Jeux présents dont on ne sait pas comment ils se créditent (absents de la table). */
  unmapped: string[];
  /** Jeux présents que l'attribution ne cite pas. */
  uncited: string[];
  /** Sources citées par l'attribution mais absentes de la boîte. */
  citedButAbsent: string[];
}

export function attributionGaps(
  datasets: Readonly<Record<string, number>>,
  attribution: string
): AttributionGaps {
  const present = Object.entries(datasets)
    .filter(([, count]) => count > 0)
    .map(([name]) => name);
  const unmapped = present.filter((name) => !(name in OVERTURE_DATASET_CREDIT));
  const uncited = present.filter((name) => {
    const credit = OVERTURE_DATASET_CREDIT[name];
    return credit !== undefined && !credit.test(attribution);
  });
  const citedButAbsent = Object.entries(OVERTURE_DATASET_CREDIT)
    .filter(
      ([name, credit]) => !present.includes(name) && credit.test(attribution)
    )
    .map(([name]) => name);
  return { unmapped, uncited, citedButAbsent };
}
