/**
 * Clé de repeinture d'un calque 2D : tant qu'elle ne change pas, le canvas déjà peint est juste.
 *
 * Une caméra qui suit une cible mobile dérive d'environ 1e-7 à 1e-6 unité scène par image, sans
 * effet visible : comparée exactement, la clé changeait à chaque image et le calque se repeignait
 * (mesuré le 2026-10-29, cible ATLAS : ~46 vidages en 3 s pour chacun des quatre calques). On
 * quantifie donc ; l'erreur reste bornée à `VIEW_KEY_QUANTUM` par rapport à la dernière peinture,
 * puisqu'on compare toujours à la clé de CETTE peinture et non à celle de l'image précédente.
 */
export const VIEW_KEY_QUANTUM = 1e-5;

/**
 * Signature d'occlusion : une somme pondérée (jusqu'à x11) de positions, elle dérive plus vite
 * que chaque coordonnée. Un déplacement réel de la caméra reste vu par les matrices ci-dessus.
 */
export const SIGNATURE_QUANTUM = 1e-4;

/** Orientation d'un corps qui tourne : 5e-5 rad fait au plus 0,25 px sur un disque de 5000 px. */
export const ROTATION_QUANTUM = 5e-5;

/** Quantifie des valeurs de vue (matrices, signature d'occlusion) pour la comparaison de clés. */
export function quantizeViewKey(
  values: ArrayLike<number>,
  quantum = VIEW_KEY_QUANTUM
): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++)
    out.push(Math.round(values[i]! / quantum));
  return out;
}

/** Deux clés quantifiées décrivent-elles la même vue ? */
export function sameViewKey(
  a: readonly number[],
  b: readonly number[]
): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
