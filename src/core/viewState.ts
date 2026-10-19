/**
 * L'ÉTAT D'UNE VUE, HORS CAMÉRA : ce qu'un lien de partage doit encore porter (lot 60).
 *
 * Le permalien porte déjà le corps, la date, le mode et, sur demande, la caméra. Il ne portait
 * pas ce qui change l'IMAGE : le tableau « Dans la scène » (qui est nommé, dessiné, tracé) et les
 * couches météo allumées. Ouvrir un lien partagé redonnait donc la scène par défaut, sans la lune
 * que l'on voulait montrer. Ce module est le codec PUR de ces deux états, sans DOM ni registre.
 *
 * Le tableau s'écrit en ÉCARTS à la règle de départ (`ui/defaultDisplay.ts`), comme un
 * préréglage : un lien reste court, et un corps ajouté au catalogue demain garde son défaut.
 *   scene = « l-venus,b+io,o+europa »   (colonne : l étiquette, b objet, o orbite ; + allumé, - éteint)
 *   layers = « +precip,-clouds »        (l'état de chaque couche météo, absolu)
 */

type SceneColumn = 'label' | 'object' | 'orbit';

const COLUMN_CODE: Record<SceneColumn, string> = {
  label: 'l',
  object: 'b',
  orbit: 'o',
};
const CODE_COLUMN = new Map(
  (Object.entries(COLUMN_CODE) as [SceneColumn, string][]).map(([c, k]) => [
    k,
    c,
  ])
);

export interface SceneChange {
  column: SceneColumn;
  name: string;
  on: boolean;
}

/** Plafonds : une adresse démesurée est ignorée plutôt que crue (comme `place`). */
const MAX_PARAM_LENGTH = 4000;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Les cases dont l'état diffère de la règle de départ, en jetons triés (lien stable). */
export function encodeSceneChanges(changes: readonly SceneChange[]): string {
  return changes
    .map((c) => `${COLUMN_CODE[c.column]}${c.on ? '+' : '-'}${c.name}`)
    .sort()
    .join(',');
}

export function decodeSceneChanges(value: string | null): SceneChange[] {
  if (!value || value.length > MAX_PARAM_LENGTH) return [];
  const out: SceneChange[] = [];
  for (const token of value.split(',')) {
    const column = CODE_COLUMN.get(token[0] ?? '');
    const sign = token[1];
    const name = token.slice(2);
    if (!column || (sign !== '+' && sign !== '-') || !NAME.test(name)) continue;
    out.push({ column, name, on: sign === '+' });
  }
  return out;
}

export interface LayerChange {
  id: string;
  on: boolean;
}

/** L'état de chaque couche, ABSOLU : `+clouds` allumée, `-wind` éteinte (cf. `WeatherLayersApi.states`). */
export function encodeLayerChanges(changes: readonly LayerChange[]): string {
  return changes
    .map((c) => `${c.on ? '+' : '-'}${c.id}`)
    .sort()
    .join(',');
}

export function decodeLayerChanges(value: string | null): LayerChange[] {
  if (!value || value.length > MAX_PARAM_LENGTH) return [];
  const seen = new Set<string>();
  const out: LayerChange[] = [];
  for (const token of value.split(',')) {
    const sign = token[0];
    const id = token.slice(1);
    if ((sign !== '+' && sign !== '-') || !NAME.test(id) || seen.has(id))
      continue;
    seen.add(id);
    out.push({ id, on: sign === '+' });
  }
  return out;
}
