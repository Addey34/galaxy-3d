/**
 * Décodage sRGB → linéaire d'une valeur 8 bits (IEC 61966-2-1).
 *
 * Une texture déclarée `SRGBColorSpace` est DÉCODÉE par le GPU : le shader lit des valeurs
 * linéaires. Un seuil mesuré sur les octets d'une image (ce que montre un histogramme ou un
 * éditeur) doit donc passer par ici avant d'être comparé à `texture2D` : sans cela, 0,02 lu comme
 * « presque noir » vaut en réalité 39 sur 255, un océan sombre parfaitement observé.
 */
export function srgbByteToLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
