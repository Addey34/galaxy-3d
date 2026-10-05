/**
 * LA TEINTE sRGB D'UNE COULEUR MOYENNE MESURÉE, pour le `tint` de `scripts/import-textures.mjs`.
 *
 * Les réflectances moyennes de trois bandes (rouge, vert, bleu) gardent leurs RAPPORTS, sont lues
 * comme du RVB linéaire, normalisées par la plus forte, puis encodées en sRGB : seule la
 * CHROMINANCE est publiée, l'import la posant sur la luminance de la carte. Extrait de
 * `measure-mean-colour.mjs` (Gaspra) le 2026-10-05 pour servir aussi à Ryugu, plutôt que recopié.
 */
export function tintFromMeans(mean) {
  const top = Math.max(...mean);
  const toSrgb = (c) =>
    Math.round(
      255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
    );
  return mean.map((c) => toSrgb(c / top));
}
