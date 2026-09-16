/**
 * NIVEAU DE DÉTAIL D'UN MODÈLE DE FORME — même logique que les textures, appliquée aux maillages.
 *
 * Chaque corps modélisé est livré en `{corps}/{corps}_shape_{1k,2k,4k}.glb` (budgets de
 * ~4 000, ~15 000 et ~60 000 triangles, produits par `scripts/decimate-shape-model.mjs
 * --target`). On charge d'abord le plus léger ; le plus fin n'est téléchargé que si la caméra
 * s'approche ASSEZ pour qu'il se voie, et jamais au-delà du plafond du palier de qualité. Un
 * astéroïde qu'on ne visite pas ne coûte ainsi que ~70 Kio, quel que soit l'appareil.
 */
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
