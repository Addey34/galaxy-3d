/* global console, process */
/**
 * UNE CARTE D'ALBÉDO DE RYUGU, fabriquée depuis les images de l'ONC de Hayabusa2 (2026-10-05).
 *
 *   node scripts/mosaic-onc-images.mjs --dir <dossier> --out carte.tif [--step 0.25]
 *
 * Aucune carte d'albédo de Ryugu n'est publiée comme donnée. PSI sert pourtant, dans la collection
 * `urn:jaxa:darts:hyb2_onc:data_reflectance_coregistered`, des cubes à SEPT filtres (390, 480,
 * 550, 589, 700, 860 et 950 nm) étalonnés, photométriquement corrigés et recalés (`*_l2erc.fit`),
 * et pour chacun ses plans géométriques (`*_l2dbpc.fit`, collection `geometry`) : longitude,
 * latitude, incidence, émission par pixel. Chaque pixel se reporte donc directement dans une
 * grille équirectangulaire, sans ajuster de pose. Retéléchargement : les noms de produits sont dans
 * `collection_hyb2_onc_data_reflectance_coregistered.csv`, sous
 * https://sbnarchive.psi.edu/pds4/hayabusa2/hyb2_onc/.
 *
 * Sortie : la réflectance à 550 nm moyennée par cellule (TIFF flottant, NoData = 0), pour
 * `scripts/compose-albedo-texture.mjs`, et la teinte MOYENNE (700, 550, 480 nm) pour le `tint` de
 * l'import. Seule la moyenne de la couleur est publiée : ses variations ne se reproduisent pas d'une
 * date à l'autre (le script le mesure et l'imprime), celles de l'albédo, si.
 *
 * Règles mesurées le 2026-10-05 :
 *  - un pixel ne compte que vu ET éclairé sous moins de 70° et mesuré dans les SEPT bandes ;
 *  - un cube dont une bande est vide est écarté en entier : deux cubes du 2018-06-28 ont leurs
 *    bandes 860 et 950 nm vides et les cinq autres vingt fois trop basses ;
 *  - les longitudes des plans sont Est, dans le repère du modèle de Watanabe livré : résolue par
 *    moindres carrés, la direction de visée de chaque image reproduit les angles d'émission avec
 *    un résidu médian de 9,4° (7,7 à 10,9 sur les 29 images), contre 17 à 18° décalée de 90° ou
 *    180° ou en miroir.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tintFromMeans } from './colour-tint.mjs';
import { writeFloatTiff } from './float-tiff.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = option('--dir');
const out = option('--out');
const STEP = Number(option('--step') ?? 0.25);
if (!dir || !out || !(STEP > 0)) {
  console.error(
    'usage : node scripts/mosaic-onc-images.mjs --dir <dossier> --out carte.tif [--step 0.25]'
  );
  process.exit(1);
}
const MAX_ANGLE = 70;
const SIDE = 1024;
const N = SIDE * SIDE;
// Ordre des plans, lu dans les en-têtes (FILTER01 à FILTER07).
const BAND = { b480: 1, v550: 2, w700: 4 };
const NBANDS = 7;
const NX = Math.round(360 / STEP);
const NY = Math.round(180 / STEP);

/** Plans flottants d'un FITS à HDU primaire vide suivi d'une extension image. */
function planes(path, count) {
  const b = readFileSync(path);
  let o = 0;
  for (let h = 0; h < 2; h++) {
    for (;;) {
      const card = b.toString('latin1', o, o + 80);
      o += 80;
      if (card.startsWith('END')) break;
    }
    o = Math.ceil(o / 2880) * 2880;
  }
  return Array.from({ length: count }, (_, k) => {
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = b.readFloatBE(o + (k * N + i) * 4);
    return a;
  });
}

const cubes = readdirSync(dir)
  .filter((f) => f.endsWith('_l2erc.fit'))
  .sort();
