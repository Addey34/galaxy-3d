/**
 * APPLIQUER UN PRÉRÉGLAGE D'AFFICHAGE : une fonction pure (lot 59).
 *
 * Un préréglage est une liste d'ÉCARTS à la règle de départ (`ui/defaultDisplay.ts`), par
 * catégorie puis par objet (cf. `registry/schema/preset.ts`). La résolution, dans cet ordre :
 *
 *   1. la règle de départ de l'objet ;
 *   2. l'écart de sa catégorie, case par case ;
 *   3. l'écart nommé pour lui, qui l'emporte.
 *
 * Une case que le préréglage ne nomme pas garde donc la règle : c'est ce qui laisse un corps
 * ajouté au catalogue recevoir le comportement du préréglage sans qu'on retouche une fiche. Pure :
 * ni DOM ni registre, le tableau lui passe ses lignes.
 */
import type { BodyKind } from '@/types';

export interface DisplayCells {
  label: boolean;
  object: boolean;
  orbit: boolean;
}

type Partial3 = Partial<DisplayCells>;

/** Ce que la fonction lit d'un préréglage : la forme du schéma, sans importer Zod. */
export interface DisplayPresetShape {
  kinds?: Partial<Record<BodyKind, Partial3>>;
  bodies?: Record<string, Partial3>;
}

export function resolvePresetCells(
  preset: DisplayPresetShape,
  name: string,
  kind: BodyKind,
  base: DisplayCells
): DisplayCells {
  return {
    ...base,
    ...preset.kinds?.[kind],
    ...preset.bodies?.[name],
  };
}
