/**
 * Les petits corps (astéroïdes, comètes, planètes naines), dans les unités publiées par les
 * astronomes : éléments osculateurs JPL Horizons en degrés et UA, à une époque déclarée.
 *
 * **Depuis le lot 7 (phase 4), leurs données sont des fiches** `src/registry/entities/*.json`
 * (`source: "small-body"`), converties en entrées du catalogue par `smallBodyToConfig`
 * (`smallBodyConfig.ts`), l'une des dérivations déclarées du chargeur. Ce module expose les deux
 * vues que lisent les tests et `/methodology` :
 *   - `SMALL_BODY_ELEMENTS` : les éléments publiés, que `smallBodies.test.ts` confronte chacun à
 *     un vecteur d'état Horizons à son époque. Chaque jeu est dérivé par
 *     `pnpm ephemeris:small-body`, jamais recopié à la main ;
 *   - `SMALL_BODIES` : leurs entrées du catalogue, les MÊMES objets que dans `CELESTIAL_CONFIG`.
 *
 * Loin de l'époque, un modèle à deux corps dérive (perturbations planétaires) : c'est une limite
 * du modèle, pas des éléments.
 */
import type { CelestialBodyConfig } from '@/types';
import { loadSmallBodyElements } from '@/registry/entities';
import { CELESTIAL_CONFIG } from './bodies';
import type { SmallBodyElements } from './smallBodyConfig';

export { smallBodyToConfig, type SmallBodyElements } from './smallBodyConfig';

/**
 * Les éléments publiés, dans l'ordre du catalogue. Les satellites d'un petit corps (Pluton)
 * pointent les objets du catalogue, comme avant la migration : une seule instance par corps.
 */
export const SMALL_BODY_ELEMENTS: readonly SmallBodyElements[] =
  loadSmallBodyElements().map((el) =>
    el.satellites
      ? { ...el, satellites: CELESTIAL_CONFIG.bodies[el.name]!.satellites }
      : el
  );

/** Table nom → entrée du catalogue des petits corps. */
export const SMALL_BODIES: Record<string, CelestialBodyConfig> =
  Object.fromEntries(
    SMALL_BODY_ELEMENTS.map((el) => [
      el.name,
      CELESTIAL_CONFIG.bodies[el.name]!,
    ])
  );