const byDate = new Map();
const total = { sum: new Float64Array(NX * NY), n: new Float64Array(NX * NY) };
const colour = [0, 0, 0];
let colourN = 0;
for (const f of cubes) {
  const cube = planes(join(dir, f), NBANDS);
  if (cube.some((p) => !p.some((v) => v > 0))) {
    console.log(`${f} : une bande vide, cube écarté`);
    continue;
  }
  const [LON, LAT, INC, EMI] = planes(
    join(dir, f.replace('_l2erc', '_l2dbpc')),
    4
  );
  const date = f.split('_')[2];
  if (!byDate.has(date))
    byDate.set(date, {
      sum: new Float64Array(NX * NY),
      n: new Uint32Array(NX * NY),
    });
  const acc = byDate.get(date);
  let used = 0;
  for (let i = 0; i < N; i++) {
    const lat = LAT[i];
    if (!(lat >= -90 && lat <= 90)) continue;
    if (!(
      INC[i] >= 0 &&
      INC[i] < MAX_ANGLE &&
      EMI[i] >= 0 &&
      EMI[i] < MAX_ANGLE
    ))
      continue;
    let ok = true;
    for (let k = 0; k < NBANDS; k++) {
      const v = cube[k][i];
      if (!(v > 0 && v < 1)) ok = false;
    }
    if (!ok) continue;
    const x = Math.floor((((LON[i] % 360) + 360) % 360) / STEP) % NX;
    const y = Math.min(NY - 1, Math.floor((90 - lat) / STEP));
    const k = y * NX + x;
    const v = cube[BAND.v550][i];
    // Poids cos i · cos e : la correction photométrique est la plus sûre près du nadir, et les
    // bords d'image vus en rasant dessinaient des arcs aux hautes latitudes (vu le 2026-10-05).
    const w =
      Math.cos((INC[i] * Math.PI) / 180) * Math.cos((EMI[i] * Math.PI) / 180);
    acc.sum[k] += v;
    acc.n[k]++;
    total.sum[k] += w * v;
    total.n[k] += w;
    colour[0] += cube[BAND.w700][i];
    colour[1] += v;
    colour[2] += cube[BAND.b480][i];
    colourN++;
    used++;
  }
  console.log(`${f} : ${used} pixels`);
}

// La carte : moyenne par cellule ; NoData = 0, que l'import comble (`fillHoles`).
const map = new Float32Array(NX * NY);
let area = 0;
let areaAll = 0;
for (let k = 0; k < NX * NY; k++) {
  const lat = 90 - (Math.floor(k / NX) + 0.5) * STEP;
  const w = Math.cos((lat * Math.PI) / 180);
  areaAll += w;
  if (total.n[k] > 0) {
    map[k] = total.sum[k] / total.n[k];
    area += w;
  }
}
// Comblement LOCAL : aux hautes latitudes une cellule de 0,25° est plus étroite qu'un pixel de
// l'ONC au sol, et le simple report laissait des cellules vides entre deux pixels mesurés. Une
// cellule vide prend la moyenne de ses voisines À DISTANCE AU SOL ÉGALE (une cellule en latitude,
// 1/cos(lat) en longitude, au plus 8), s'il y en a au moins trois. Rien au-delà : une ombre ou un
// pôle jamais vus restent vides, et l'import les comble sans inventer de détail (`fillHoles`).
const filled = map.slice();
let added = 0;
for (let y = 1; y < NY - 1; y++) {
  const lat = 90 - (y + 0.5) * STEP;
  const dx = Math.min(
    8,
    Math.max(1, Math.round(1 / Math.cos((lat * Math.PI) / 180)))
  );
  for (let x = 0; x < NX; x++) {
    if (map[y * NX + x] > 0) continue;
    let s = 0;
    let c = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -dx; i <= dx; i++) {
        const v = map[(y + j) * NX + ((x + i + NX) % NX)];
        if (v > 0) {
          s += v;
          c++;
        }
      }
    if (c >= 3) {
      filled[y * NX + x] = s / c;
      added++;
    }
  }
}
map.set(filled);
console.log(`comblement local : ${added} cellules`);
// Comblement par PROPAGATION de ce qui reste (ombres, calottes polaires jamais vues) : chaque
// passe donne à une cellule vide la moyenne de ses voisines déjà remplies, au même voisinage à
// distance au sol égale, jusqu'à ce qu'il n'en reste aucune. Lisse, sans détail inventé. Le
// `fillHoles` de l'import n'y suffisait pas : un seul flou, qui laissait noires les calottes
// (63 % de pixels sombres sur la rangée la plus au nord, vu sur la vignette le 2026-10-05).
let spread = 0;
for (let pass = 0; pass < 2000; pass++) {
  const next = map.slice();
  let changed = 0;
  for (let y = 0; y < NY; y++) {
    const lat = 90 - (y + 0.5) * STEP;
    const dx = Math.min(
      8,
      Math.max(1, Math.round(1 / Math.cos((lat * Math.PI) / 180)))
    );
    for (let x = 0; x < NX; x++) {
      if (map[y * NX + x] > 0) continue;
      let s = 0;
      let c = 0;
      for (let j = -1; j <= 1; j++) {
        const yy = y + j;
        if (yy < 0 || yy >= NY) continue;
        for (let i = -dx; i <= dx; i++) {
          const v = map[yy * NX + ((x + i + NX) % NX)];
          if (v > 0) {
            s += v;
            c++;
          }
        }
      }
      if (c > 0) {
        next[y * NX + x] = s / c;
        changed++;
      }
    }
  }
  map.set(next);
  spread += changed;
  if (changed === 0) break;
}
console.log(`comblement par propagation : ${spread} cellules`);
writeFloatTiff(out, map, NX, NY);
console.log(
  `\ncarte ${NX} × ${NY} (${STEP}°), ${((100 * area) / areaAll).toFixed(1)} % de la surface mesurée avant comblement local → ${out}`
);
const mean = colour.map((c) => c / colourN);
console.log(
  `couleur moyenne, ${colourN} pixels : rapports au vert ${mean.map((c) => (c / mean[1]).toFixed(3)).join(' / ')} → tint [${tintFromMeans(mean).join(', ')}]`
);

