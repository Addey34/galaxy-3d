import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Les divergences du registre du PDS dont la différence a été LUE et tranchée par écrit
 * (`pds-known-divergences.json`). Les deux générateurs qui lisent ce registre (missions,
 * instruments) s'arrêtaient devant toute paire de lignes divergentes pour un même identifiant,
 * et c'est toujours le défaut : choisir serait arbitraire.
 *
 * Cette fonction n'ouvre une exception que pour une paire que la table nomme, et seulement si
 * elle diffère de la façon décrite : même identifiant, même début, même fin, la ligne gardée
 * porte le nom déclaré, et ce qu'elle cite est inclus dans ce que cite l'autre. Une source qui
 * changerait d'une autre façon fait ÉCHOUER de nouveau le générateur.
 */
const TABLE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'pds-known-divergences.json'),
    'utf8'
  )
);

const included = (small, big) => small.every((value) => big.includes(value));

/**
 * @param {{ lid: string, name: string, start: string|null, end: string|null, refs: string[] }} a
 * @param {{ lid: string, name: string, start: string|null, end: string|null, refs: string[] }} b
 * @returns la ligne à garder, ou `null` si la paire n'est pas une divergence connue.
 */
export function resolveKnownDivergence(a, b) {
  const rule = TABLE[a.lid];
  if (!rule || a.lid !== b.lid) return null;
  const keep = [a, b].find((row) => row.name === rule.keepName);
  const other = keep === a ? b : a;
  if (!keep || keep === other || other.name === keep.name) return null;
  if (keep.start !== other.start || keep.end !== other.end) return null;
  if (!included(keep.refs, other.refs)) return null;
  return keep;
}
