/**
 * Les FONDS que le visiteur peut choisir pour le sol de la Terre (lot 48), dans l'ordre du
 * réglage. Le panneau vit au démarrage et ne lit pas les fiches d'imagerie : il porte cette liste
 * et ses libellés, et `config/surfaceTilesets.test.ts` la confronte aux variantes des fiches.
 */
export const SURFACE_CHOICES = [
  'mosaic',
  'daily',
  'shaded-relief',
  'night-lights',
] as const;

export type SurfaceChoiceId = (typeof SURFACE_CHOICES)[number];
