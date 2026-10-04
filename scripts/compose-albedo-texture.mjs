/* global Buffer, console, process */
/**
 * Compose une texture couleur à partir de trois cartes d'ALBÉDO flottantes (rouge, vert, bleu),
 * au cadrage de leur source, pour `scripts/import-textures.mjs`.
 *
 *   node scripts/compose-albedo-texture.mjs --rgb r.tif,v.tif,b.tif --albedo <pV> --out sortie.png
 *     [--width 8192] [--chroma-blur px]
 *
 * Mêmes règles que la couleur cuite dans les modèles de forme (`scripts/bake-shape-colour.mjs`) ;
 * la constante `DISPLAY_PER_ALBEDO` vient de `scripts/display-albedo.mjs`, jamais recopiée :
 *  - les trois bandes gardent leurs RAPPORTS mesurés : aucune n'est ramenée à sa propre moyenne,
 *    ce qui effacerait la couleur (Éros sortait gris) ;
 *  - un SEUL facteur commun ramène la luminance linéaire moyenne, pondérée par l'aire, à
 *    l'albédo géométrique publié converti à la convention d'affichage mesurée sur la Lune ;
 *  - un NoData n'est jamais mélangé à ses voisins : la réduction moyenne les seuls pixels valides
 *    de chaque empreinte, et un pixel sans aucune mesure sort NOIR, ce que l'import comble
 *    (`fillHoles`) sans inventer de détail.
 *
 * Écrit pour Éros (2026-10-04) : les albédos NEAR MSI de Golish et al. (2023) à 760, 550 et
 * 450 nm, lus dans le zip que l'USGS sert sur S3, membre par membre.
 */
import sharp from 'sharp';
import { DISPLAY_PER_ALBEDO } from './display-albedo.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const paths = option('--rgb')?.split(',');
const albedo = Number(option('--albedo'));
const out = option('--out');
const width = Number(option('--width') ?? 8192);
// Lissage de la CHROMINANCE seule, en pixels de sortie (0 = aucun). La luminance garde tout son
// détail ; seuls les RAPPORTS entre bandes sont moyennés, parce qu'à pleine résolution le léger
// décalage entre filtres et le bruit des longueurs d'onde extrêmes sortent en mouchetis rose et
// vert que l'œil prend pour de la couleur (Éros, vu le 2026-10-04). La couleur moyenne ne change pas.
const chromaBlur = Number(option('--chroma-blur') ?? 0);
if (!paths || paths.length !== 3 || !(albedo > 0) || !out) {
  console.error(
    'usage : node scripts/compose-albedo-texture.mjs --rgb r.tif,v.tif,b.tif --albedo <pV> --out sortie.png [--width 8192] [--chroma-blur px]'
  );
  process.exit(2);
}

/** Même critère que la cuisson : un albédo positif et plausible, jamais un NoData déguisé. */
const isValid = (v) => Number.isFinite(v) && v > 0 && v < 1000;

async function band(path) {
  // Une bande flottante sort de sharp en TROIS copies identiques (espace « b-w » promu en sRGB,
  // mesuré le 2026-10-04 : valeurs inchangées, triplées). On vérifie que le fichier n'en porte
  // qu'une, puis on la reprend seule : lire `largeur × hauteur` valeurs dans le tampon triplé
  // échantillonnerait d'autres pixels que ceux qu'on croit.
  const meta = await sharp(path, { limitInputPixels: false }).metadata();
  if (meta.channels !== 1)
    throw new Error(`${path} : ${meta.channels} canaux, une bande attendue`);
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .extractChannel(0)
    .raw({ depth: 'float' })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1)
    throw new Error(`${path} : ${info.channels} canaux après extraction`);
  return {
    values: new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4),
    width: info.width,
    height: info.height,
  };
}

const bands = [];
for (const path of paths) bands.push(await band(path));
const { width: W0, height: H0 } = bands[0];
if (bands.some((b) => b.width !== W0 || b.height !== H0))
  throw new Error('les trois bandes n’ont pas la même grille');
if (width > W0)
  throw new Error(`--width ${width} dépasse la source (${W0} px)`);
const height = Math.round((width * H0) / W0);

