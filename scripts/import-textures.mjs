/* global console, process */
/**
 * Import de textures brutes (V1) → jeux LOD propres dans public/assets/textures/.
 *
 * Lit une source TIF / JPG / PNG (sharp gère le TIFF nativement, pas de conversion
 * en amont), génère les variantes de résolution au nom attendu par l'app
 * (`{body}/{body}{Layer}_{res}.jpg`, ex. `callisto/callistoSurface_2k.jpg`), et n'agrandit
 * jamais au-delà de la largeur réelle de la source (pas de faux détail).
 *
 * Usage :
 *   node scripts/import-textures.mjs            # traite toutes les entrées IMPORTS
 *   node scripts/import-textures.mjs --dry-run  # annonce sans écrire
 *   node scripts/import-textures.mjs --only callisto   # filtre par corps
 *
 * Chaque entrée d'IMPORTS documente aussi source/licence/crédit → à recopier dans
 * scripts/texture-sources.json une fois validée.
 *
 * ⚠️ Après import, aligner `textureResolutions` dans src/config/bodies.ts sur les résos
 *    réellement générées (le LOD ne demande que les paliers déclarés).
 */
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp non trouvé. Installe-le avec :  pnpm add -D sharp');
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX_DIR = resolve(ROOT, 'public/assets/textures');
const V1 = 'C:/Users/adria/Documents/Dev/Projets/Treejs/V1';

const DRY_RUN = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const QUALITY_WIDTH = { '1k': 1024, '2k': 2048, '4k': 4096, '8k': 8192 };

/**
 * Nommage FINAL des fichiers : snake_case complet.
 * `{body}/{body}_{layer}_{res}.jpg` — ex. callisto/callisto_surface_2k.jpg,
 * earth/earth_normal_map_8k.jpg. La couche camelCase (normalMap) devient snake (normal_map).
 */
function toSnake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
/** Chemin de base (sans _res.jpg) d'une entrée, dérivé du corps + couche. */
function baseName(body, layer) {
  return `${body}_${toSnake(layer)}`;
}

/**
 * Table d'import. Une entrée par (corps, couche).
 *  - body/layer : destination (`layer` = 'surface' | 'bump' | 'clouds' | 'atmosphere' |
 *                 'lights' | 'spec' | 'normalMap' | 'ring').
 *  - src        : fichier source brut (chemin absolu).
 *  - resolutions: paliers à générer (jamais > largeur source ; les trop grands sont ignorés).
 *  - fillHoles  : true = comble les zones noires (zones non imagées) par extension des bords.
 *  - tint       : [r,g,b] optionnel pour teinter une source N&B (ex. Callisto brun-gris).
 *  - license/credit/tier : provenance, affichée en fin d'import et recopiée dans
 *                 texture-sources.json (bloc `imported`).
 */
// Raccourcis licence.
const USGS = {
  license: 'public-domain',
  credit: 'USGS Astrogeology / NASA',
  tier: 'free',
};
const SSS = {
  license: 'CC BY 4.0',
  credit: 'Solar System Scope (solarsystemscope.com)',
  tier: 'free',
};
const SSS_FICT = {
  ...SSS,
  credit: 'Solar System Scope — illustratif (CC BY 4.0)',
};
const BM = {
  license: 'public-domain',
  credit: 'NASA Visible Earth / Blue Marble',
  tier: 'free',
};

