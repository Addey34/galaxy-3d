/**
 * Déclarations de `cog-reader.mjs`, pour que `src/config/glo30Pull.test.ts` le confronte SOUS
 * TYPES plutôt qu'en `any` (même raison que `fact-source-cache.d.mts` : le tirage tourne avec un
 * `node` nu, sans serveur Vite pour charger du TypeScript).
 */

/** Une grille flottante lue dans un COG, avec son géoréférencement. */
export interface FloatCog {
  width: number;
  height: number;
  stepLonDeg: number;
  stepLatDeg: number;
  /** Coin nord-ouest du premier échantillon (son centre si `pixelIsPoint`, son bord sinon). */
  westDeg: number;
  northDeg: number;
  pixelIsPoint: boolean;
  noData: number | undefined;
  values: Float32Array;
}

/** Lit un COG flottant tuilé (deflate, prédicteur flottant). */
export function readFloatCog(bytes: Uint8Array, source?: string): FloatCog;