// Réduction par moyenne des seuls pixels valides de chaque empreinte, bande par bande.
const reduced = bands.map(() => new Float32Array(width * height).fill(NaN));
for (let k = 0; k < 3; k++) {
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  const values = bands[k].values;
  for (let y = 0; y < H0; y++) {
    const cy = Math.min(height - 1, Math.floor((y * height) / H0));
    for (let x = 0; x < W0; x++) {
      const v = values[y * W0 + x];
      if (!isValid(v)) continue;
      const c = cy * width + Math.min(width - 1, Math.floor((x * width) / W0));
      sum[c] += v;
      count[c]++;
    }
  }
  for (let i = 0; i < sum.length; i++)
    if (count[i]) reduced[k][i] = sum[i] / count[i];
}

// Luminance linéaire moyenne pondérée par l'aire, sur les pixels mesurés dans les trois bandes.
let lum = 0;
let area = 0;
let measured = 0;
for (let y = 0; y < height; y++) {
  const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
  for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const [r, g, b] = [reduced[0][i], reduced[1][i], reduced[2][i]];
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * w;
    area += w;
    measured++;
  }
}
const factor = (albedo * DISPLAY_PER_ALBEDO) / (lum / area);

/** Flou en boîte séparable, passé deux fois, qui ignore les trous (NaN). */
function boxBlur(values, radius) {
  let current = values;
  for (let pass = 0; pass < 2; pass++)
    for (const horizontal of [true, false]) {
      const next = new Float32Array(current.length).fill(NaN);
      for (let a = 0; a < (horizontal ? height : width); a++) {
        const length = horizontal ? width : height;
        const at = (i) =>
          horizontal
            ? a * width + ((i + width) % width)
            : Math.min(height - 1, Math.max(0, i)) * width + a;
        let sum = 0;
        let count = 0;
        for (let i = -radius; i <= radius; i++) {
          const v = current[at(i)];
          if (!Number.isNaN(v)) {
            sum += v;
            count++;
          }
        }
        for (let i = 0; i < length; i++) {
          if (count) next[at(i)] = sum / count;
          const out = current[at(i - radius)];
          if (!Number.isNaN(out)) {
            sum -= out;
            count--;
          }
          const inn = current[at(i + radius + 1)];
          if (!Number.isNaN(inn)) {
            sum += inn;
            count++;
          }
        }
      }
      current = next;
    }
  return current;
}

if (chromaBlur > 0) {
  // Rapports bande / luminance, lissés, puis réappliqués à la luminance non lissée.
  const luminance = new Float32Array(width * height).fill(NaN);
  for (let i = 0; i < luminance.length; i++) {
    const [r, g, b] = [reduced[0][i], reduced[1][i], reduced[2][i]];
    if (!(Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)))
      luminance[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  for (let k = 0; k < 3; k++) {
    const ratio = new Float32Array(width * height).fill(NaN);
    for (let i = 0; i < ratio.length; i++)
      if (luminance[i] > 0) ratio[i] = reduced[k][i] / luminance[i];
    const smooth = boxBlur(ratio, chromaBlur);
    for (let i = 0; i < ratio.length; i++)
      reduced[k][i] = Number.isNaN(luminance[i])
        ? NaN
        : smooth[i] * luminance[i];
  }
}
const toSrgb = (c) => {
  const v = Math.min(1, Math.max(0, c));
  return Math.round(
    255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
  );
};
const rgb = Buffer.alloc(width * height * 3);
let clipped = 0;
for (let i = 0; i < width * height; i++) {
  const r = reduced[0][i];
  const g = reduced[1][i];
  const b = reduced[2][i];
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue; // reste noir : comblé à l'import
  for (const [k, v] of [r, g, b].entries()) {
    if (v * factor > 1) clipped++;
    rgb[i * 3 + k] = Math.max(1, toSrgb(v * factor)); // 0 est réservé aux trous
  }
}
await sharp(rgb, { raw: { width, height, channels: 3 } })
  .png()
  .toFile(out);
console.log(
  `${out} : ${width}×${height}, ${((100 * measured) / (width * height)).toFixed(2)} % mesuré, ` +
    `facteur ${factor.toFixed(3)} (albédo ${albedo} → luminance ${(albedo * DISPLAY_PER_ALBEDO).toFixed(3)}), ` +
    `${((100 * clipped) / (3 * measured)).toFixed(3)} % de valeurs saturées`
);