const IMPORTS = [
  // --- Corps solides : mosaïques USGS/NASA (domaine public) ---
  {
    body: 'callisto',
    layer: 'surface',
    src: `${V1}/callisto/callisto_surface_15k.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'charon',
    layer: 'surface',
    src: `${V1}/charon/Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'europa',
    layer: 'surface',
    src: `${V1}/europa/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'ganymede',
    layer: 'surface',
    src: `${V1}/ganymede/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'io',
    layer: 'surface',
    src: `${V1}/io/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'iapetus',
    layer: 'surface',
    src: `${V1}/iapetus/Iapetus_Cassini_Voyager_mosaic_global_783m.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'pluto',
    layer: 'surface',
    src: `${V1}/pluto/Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'triton',
    layer: 'surface',
    src: `${V1}/triton/Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'phobos',
    layer: 'surface',
    src: `${V1}/phobos/Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...USGS,
  },
  {
    body: 'vesta',
    layer: 'surface',
    src: `${V1}/vesta/Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...USGS,
  },
  {
    body: 'enceladus',
    layer: 'surface',
    src: `${V1}/enceladus/enceladus_cassini_mosaic_global_100m_schenk2024_1024.jpg`,
    resolutions: ['1k'],
    fillHoles: false,
    ...USGS,
  },
  {
    body: 'rhea',
    layer: 'surface',
    src: `${V1}/rhea/rhea.jpg`,
    resolutions: ['1k'],
    fillHoles: false,
    ...USGS,
  },

  // --- Planètes / gazeuses / Soleil / étoiles : Solar System Scope (CC BY 4.0) ---
  {
    body: 'mercury',
    layer: 'surface',
    src: `${V1}/mercury/mercury_surface_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'venus',
    layer: 'surface',
    src: `${V1}/venus/venus_surface_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'venus',
    layer: 'atmosphere',
    src: `${V1}/venus/venus_atmosphere_4k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'mars',
    layer: 'surface',
    src: `${V1}/mars/mars_surface_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'jupiter',
    layer: 'surface',
    src: `${V1}/jupiter/jupiter_surface_8k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'saturn',
    layer: 'surface',
    src: `${V1}/saturn/saturn_surface_8k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'saturn',
    layer: 'ring',
    src: `${V1}/saturn/saturn_ring_8k.png`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'uranus',
    layer: 'surface',
    src: `${V1}/uranus/uranus_surface_2k.jpg`,
    resolutions: ['2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'neptune',
    layer: 'surface',
    src: `${V1}/neptune/neptune_surface_2k.jpg`,
    resolutions: ['2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'sun',
    layer: 'surface',
    src: `${V1}/sun/sun_surface_8k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'stars',
    layer: 'surface',
    src: `${V1}/stars/stars_milky_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },
  {
    body: 'moon',
    layer: 'surface',
    src: `${V1}/moon/moon_surface_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...SSS,
  },

  // --- Terre : Blue Marble (domaine public) — multi-couches ---
  {
    body: 'earth',
    layer: 'surface',
    src: `${V1}/earth/earth_surface_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...BM,
  },
  {
    body: 'earth',
    layer: 'clouds',
    src: `${V1}/earth/earth_clouds_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...BM,
  },
  {
    body: 'earth',
    layer: 'lights',
    src: `${V1}/earth/earth_light_8k.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...BM,
  },
  {
    body: 'earth',
    layer: 'normalMap',
    src: `${V1}/earth/earth_normal_8k.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...BM,
  },
  {
    body: 'earth',
    layer: 'spec',
    src: `${V1}/earth/earth_specular_8k.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    ...BM,
  },

  // --- Corps sans image réelle : fictif Solar System Scope (CC BY 4.0, illustratif) ---
  {
    body: 'ceres',
    layer: 'surface',
    src: `${V1}/ceres/ceres_surface_4k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS_FICT,
  },
  {
    body: 'eris',
    layer: 'surface',
    src: `${V1}/eris/eris_surface_4k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS_FICT,
  },
  {
    body: 'haumea',
    layer: 'surface',
    src: `${V1}/haumea/haumea_surface_4k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS_FICT,
  },
  {
    body: 'makemake',
    layer: 'surface',
    src: `${V1}/makemake/makemake_surface_4k.jpg`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    ...SSS_FICT,
  },

  // --- À traiter / manquants (voir docs/private/TEXTURE_LICENSING_AUDIT.md) ---
  // titan  : source cassée (1024×313) → re-sourcer un mosaic Cassini ISS 2:1, ou couleur unie orange.
  // deimos, halley : sources absentes de V1.
  // pallas, hygiea : pas de map → couleur unie (fallbackColor, pas d'import texture).
];

/**
 * Comble les pixels ~noirs (zones non imagées) : on part de l'image, on la floute
 * fortement pour propager les couleurs voisines, et on ne substitue QUE là où l'original
 * est quasi noir. Simple, sans faux détail inventé — juste une continuité de teinte.
 */
async function fillBlackHoles(pipeline, width, height) {
  // RGB pur, sans alpha : ensureAlpha(0) rendrait tout transparent → noir au ré-encodage JPEG.
  const base = await pipeline
    .clone()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = base;
  const ch = info.channels;
  // version très floutée comme "remplissage"
  const blurred = await sharp(data, { raw: { width, height, channels: ch } })
    .blur(Math.max(8, Math.round(width / 128)))
    .raw()
    .toBuffer();
  for (let i = 0; i < width * height; i++) {
    const o = i * ch;
    const lum = (data[o] + data[o + 1] + data[o + 2]) / 3;
    if (lum <= 8) {
      data[o] = blurred[o];
      data[o + 1] = blurred[o + 1];
      data[o + 2] = blurred[o + 2];
    }
  }
  return sharp(data, { raw: { width, height, channels: ch } });
}

async function importOne(entry) {
  if (ONLY && entry.body !== ONLY) return;
  if (!existsSync(entry.src)) {
    console.warn(`⚠  Source introuvable : ${entry.src}`);
    return;
  }

  const meta = await sharp(entry.src, { limitInputPixels: false }).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  const outDir = join(TEX_DIR, entry.body);

  // Un anneau (ou toute source non 2:1) garde son ratio d'origine : on ne downscale que la
  // largeur, la hauteur suit le ratio source. Forcer 2:1 déformerait la bande radiale.
  const isEqui = Math.abs(srcWidth / srcHeight - 2) < 0.05;
  const heightFor = (w) =>
    isEqui ? Math.round(w / 2) : Math.round((w * srcHeight) / srcWidth);

  const base = baseName(entry.body, entry.layer);
  console.log(
    `\n${entry.body}/${base}  (source ${srcWidth}×${srcHeight} ${meta.format}${isEqui ? '' : ' — ratio préservé'})`
  );

  // Cibles réellement générables (pas d'upscale au-delà de la source).
  const targets = entry.resolutions.filter((q) => QUALITY_WIDTH[q] <= srcWidth);
  const dropped = entry.resolutions.filter((q) => QUALITY_WIDTH[q] > srcWidth);
  if (dropped.length) {
    console.log(
      `  (ignoré, > source : ${dropped.join(', ')} — la source ne fait que ${srcWidth}px)`
    );
  }

  for (const q of targets) {
    const width = QUALITY_WIDTH[q];
    const height = heightFor(width);
    const dst = join(outDir, `${base}_${q}.jpg`);
    const label = `${entry.body}/${base}_${q} (${width}×${height})`;

    if (DRY_RUN) {
      console.log(`  · ${label}${entry.fillHoles ? ' +fill' : ''}`);
      continue;
    }

    mkdirSync(outDir, { recursive: true });
    let pipe = sharp(entry.src, { limitInputPixels: false })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('srgb');
    // N&B → RGB (+ teinte optionnelle)
    pipe = pipe.removeAlpha();
    if (entry.tint) {
      pipe = pipe.tint({
        r: entry.tint[0],
        g: entry.tint[1],
        b: entry.tint[2],
      });
    }
    if (entry.fillHoles) {
      pipe = await fillBlackHoles(pipe, width, height);
    }
    process.stdout.write(`  → ${label} … `);
    await pipe.jpeg({ quality: 88, progressive: true }).toFile(dst);
    console.log('OK');
  }

  console.log(
    `  provenance : ${entry.license} · ${entry.credit} · tier=${entry.tier}`
  );
}

for (const entry of IMPORTS) {
  await importOne(entry);
}

console.log(
  DRY_RUN
    ? '\nDry-run terminé.'
    : '\nImport terminé. Aligne `textureResolutions` (bodies.ts) et recopie la provenance dans texture-sources.json.'
);
