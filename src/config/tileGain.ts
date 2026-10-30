/**
 * Façade de la table des GAINS de luminosité des mosaïques streamées (`tileGain.json`, écrite par
 * `scripts/measure-tile-gain.mjs`). La règle vit dans `core/displayAlbedo.ts` ; ici on ne fait
 * que lire. Import NOMMÉ de `gains` seul : Vite écarte du bundle les lignes de mesure.
 */
import { gains } from './tileGain.json';
import { displayGain } from './displayAlbedo';

const table: Readonly<Record<string, number>> = gains;

/**
 * Facteur à appliquer à la couleur du matériau d'un carreau, déjà multipliée par le gain de la
 * BASE (`displayGain`, calibré sur la texture livrée) : il le remplace par le gain mesuré sur la
 * mosaïque. 1 pour un corps hors de la règle (sa mosaïque garde sa luminosité).
 */
export function tileToneRatio(body: string): number {
  const own = table[body];
  if (own === undefined) return 1;
  return own / displayGain(body);
}
