/* global fetch, Buffer, console, process, URL */
/**
 * Réduit le relief global de Vesta publié par Dawn à une grille latitude / longitude / rayon de
 * 0,5°, lisible par `scripts/decimate-shape-model.mjs`. Rien n'est saisi : chaque nombre vient
 * de l'étiquette PDS3 du produit.
 *
 *   node scripts/fetch-vesta-dtm-grid.mjs [sortie]   (défaut : .cache/shapes/vesta_dawn_05deg.tab)
 *   node scripts/decimate-shape-model.mjs .cache/shapes/vesta_dawn_05deg.tab \
 *     public/assets/models/vesta/vesta_shape_4k.glb --z-up --target 60000   (puis 15000 et 4000)
 *
 * Produit : DAWN-A-FC2-5-VESTADTMSPG-V1.0 (Preusker et al., DLR), VE_HAMO_G_00N_330E_EQU_DTM.IMG.
 * Étiquette lue le 2026-09-22 : 23 040 x 11 521 échantillons MSB 16 bits, rayon = DN x 2 m +
 * 255 000 m, planétocentrique, longitudes positives vers l'Est, bord gauche -210°, 64 px/degré,
 * image au 4e enregistrement de 46 080 octets, valeur manquante -32768 (aucune rencontrée).
 * Système Claudia double prime, le même que la mosaïque USGS dont vient la texture livrée.
 *
 * Une ligne de l'image sur 32 (0,5°) est lue par requête partielle : 16,6 Mo au lieu de 531.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(
  ROOT,
  process.argv[2] ?? '.cache/shapes/vesta_dawn_05deg.tab'
);
const SOURCE = new URL(
  'https://sbnarchive.psi.edu/pds3/dawn/fc/DWNVSPG_2/DATA/VE_HAMO_G_00N_330E_EQU_DTM.IMG'
);
const RECORD = 46080;
const IMAGE_START = 3 * RECORD;
const SAMPLES = 23040;
const PIXELS_PER_DEGREE = 64;
const LINE_OF_EQUATOR = 5760;
const WEST_EDGE_DEG = -210;
const MISSING = -32768;

async function readLine(line) {
  const start = IMAGE_START + line * RECORD;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(SOURCE, {
        headers: { Range: `bytes=${start}-${start + RECORD - 1}` },
      });
      if (response.status === 206) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === RECORD) return buffer;
      }
    } catch (error) {
      console.warn(`ligne ${line}, tentative ${attempt + 1} : ${error}`);
    }
  }
  throw new Error(`ligne ${line} illisible`);
}

const rows = [];
for (let line = 0; line <= 11520; line += 32) {
  const buffer = await readLine(line);
  const lat = (LINE_OF_EQUATOR - line) / PIXELS_PER_DEGREE;
  for (let m = 0; m < 720; m++) {
    const lonEast = m * 0.5;
    // Position fractionnaire de l'échantillon, centres de pixels à (s + 0,5) / 64 du bord gauche.
    const x = ((lonEast - WEST_EDGE_DEG) % 360) * PIXELS_PER_DEGREE - 0.5;
    const s0 = Math.floor(x);
    const f = x - s0;
    const a = buffer.readInt16BE(((s0 + SAMPLES) % SAMPLES) * 2);
    const b = buffer.readInt16BE(((s0 + 1) % SAMPLES) * 2);
    if (a === MISSING || b === MISSING)
      throw new Error(
        `valeur manquante à ${lat}°, ${lonEast}° : à traiter explicitement`
      );
    const radiusKm = (255000 + 2 * (a * (1 - f) + b * f)) / 1000;
    rows.push(`${lat.toFixed(4)} ${lonEast.toFixed(4)} ${radiusKm.toFixed(4)}`);
  }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${rows.join('\n')}\n`);
console.log(`${rows.length} points écrits dans ${OUT}`);
