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
  weather?: { on?: readonly string[]; off?: readonly string[] };
  field?: Record<string, boolean | undefined>;
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

/** Un état posé sur une case à identifiant : une couche météo ou une catégorie du champ. */
export interface PresetToggle {
  id: string;
  on: boolean;
}

/**
 * Les couches météo d'un préréglage, en états ABSOLUS (lot 61). Une couche que la fiche ne nomme
 * pas revient à son état de démarrage : choisir « Classe » après « Météo » éteint donc ce que
 * « Météo » avait allumé, au lieu de dépendre du préréglage d'avant. `off` l'emporte sur le
 * démarrage, `on` aussi ; le schéma interdit qu'une couche soit dans les deux.
 */
export function resolvePresetWeather(
  preset: DisplayPresetShape | undefined,
  layers: readonly { id: string; initial: boolean }[]
): PresetToggle[] {
  const on = new Set(preset?.weather?.on ?? []);
  const off = new Set(preset?.weather?.off ?? []);
  return layers.map((layer) => ({
    id: layer.id,
    on: on.has(layer.id) ? true : off.has(layer.id) ? false : layer.initial,
  }));
}

/** Les catégories du champ de petits corps : visibles, sauf celles que la fiche éteint (lot 61). */
export function resolvePresetField(
  preset: DisplayPresetShape | undefined,
  categories: readonly string[]
): PresetToggle[] {
  return categories.map((id) => ({ id, on: preset?.field?.[id] ?? true }));
}
