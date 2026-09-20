/**
 * Nombre fini lu dans du JSON étranger, ou `NaN`.
 *
 * `Number()` seul ne suffit pas, et c'est un piège qui a été trouvé en écrivant le test, pas en
 * relisant le code : `Number(null)`, `Number('')`, `Number([])` et `Number(false)` valent tous
 * **0**, un nombre parfaitement fini. Une entrée GeoJSON dont l'instant est `null` devient donc
 * le 1er janvier 1970, et un couple de coordonnées manquant devient le point (0, 0) au large du
 * golfe de Guinée — deux valeurs plausibles, jamais signalées.
 *
 * Seuls un nombre fini et une chaîne numérique non vide sont acceptés.
 */
export function finiteNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}
