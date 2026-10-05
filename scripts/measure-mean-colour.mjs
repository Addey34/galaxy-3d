/* global console, process */
/**
 * LA COULEUR MOYENNE D'UN CORPS, mesurée sur des cubes couleur étalonnés (2026-10-05).
 *
 *   node scripts/measure-mean-colour.mjs --fits a.fits,b.fits,… --bands 2,1,0
 *
 * `--bands r,v,b` : index, dans chaque cube, des bandes posées en rouge, vert et bleu. Les cubes
 * sont des FITS à un seul HDU (BITPIX −32, gros-boutiste), bandes de réflectance d'abord, puis
 * incidence, émission et phase (`--geometry i,e,p`, par défaut les trois dernières).
 *
 * Écrit pour Gaspra : les cubes Galileo SSI de `galileo.ast-gaspra.color_geom_cubes` (PDS,
 * servis par PSI), six filtres de 404 à 986 nm étalonnés en réflectance, recalés entre eux et
 * accompagnés des angles calculés sur le modèle de Thomas. Ce ne sont PAS des cartes : des
 * images de 150 × 150 pixels vues de la sonde, sans longitude ni latitude, et les noyaux de
 * pointage n'ont jamais été archivés. La couleur VARIABLE demanderait de reconstruire la
 * géométrie de chaque prise de vue ; la couleur MOYENNE, elle, se mesure sans cela.
 *
 * Règles, celles de `compose-albedo-texture.mjs` (Éros) : les trois bandes gardent leurs RAPPORTS
 * mesurés, lus comme du RVB linéaire, puis encodés en sRGB ; seule la CHROMINANCE est publiée,
 * puisque l'import la pose sur la luminance de la photomosaïque (`tint` de sharp). Ne comptent
 * que les pixels éclairés et vus sous moins de 75° (incidence et émission), mesurés dans les
 * trois bandes.
 *
 * UNE SÉRIE DONT LE SPECTRE S'ÉCARTE de la médiane des autres de plus de 10 % est ÉCARTÉE, et le
 * script le dit : la série C de Gaspra porte ses trois premières bandes décalées d'un cran (son
 * « violet » vaut le rouge des séries voisines, son « vert » leur violet), alors que son
 * étiquette annonce le même ordre. Mesuré le 2026-10-05, prise entre B et D sous la même
 * géométrie ; aucune autre explication ne rend ces trois égalités à 1 % près.
 */
import { readFileSync } from 'node:fs';
import { tintFromMeans } from './colour-tint.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = option('--fits')?.split(',');
const bands = option('--bands')?.split(',').map(Number);
if (!files || !bands || bands.length !== 3) {
  console.error(
    'usage : node scripts/measure-mean-colour.mjs --fits a.fits,b.fits --bands r,v,b [--geometry i,e,p]'
  );
  process.exit(1);
}

function readFits(path) {
  const bytes = readFileSync(path);
  const header = {};
  let offset = 0;
  for (;;) {
    const card = bytes.toString('ascii', offset, offset + 80);
    offset += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END') break;
    const value = card.slice(10).split('/')[0].trim();
    if (key) header[key] = value;
  }
  offset = Math.ceil(offset / 2880) * 2880;
  if (header.BITPIX !== '-32')
    throw new Error(`${path} : BITPIX ${header.BITPIX}`);
  const [w, h, d] = ['NAXIS1', 'NAXIS2', 'NAXIS3'].map((k) =>
    Number(header[k])
  );
  const data = new Float32Array(w * h * d);
  for (let i = 0; i < data.length; i++)
    data[i] = bytes.readFloatBE(offset + i * 4);
  return { w, h, d, data };
}

const sets = [];
for (const path of files) {
  const { w, h, d, data } = readFits(path);
  const plane = (k) => data.subarray(k * w * h, (k + 1) * w * h);
  const [gi, ge] = (option('--geometry') ?? `${d - 3},${d - 2},${d - 1}`)
    .split(',')
    .map(Number);
  const incidence = plane(gi);
  const emission = plane(ge);
  const sums = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!(incidence[i] < 75 && emission[i] < 75)) continue;
    const values = bands.map((k) => plane(k)[i]);
    if (!values.every((v) => Number.isFinite(v) && v > 0 && v < 1)) continue;
    values.forEach((v, k) => (sums[k] += v));
    n++;
  }
  if (n === 0) {
    console.log(
      `${path} : aucun pixel mesuré dans les trois bandes, série écartée`
    );
    continue;
  }
  sets.push({ path, n, mean: sums.map((s) => s / n) });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const ratio = (set, k) => set.mean[k] / set.mean[1];
const reference = [0, 2].map((k) => median(sets.map((s) => ratio(s, k))));
const kept = sets.filter((set) => {
  const off = [0, 2].map((k, j) => Math.abs(ratio(set, k) / reference[j] - 1));
  const ok = off.every((x) => x <= 0.1);
  console.log(
    `${set.path} : ${set.n} pixels, rouge/vert ${ratio(set, 0).toFixed(3)}, bleu/vert ${ratio(set, 2).toFixed(3)}${ok ? '' : ' : ÉCARTÉE (spectre à plus de 10 % de la médiane des séries)'}`
  );
  return ok;
});
if (kept.length === 0) throw new Error('aucune série retenue');
const total = kept.reduce((s, set) => s + set.n, 0);
const mean = [0, 1, 2].map(
  (k) => kept.reduce((s, set) => s + set.mean[k] * set.n, 0) / total
);
const tint = tintFromMeans(mean);
console.log(
  `\n${kept.length} séries, ${total} pixels : réflectances ${mean.map((c) => c.toFixed(4)).join(' / ')}`
);
console.log(
  `rapports au vert : ${mean.map((c) => (c / mean[1]).toFixed(3)).join(' / ')}`
);
console.log(`teinte sRGB (chrominance à poser) : [${tint.join(', ')}]`);
