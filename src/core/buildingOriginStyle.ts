/**
 * COMMENT UN BÂTIMENT MONTRE D'OÙ VIENT SA HAUTEUR (lot 63, étape C.3b) : une couleur par origine,
 * lue à la fois par le matériau des bâtiments et par la légende (C.4), pour qu'elles ne puissent
 * pas diverger. Pur : ni Three.js ni DOM.
 *
 * La couleur ne porte JAMAIS seule l'information : un bâtiment sans hauteur est aussi une dalle
 * plate (`core/buildingMesh.ts`), donc la différence se voit sans la couleur.
 */
import { HEIGHT_ORIGIN } from './buildingTile';

/** Couleur sRGB (0xRRGGBB) de chaque origine, indexée par la valeur de `HEIGHT_ORIGIN`. */
export const ORIGIN_COLOURS: Readonly<Record<number, number>> = {
  [HEIGHT_ORIGIN.measured]: 0xe3dccb,
  [HEIGHT_ORIGIN.interpolated]: 0xb7c1cd,
  [HEIGHT_ORIGIN.derivedFromFloors]: 0xcdb79c,
  [HEIGHT_ORIGIN.unspecified]: 0xa9a9a9,
  [HEIGHT_ORIGIN.absent]: 0xe0b84a,
};

/** Couleur d'une origine ; une valeur hors liste est refusée plutôt que peinte au hasard. */
export function originColour(origin: number): number {
  const colour = ORIGIN_COLOURS[origin];
  if (colour === undefined)
    throw new Error(`origine de hauteur sans couleur (${origin})`);
  return colour;
}
