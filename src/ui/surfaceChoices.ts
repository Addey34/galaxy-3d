/**
 * Les FONDS que le visiteur peut choisir pour le sol de la Terre (lot 48), dans l'ordre du
 * réglage. Le panneau vit au démarrage et ne lit pas les fiches d'imagerie : il porte cette liste
 * et ses libellés, et `config/surfaceTilesets.test.ts` la confronte aux variantes des fiches.
 */
export const SURFACE_CHOICES = [
  'mosaic',
  'sentinel-2',
  'daily',
  'shaded-relief',
  'night-lights',
] as const;

export type SurfaceChoiceId = (typeof SURFACE_CHOICES)[number];

/**
 * Le fond de la Terre à l'arrivée (2026-10-23) : Sentinel-2, l'édition de l'année de la scène.
 * Mesuré au Mont Blanc, la Blue Marble (500 m par texel) arrête la descente à 47 km d'altitude
 * sous le plafond d'agrandissement, Sentinel-2 (10 m) à 0,9 km. De loin rien n'est demandé (au-delà
 * de 6 rayons apparents la texture livrée reste affichée), donc ce choix ne coûte rien au démarrage.
 */
export const DEFAULT_SURFACE_CHOICE: SurfaceChoiceId = 'sentinel-2';
