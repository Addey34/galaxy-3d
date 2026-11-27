/**
 * Pour les tests seulement : le voisinage tel que le client le construit, à partir des DEUX fichiers de
 * fournisseur livrés (`neighbours/hyg-v44.json`, `neighbours/gaia-dr3.json`), rapprochés par
 * `combineNeighbours`. Aucun fichier fusionné n'est livré ni conservé (GAL-UNIVERSE-008).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  combineNeighbours,
  type NeighbourFile,
  type NeighbourGaiaFile,
  type NeighbourHygFile,
} from './neighbours';

const DIR = resolve(process.cwd(), 'public/assets/sky/neighbours');

export const readHygNeighbourFile = (): NeighbourHygFile =>
  JSON.parse(
    readFileSync(resolve(DIR, 'hyg-v44.json'), 'utf8')
  ) as NeighbourHygFile;

export const readGaiaNeighbourFile = (): NeighbourGaiaFile =>
  JSON.parse(
    readFileSync(resolve(DIR, 'gaia-dr3.json'), 'utf8')
  ) as NeighbourGaiaFile;

export const shippedNeighbours = (): NeighbourFile =>
  combineNeighbours(readHygNeighbourFile(), readGaiaNeighbourFile());
