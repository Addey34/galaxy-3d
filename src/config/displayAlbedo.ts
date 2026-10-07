/**
 * Façade de la table des GAINS de luminosité (`displayAlbedo.json`, écrite par
 * `scripts/measure-display-albedo.mjs`). La règle et sa constante vivent dans
 * `core/displayAlbedo.ts` ; ici on ne fait que lire.
 *
 * Import NOMMÉ de `gains` seul : Vite écarte du bundle les lignes détaillées (`rows`), avec leurs
 * raisons et leurs sources, que seuls le test et l'inventaire lisent.
 */
import { gains } from './displayAlbedo.json';

const table: Readonly<Record<string, number>> = gains;

/**
 * Gain de luminosité de la surface d'un corps (texture drapée ou couleur cuite d'un modèle) : 1
 * pour un corps hors de la règle, qui garde alors la luminosité de sa source.
 */
export function displayGain(body: string): number {
  return table[body] ?? 1;
}
