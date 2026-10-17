/**
 * Déclarations de `pull-glo30.mjs`, pour `src/config/glo30Pull.test.ts` (cf. `cog-reader.d.mts`).
 */
import type { FloatCog } from './cog-reader.mjs';

/** Échantillons par degré du fichier réduit : 5″. */
export const GLO30_REDUCED_PER_DEGREE: number;
/** La valeur d'un échantillon sans donnée (mer, vide de la source). */
export const GLO30_NO_DATA: number;
/** La mention exigée par la licence de la donnée modifiée. */
export const GLO30_NOTICE: string;
/** Le nom d'un degré (`N45E006`). */
export function cellName(south: number, west: number): string;
/** Les degrés à tirer, DÉRIVÉS du manifeste du relief livré : `[nom, [sud, ouest]]`, triés. */
export function plannedCells(manifest: {
  coverage?: {
    bounds?: { west: number; east: number; north: number; south: number };
    levels?: number[];
  }[];
}): [string, [number, number]][];
/** Réduit un degré de GLO-30 à 720 × 720 échantillons par moyenne de surface. */
export function reduceCell(
  cog: FloatCog,
  south: number,
  west: number
): Int16Array;