// TÉMOIN : l'albédo se reproduit-il d'une date à l'autre ? Par blocs de 2°, moyennes PONDÉRÉES par
// le nombre de pixels (une moyenne de moyennes de cellules donnait le poids d'une cellule bien
// mesurée à un pixel isolé, et la date du 2018-06-28, deux images seulement, tombait de 0,7 à 0,3),
// au moins MIN_PIXELS de chaque côté ; brut, puis sans la moyenne de chaque bande de latitude (ce
// qu'une correction photométrique imparfaite produirait, la sonde regardant depuis la même latitude).
const MIN_PIXELS = 50;
const BLOCK = Math.max(1, Math.round(2 / STEP));
const BX = Math.ceil(NX / BLOCK);
const BY = Math.ceil(NY / BLOCK);
const stats = (xs) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    m,
    sd: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length),
  };
};
const corr = (a, b) => {
  const A = stats(a);
  const B = stats(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - A.m) * (b[i] - B.m);
  return s / a.length / (A.sd * B.sd);
};
/** Moyenne par bloc (NaN sous MIN_PIXELS), puis, si demandé, divisée par celle de sa rangée. */
function blocks(acc, flatten) {
  const sum = new Float64Array(BX * BY);
  const n = new Float64Array(BX * BY);
  for (let k = 0; k < NX * NY; k++) {
    const b =
      Math.floor(Math.floor(k / NX) / BLOCK) * BX +
      Math.floor((k % NX) / BLOCK);
    sum[b] += acc.sum[k];
    n[b] += acc.n[k];
  }
  const v = Array.from(sum, (s, b) => (n[b] >= MIN_PIXELS ? s / n[b] : NaN));
  if (!flatten) return v;
  for (let y = 0; y < BY; y++) {
    const row = v.slice(y * BX, (y + 1) * BX).filter(Number.isFinite);
    const m = row.length >= 10 ? stats(row).m : NaN;
    for (let x = 0; x < BX; x++) v[y * BX + x] = v[y * BX + x] / m - 1;
  }
  return v;
}
function compare(a, b) {
  const pairs = a
    .map((x, k) => [x, b[k]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return {
    n: pairs.length,
    r: corr(
      pairs.map((p) => p[0]),
      pairs.map((p) => p[1])
    ),
  };
}
const dates = [...byDate.keys()];
console.log(`
témoin, albédo à 550 nm entre dates, blocs de 2° d'au moins ${MIN_PIXELS} pixels :`);
for (let i = 0; i < dates.length; i++)
  for (let j = i + 1; j < dates.length; j++) {
    const A = byDate.get(dates[i]);
    const B = byDate.get(dates[j]);
    const raw = compare(blocks(A, false), blocks(B, false));
    const flat = compare(blocks(A, true), blocks(B, true));
    console.log(
      `  ${dates[i]} / ${dates[j]} : ${raw.n} blocs, r ${raw.r.toFixed(3)} ; sans tendance en latitude r ${flat.r.toFixed(3)}`
    );
  }
