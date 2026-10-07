/**
 * Luminance linéaire AFFICHÉE par unité d'albédo géométrique, mesurée sur la texture lunaire :
 * elle s'affiche à une luminance linéaire moyenne de 0,312 pour un albédo de 0,12, soit 2,6. Les
 * autres textures s'étalent de 1,6 (Mercure) à 3,8 (Phobos) : la Lune est retenue parce qu'elle
 * est la mieux mesurée, pas parce que l'écart n'existe pas.
 *
 * C'est une convention de CUISSON, plus d'affichage (2026-10-07) : la luminosité affichée suit
 * désormais `DISPLAY_LUMINANCE_PER_ALBEDO` de `src/core/displayAlbedo.ts` (0,5), et un gain de
 * rendu ramène ce qui a été cuit ici à cette règle (`scripts/measure-display-albedo.mjs`). Les
 * fichiers déjà cuits ne sont pas refaits.
 *
 * Seul propriétaire de cette convention : la couleur cuite dans un modèle de forme
 * (`bake-shape-colour.mjs`) et une texture composée d'albédos (`compose-albedo-texture.mjs`)
 * l'importent, et `src/config/shapeModels.test.ts` la confronte à ce fichier.
 */
export const DISPLAY_PER_ALBEDO = 0.312 / 0.12;
