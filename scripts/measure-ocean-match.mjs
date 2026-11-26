#!/usr/bin/env node
/* global Buffer, console, fetch, process, setTimeout */
/**
 * LA COULEUR DE L'OCÉAN DÉGAGÉ D'UNE SOURCE D'IMAGERIE DE LA TERRE (GAL-EARTH-VISUAL-COHERENCE-001).
 *
 *   node scripts/measure-ocean-match.mjs viirs NOAA21 2026-11-20 2026-08-15 ...
 *   node scripts/measure-ocean-match.mjs s2 2025 2024 ...
 *
 * Mesure, pour `oceanMatch.tileSrgb` d'une fiche, la MÊME grandeur que celle de Blue Marble
 * (`src/config/oceanMatch.test.ts`) : médiane par canal des pixels que le masque d'eau de la base
 * (`earth_spec_2k.jpg`, valeur > 250) désigne, entre 60° S et 60° N, sur une image mondiale de
 * 2048 × 1024 (équirectangulaire). Deux différences, dites ici et dans la fiche : les pixels
 * SANS DONNÉE (plus grand octet ≤ 8, entre deux fauchées) sont écartés, et seule l'eau DÉGAGÉE est
 * gardée (pixels autour du pic de l'histogramme, voir `oceanMedian`), parce que la grandeur cherchée
 * est la couleur de l'eau, que Blue Marble (sans nuage) montre partout.
 *
 * Sources lues (lecture seule, services publics déjà utilisés par l'application) :
 *  - VIIRS : WMS de GIBS, une image 2048 × 1024 par jour demandé (couche VIIRS_<sat>_CorrectedReflectance_TrueColor) ;
 *  - Sentinel-2 cloudless : WMTS d'EOX, niveau 2 de la grille WGS84 (8 × 4 tuiles de 256 px = 2048 × 1024).
 * Rien n'est écrit dans le dépôt : la sortie est à recopier, avec sa date, dans la fiche.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const W = 2048;
const H = 1024;
const NO_DATA_MAX = 8;

async function maskPixels() {
  const { data, info } = await sharp(
    readFileSync('public/assets/textures/earth/earth_spec_2k.jpg')
  )
    .removeAlpha()
    .resize(W, H, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error('masque');
  return data;
}

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.startsWith('image/'))
      return Buffer.from(await res.arrayBuffer());
    // GIBS rend parfois une erreur 200 text/html au hasard (GAL-CLOUD-SOURCES-002) : on rejoue.
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`illisible : ${url}`);
}

async function viirsImage(sat, day) {
  const url =
    'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0' +
    `&LAYERS=VIIRS_${sat}_CorrectedReflectance_TrueColor&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180` +
    `&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg&TIME=${day}`;
  return sharp(await get(url))
    .removeAlpha()
    .raw()
    .toBuffer();
}

async function s2Image(edition) {
  const template = JSON.parse(
    readFileSync(
      `src/registry/products/tilesets/earth-eox-s2cloudless-${edition}.json`,
      'utf8'
    )
  ).service.template;
  const tiles = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 8; col++) {
      // Le gabarit est celui de la fiche de l'édition (2016 se publie sous `s2cloudless`, sans année).
      const url = template
        .replace('{TileMatrixSet}', 'WGS84')
        .replace('{TileMatrix}', '2')
        .replace('{TileRow}', String(row))
        .replace('{TileCol}', String(col));
      tiles.push({ input: await get(url), left: col * 256, top: row * 256 });
      await new Promise((r) => setTimeout(r, 150));
    }
  return sharp({
    create: { width: W, height: H, channels: 3, background: '#000' },
  })
    .composite(tiles)
    .removeAlpha()
    .raw()
    .toBuffer();
}

/** Demi-largeur (octets) de la fenêtre gardée autour du pic de l'eau dégagée. */
const PEAK_HALF_WIDTH = 12;

/**
 * La couleur de l'eau DÉGAGÉE : l'eau dégagée forme le pic de l'histogramme du plus grand octet des
 * pixels d'océan (les nuages, le reflet et la glace s'étalent au-dessus). On garde les pixels à
 * ±12 octets de ce pic et on en prend la médiane par canal. Une médiane sous un SEUIL fixe glissait
 * avec le seuil (mesuré : 19, 24 puis 31 en rouge pour des seuils de 50, 60 et 80) ; centrée sur le
 * pic, elle ne dépend pas d'un réglage.
 */
function oceanMedian(image, mask) {
  const histogram = new Array(256).fill(0);
  let water = 0;
  let noData = 0;
  const maxOf = (i) => Math.max(image[i], image[i + 1], image[i + 2]);
  const rows = [Math.floor(H / 6), Math.floor((5 * H) / 6)];
  for (let y = rows[0]; y < rows[1]; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (mask[i] <= 250) continue;
      water++;
      const max = maxOf(i);
      if (max <= NO_DATA_MAX) noData++;
      else histogram[max]++;
    }
  let peak = NO_DATA_MAX + 1;
  for (let v = peak; v < 256; v++) if (histogram[v] > histogram[peak]) peak = v;
  const channels = [[], [], []];
  for (let y = rows[0]; y < rows[1]; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (mask[i] <= 250) continue;
      const max = maxOf(i);
      if (max <= NO_DATA_MAX || Math.abs(max - peak) > PEAK_HALF_WIDTH)
        continue;
      for (let k = 0; k < 3; k++) channels[k].push(image[i + k]);
    }
  const median = channels.map((v) => {
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  return {
    median,
    peak,
    kept: +(channels[0].length / water).toFixed(3),
    noData: +(noData / water).toFixed(3),
  };
}

const [kind, ...args] = process.argv.slice(2);
const mask = await maskPixels();
const results = [];
if (kind === 'viirs') {
  const [sat, ...days] = args;
  for (const day of days)
    results.push({ day, ...oceanMedian(await viirsImage(sat, day), mask) });
} else if (kind === 's2') {
  for (const edition of args)
    results.push({ edition, ...oceanMedian(await s2Image(edition), mask) });
} else {
  console.error('usage : viirs <SAT> <jour…> | s2 <édition…>');
  process.exit(2);
}
for (const r of results) console.log(JSON.stringify(r));
if (results.length > 1) {
  const m = [0, 1, 2].map((k) => {
    const v = results.map((r) => r.median[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  console.log(JSON.stringify({ medianOfMedians: m, n: results.length }));
}
