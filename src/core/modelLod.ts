/**
 * NIVEAU DE DÉTAIL D'UN MODÈLE DE FORME — même logique que les textures, appliquée aux maillages.
 *
 * Chaque corps modélisé est livré en `{corps}/{corps}_shape_{1k,2k,4k}.glb` (budgets de
 * ~4 000, ~15 000 et ~60 000 triangles, produits par `scripts/decimate-shape-model.mjs
 * --target`). On charge d'abord le plus léger, QUAND le corps approche ou qu'on le cible
 * (`MODEL_LOAD_DISTANCE`) ; le plus fin n'est téléchargé que si la caméra s'approche ASSEZ pour qu'il
 * se voie, et jamais au-delà du plafond du palier de qualité. Un astéroïde qu'on ne visite pas ne
 * coûte ainsi RIEN, quel que soit l'appareil (il en coûtait ~70 Kio chacun au démarrage).
 */
/**
 * CADENCE DU NIVEAU DE DÉTAIL, en images : textures ET modèles ne sont réévalués qu'une image sur
 * `LOD_UPDATE_INTERVAL` (`AnimationSystem._updateLOD`), parce qu'un changement de palier déclenche
 * un upload GPU coûteux. Exportée parce que la suite e2e en dépend (`e2e/mainThread.ts`) : un
 * chargement DÛ n'est visible dans `data-textures-loading` qu'à la prochaine réévaluation, donc
 * un calme se prouve sur une série d'images plus longue que cette cadence.
 */
export const LOD_UPDATE_INTERVAL = 5;

export type ModelQuality = '1k' | '2k' | '4k';

export const MODEL_QUALITY_ORDER: readonly ModelQuality[] = ['1k', '2k', '4k'];

/**
 * Seuils de distance, en RAYONS du corps. Au-delà de 60 rayons, un corps sous-kilométrique
 * n'occupe que quelques dizaines de pixels : 4 000 triangles y suffisent largement. Sous
 * 12 rayons, il remplit une bonne part de l'écran et le relief fin se voit.
 */
export const MODEL_LOD_DISTANCE = { fine: 12, medium: 60 } as const;

/**
 * Niveau à charger : le plus fin que justifie la distance, borné par le plafond du palier ET
 * par les niveaux réellement livrés (Ida n'a pas de 4k : sa source ne contient pas assez de
 * détail pour en produire un sans l'inventer).
 */
export function chooseModelQuality(
  available: readonly ModelQuality[],
  normalizedDistance: number,
  maxQuality: ModelQuality
): ModelQuality | null {
  if (available.length === 0) return null;
  const wanted: ModelQuality =
    normalizedDistance <= MODEL_LOD_DISTANCE.fine
      ? '4k'
      : normalizedDistance <= MODEL_LOD_DISTANCE.medium
        ? '2k'
        : '1k';
  const cap = Math.min(
    MODEL_QUALITY_ORDER.indexOf(wanted),
    MODEL_QUALITY_ORDER.indexOf(maxQuality)
  );
  for (let i = cap; i >= 0; i--)
    if (available.includes(MODEL_QUALITY_ORDER[i]!))
      return MODEL_QUALITY_ORDER[i]!;
  // Aucun niveau aussi léger que demandé : le plus léger livré.
  return [...available].sort(
    (a, b) => MODEL_QUALITY_ORDER.indexOf(a) - MODEL_QUALITY_ORDER.indexOf(b)
  )[0]!;
}

/** Le niveau le plus léger livré — celui qu'on charge d'abord. */
export function lightestModelQuality(
  available: readonly ModelQuality[]
): ModelQuality | null {
  return chooseModelQuality(available, Number.POSITIVE_INFINITY, '1k');
}

/**
 * DISTANCE, EN RAYONS DU CORPS, EN DEÇÀ DE LAQUELLE SON MODÈLE DE FORME COMMENCE À SE CHARGER
 * (GAL-ENGINE-HEADROOM-001). Avant, chaque corps modélisé chargeait son maillage le plus léger à sa
 * création, vu ou non : le chargeur glTF et quinze fichiers partaient au démarrage pour des corps de
 * quelques pixels. Maintenant le corps garde sa sphère tant qu'il est plus loin que ce seuil, et le
 * maillage arrive AVANT qu'il se distingue d'une sphère. MESURÉ le 2026-11-24 dans la vue d'ensemble
 * du mode Éducatif (tailles pédagogiques) : les vingt-sept corps y sont à 1 846 à 8 960 rayons, soit
 * 0,2 à 1,2 pixel sur une fenêtre de 900 pixels de haut et un champ de 45° (`apparentDiameterPx`). À 1 200 rayons un corps mesure
 * 1,8 pixel, et sa forme ne se lit qu'au-delà de ~8 pixels (270 rayons) : le maillage a donc plus de
 * quatre fois la distance pour arriver, qui est celle d'un vol de caméra de plusieurs secondes. La
 * cible d'un vol (`prepareForApproach`) est chargée tout de suite, sans attendre ce seuil.
 */
export const MODEL_LOAD_DISTANCE = 1200;

/**
 * Marge, en coordonnées d'écran normalisées (1 = le bord), au-delà de laquelle un corps est « hors du
 * champ » : 1,6 laisse un corps entrer d'un demi-écran dans le champ avant qu'on le voie, le temps que
 * son maillage arrive. Un corps derrière la caméra ou loin sur le côté ne charge rien (GAL-ENGINE-HEADROOM-001,
 * mesuré : à l'adresse `/earth/` en mode Éducatif, vingt et un maillages partaient au démarrage pour des
 * corps hors du champ).
 */
export const MODEL_VIEW_MARGIN = 1.6;

/** Le point (coordonnées normalisées après projection) est-il devant la caméra et près du champ ? */
export function isNearView(ndcX: number, ndcY: number, ndcZ: number): boolean {
  return (
    ndcZ > -1 &&
    ndcZ < 1 &&
    Math.abs(ndcX) <= MODEL_VIEW_MARGIN &&
    Math.abs(ndcY) <= MODEL_VIEW_MARGIN
  );
}

/**
 * Faut-il commencer à charger (ou garder) le maillage ? Un niveau déjà là reste ; sinon il faut que le
 * corps soit assez près ET près du champ de la caméra.
 */
export function shouldLoadShapeModel(
  normalizedDistance: number,
  loaded: ModelQuality | null,
  nearView = true
): boolean {
  return (
    loaded !== null || (normalizedDistance <= MODEL_LOAD_DISTANCE && nearView)
  );
}

/**
 * Diamètre apparent, en pixels, d'un corps à `normalizedDistance` rayons : l'écran de `viewportPx`
 * pixels de haut couvre `2 tan(fov/2)` fois la distance, le corps `2 r`.
 */
export function apparentDiameterPx(
  normalizedDistance: number,
  viewportPx: number,
  fovDeg: number
): number {
  return (
    viewportPx /
    (Math.tan((fovDeg * Math.PI) / 360) * Math.max(normalizedDistance, 1e-9))
  );
}
