/**
 * LES DOSSIERS QUI NE DOIVENT JAMAIS ATTEINDRE LE BUNDLE DU VISITEUR, déclarés UNE FOIS.
 *
 * Ces dossiers de `src/` ne tournent qu'au build (`build/` depuis le 2026-10-11), en CI ou dans les tests, et chacun a sa
 * raison mesurée :
 *
 *   - `seo/` : rastériseurs de sphère et de maillage, gabarits SVG. Personne n'exécute ça dans
 *     un navigateur (`src/seo/buildOnly.test.ts`) ;
 *   - `registry/schema/` : Zod, choisi en `devDependency` pour coûter zéro octet livré
 *     (`src/registry/schema/bundleIsolation.test.ts`) ;
 *   - `inventory/` : lit le disque et les registres de produits pour `pnpm inventory:gaps`
 *     (`src/config/inventoryGaps.test.ts`).
 *
 * Deux gardes balaient « l'application », c'est-à-dire tout `src/` SAUF ces dossiers. Elles
 * définissaient chacune sa propre exception, donc un troisième dossier build-only devenait
 * coupable chez l'autre : c'est exactement ce qui est arrivé à `inventory/` au lot 22, accusé de
 * vouloir embarquer Zod alors qu'il n'est pas livré. La liste a désormais un propriétaire unique,
 * et les deux gardes la lisent.
 *
 * Ce module n'exporte que des chaînes : un module de l'application peut l'importer sans rien
 * tirer avec lui, et aucune ne le fait.
 */

/** Chemins relatifs à `src/`, en segments séparés par `/`. */
export const BUILD_ONLY_DIRS: readonly string[] = [
  // Les transformations du source au build (`glslComments.ts` : TypeScript, une
  // `devDependency`, pour lire les gabarits des shaders). Ajouté le 2026-10-11.
  'build',
  'inventory',
  // Les activités pédagogiques (lot 58) : des FICHES IMPRIMABLES, lues par `seo/activityPages.ts`
  // seulement. L'élève joue dans la scène la visite qu'une activité nomme, jamais l'activité.
  'registry/activities',
  'registry/schema',
  'seo',
];
