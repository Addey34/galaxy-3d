/* global Buffer, console, process */
/**
 * Import de textures brutes (V1) → jeux LOD propres dans public/assets/textures/.
 *
 * Lit une source TIF / JPG / PNG (sharp gère le TIFF nativement, pas de conversion
 * en amont), génère les variantes de résolution au nom attendu par l'app
 * (`{body}/{body}_{layer}_{res}.jpg`, ex. `callisto/callisto_surface_2k.jpg`), et n'agrandit
 * jamais au-delà de la largeur réelle de la source (pas de faux détail).
 *
 * Usage :
 *   node scripts/import-textures.mjs            # traite toutes les entrées IMPORTS
 *   node scripts/import-textures.mjs --dry-run  # annonce sans écrire
 *   node scripts/import-textures.mjs --only callisto   # filtre par corps
 *
 * Chaque entrée d'IMPORTS documente aussi source/licence/crédit → à recopier dans
 * src/registry/products/textures/ une fois validée.
 *
 * ⚠️ Après import, aligner `textureResolutions` dans src/config/bodies.ts sur les résos
 *    réellement générées (le LOD ne demande que les paliers déclarés).
 */
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

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
// Racine des sources BRUTES (hors dépôt : ce sont des centaines de Mo de mosaïques publiées).
// `GALAXY_TEXTURE_SOURCES` la déplace — le dossier V1 historique n'existe plus sur cette machine,
// et chaque entrée ci-dessous dit d'où sa source se retélécharge.
const V1 = process.env.GALAXY_TEXTURE_SOURCES
  ? process.env.GALAXY_TEXTURE_SOURCES.replaceAll('\\', '/')
  : 'C:/Users/adria/Documents/Dev/Projets/Treejs/V1';

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
 *  - centerLongitude : 180 quand la source est centrée sur 180° Est (0 au bord gauche), cadrage
 *                 courant des produits OSIRIS-REx et des cartes de Stooke. L'application attend 0 au
 *                 centre (`core/modelUv.ts`) : l'image est alors roulée d'une demi-largeur. Absent =
 *                 0. Toute autre valeur est refusée. Lu dans l'étiquette de la source, jamais deviné.
 *  - license/credit/tier : provenance, affichée en fin d'import et recopiée dans
 *                 sa fiche src/registry/products/textures/.
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
  credit: 'Solar System Scope (solarsystemscope.com)',
  illustrative: true,
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
    // Centrée sur 180° Est (étiquette ou mesure du 2026-10-04) : livrée tournée d'un demi-tour
    // jusqu'à cette date. Voir `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
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
    // Centrée sur 180° Est (étiquette ou mesure du 2026-10-04) : livrée tournée d'un demi-tour
    // jusqu'à cette date. Voir `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
    ...USGS,
  },
  {
    body: 'ganymede',
    layer: 'surface',
    src: `${V1}/ganymede/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    // Centrée sur 180° Est (étiquette ou mesure du 2026-10-04) : livrée tournée d'un demi-tour
    // jusqu'à cette date. Voir `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
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
    // Centrée sur 180° Est (étiquette ou mesure du 2026-10-04) : livrée tournée d'un demi-tour
    // jusqu'à cette date. Voir `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
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
    // Mosaïque globale Cassini, 14401 px à l'étiquette PDS3 (et non l'aperçu 1024 px importé
    // jusqu'au lot 16, qui bornait Encelade à un seul palier).
    src: `${V1}/enceladus/Enceladus_Cassini_mosaic_global_110m.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'rhea',
    layer: 'surface',
    // 11520 px à l'étiquette. ⚠ le bouton « Download » de la page USGS pointe sur l'ANCIEN
    // produit Voyager 833 m ; c'est le `^IMAGE` de l'étiquette PDS3 qui nomme celui-ci.
    src: `${V1}/rhea/Rhea_Cassini_Voyager_mosaic_global_417m.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'dione',
    layer: 'surface',
    src: `${V1}/dione/Dione_Cassini_Voyager_mosaic_global_154m.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'tethys',
    layer: 'surface',
    src: `${V1}/tethys/Tethys_Cassini_mosaic_global_293m.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    ...USGS,
  },
  {
    body: 'ceres',
    layer: 'surface',
    // Vraie imagerie Dawn FC : Cérès était la seule planète naine à porter une surface
    // PROCÉDURALE alors qu'une mosaïque publiée existe. 7383 px à l'étiquette, donc 4k.
    src: `${V1}/ceres/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: true,
    // Centrée sur 180° Est (étiquette ou mesure du 2026-10-04) : livrée tournée d'un demi-tour
    // jusqu'à cette date. Voir `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
    ...USGS,
  },
  {
    body: 'bennu',
    layer: 'surface',
    // Mosaïque globale OSIRIS-REx OCAMS, 31417 px à l'étiquette ISIS, 5 cm/pixel.
    src: `${V1}/bennu/Bennu_global_FB34_FB56_ShapeV28_GndControl_MinnaertPhase30_PAN_8bit.tif`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    // Étiquette ISIS : CenterLongitude = 180.0, PositiveEast, 0 à 360. Importée sans ce
    // décalage au lot 16, la surface était tournée d'un demi-tour sur le modèle OLA.
    centerLongitude: 180,
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

  // --- Corps solides : mosaïques USGS/NASA (domaine public), sources V1 récentes ---
  {
    body: 'titan',
    layer: 'surface',
    src: `${V1}/titan/Titan_ISS_P19658_Mosaic_Global_4km.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: true, // trous documentés aux hautes latitudes nord
    // Centrée sur 180° Est (étiquette ou mesure du 2026-10-04) : livrée tournée d'un demi-tour
    // jusqu'à cette date. Voir `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
    tint: null,
    source:
      'https://astrogeology.usgs.gov/search/map/titan_cassini_iss_global_mosaic_4005m',
    license: 'public-domain',
    credit: 'USGS Astrogeology / NASA-JPL-Caltech / SSI (Cassini ISS)',
    tier: 'free',
  },
  {
    // Mosaïque Cassini ISS de Roatsch et al. (DLR), archivée au PDS dans le jeu
    // CO-S-ISSNA/ISSWA-5-MIDR-V1.0, volume coiss_3006 (version 4, 2017-10-24). Lue telle quelle,
    // étiquette comprise, par `readPds3Image`. Elle est identique, au pixel près (corrélation
    // 1,0000), au `MI_170630_DLR_basemap_degrees.tif` que l'USGS sert en zip.
    // Retéléchargement :
    // https://planetarydata.jpl.nasa.gov/img/data/cassini/cassini_orbiter/coiss_3006/data/images/SM_1M_0_0_SIMP.IMG
    body: 'mimas',
    layer: 'surface',
    src: `${V1}/mimas/SM_1M_0_0_SIMP.IMG`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    tint: null,
    source:
      'https://planetarydata.jpl.nasa.gov/img/data/cassini/cassini_orbiter/coiss_3006/',
    license: 'public-domain',
    credit: 'NASA/JPL/SSI Cassini ISS, mosaïque DLR (Roatsch et al.), NASA PDS',
    tier: 'free',
  },
  {
    // Albédos NEAR MSI de Golish et al. (2023) à 760, 550 et 450 nm, composés en couleur par
    // `scripts/compose-albedo-texture.mjs --albedo 0.25 --chroma-blur 48` (mêmes règles que la
    // couleur que portait le modèle). Membres `data/eros_nearmsi_filter{3,1,2}.tif` du zip
    // https://asc-pds-individual-investigations.s3.us-west-2.amazonaws.com/eros_global-albedo-maps_golish_2023/eros_global-albedo-maps_golish_2023.zip
    // lus un à un par requêtes Range (2,57 Go en tout). Étiquette ISIS : PositiveEast,
    // CenterLongitude = 180.0 ; cadrage vérifié sur le cratère Psyche.
    body: 'eros',
    layer: 'surface',
    src: `${V1}/eros/eros_golish2023_rgb.png`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: true,
    tint: null,
    centerLongitude: 180,
    source: 'https://astrogeology.usgs.gov/search/map/near_msi_albedo_mosaics',
    license: 'public-domain',
    credit: 'NASA/JHU-APL NEAR MSI, USGS (Golish et al. 2023)',
    tier: 'free',
  },
  {
    // Carte d'albédo FABRIQUÉE le 2026-10-05 : aucune n'est publiée comme donnée. Cubes ONC à sept
    // filtres, photométriquement corrigés et recalés (urn:jaxa:darts:hyb2_onc:data_reflectance_
    // coregistered, PSI), reportés par leurs plans de latitude et longitude :
    // `scripts/mosaic-onc-images.mjs --step 0.25` (550 nm), puis `scripts/compose-albedo-texture.mjs`
    // avec le même fichier en trois bandes, `--albedo 0.045` (Sugita et al. 2019) et `--width 1440`.
    // Grille : longitude 0 au bord gauche, Est vers la droite, d'où le recentrage. Teinte : la
    // couleur MOYENNE de 700, 550 et 480 nm (rapports 1,013 / 1 / 0,994) ; ses variations ne se
    // reproduisent pas d'une date à l'autre, celles de l'albédo si (r 0,79 à 0,84).
    body: 'ryugu',
    layer: 'surface',
    src: `${V1}/ryugu/ryugu_onc_albedo.png`,
    resolutions: ['1k'],
    // Lacunes déjà comblées par propagation dans la mosaïque : le flou unique de `fillHoles`
    // laissait noires les calottes polaires jamais vues.
    fillHoles: false,
    tint: [255, 254, 253],
    centerLongitude: 180,
    source: 'https://darts.isas.jaxa.jp/doi/hyb2/hyb2-00200.html',
    license: 'CC BY 4.0',
    credit: 'ISAS/JAXA Hayabusa2 ONC (Sugita et al.), données modifiées',
    tier: 'free',
  },
  {
    // Carte FABRIQUÉE le 2026-10-06 : aucune n'est publiée comme donnée. Vingt images NAC
    // d'OSIRIS (RO-A-OSINAC-4-AST2-LUTETIA-REFLECT-V2.0, PSA) reportées sur le modèle livré à la pose
    // du PCK que l'outil a confirmée à l'aveugle à 1,68° : `pnpm pose:spice map lutetia-flyby
    // --step 0.15`, puis `texture` (transfert de détail : l'albédo des treize images d'approche,
    // phase 0,3 à 18°, multiplié par le relief fin d'une photomosaïque des images de phase 26 à
    // 60°), puis `scripts/compose-albedo-texture.mjs` avec le même fichier en trois bandes,
    // `--albedo 0.19` (Sierks et al. 2011) et `--width 2400`. Grille centrée sur 0, Est vers la
    // droite : aucun recentrage. Surface non vue (65 %) : gris moyen mesuré, déjà comblé.
    body: 'lutetia',
    layer: 'surface',
    src: `${V1}/lutetia/lutetia_osiris_mosaic.png`,
    resolutions: ['1k', '2k'],
    fillHoles: false,
    source:
      'https://archives.esac.esa.int/psa/ftp/INTERNATIONAL-ROSETTA-MISSION/OSINAC/RO-A-OSINAC-4-AST2-LUTETIA-REFLECT-V2.0/',
    license: 'CC BY-NC 3.0 IGO',
    credit: 'ESA/Rosetta OSIRIS (ESA, H. Sierks), données modifiées',
    tier: 'free',
  },
  {
    // Carte FABRIQUÉE le 2026-10-06 : aucune mosaïque de Miranda n'est publiée comme donnée.
    // Douze images NAC de Voyager 2 du 1986-01-24 (onze contribuent), calibrées et corrigées de
    // la distorsion du vidicon par le nœud Ring-Moon du PDS (VGISS_7206, GEOMED), reportées sur
    // la sphère au repère IAU_MIRANDA : `pnpm pose:spice map miranda-voyager --pose truth
    // --step 0.05`, chaque échantillon pesé aussi par l'inverse du carré de son pixel au sol
    // (`weightByResolution`), puis `scripts/compose-albedo-texture.mjs` avec le même fichier en
    // trois bandes, `--albedo 0.32` (NSSDCA) et `--width 7200`. Repère vérifié sur les noms de
    // l'UAI (Arden, Inverness, Elsinore, Verona Rupes). Hémisphère nord jamais éclairé en 1986 :
    // gris moyen mesuré, déjà comblé.
    body: 'miranda',
    layer: 'surface',
    src: `${V1}/miranda/miranda_voyager_map.png`,
    resolutions: ['1k', '2k', '4k'],
    fillHoles: false,
    source:
      'https://pds-rings.seti.org/holdings/volumes/VGISS_7xxx/VGISS_7206/',
    license: 'public-domain',
    credit:
      'NASA/JPL Voyager 2 ISS, PDS Ring-Moon Systems Node, données modifiées',
    tier: 'free',
  },
  {
    // Carte FABRIQUÉE le 2026-10-07, même chaîne que Miranda : six images NAC de Voyager 2 du
    // 1986-01-24 (VGISS_7206, GEOMED), `pnpm pose:spice map ariel-voyager --pose truth --step 0.1`
    // (échelle 128 000 px/rad mesurée au limbe, pointage sur les seuls pixels valides), puis
    // `scripts/compose-albedo-texture.mjs` avec le même fichier en trois bandes, `--albedo 0.39`
    // (NSSDCA), `--width 3600` et `--max-saturated 1.4` : la convention d'affichage demandait une
    // luminance de 1,014, que l'écran ne porte pas (84,6 % saturé). Repère vérifié sur les noms de
    // l'UAI (Melusine, Gwyn, Agape, Mab). Hémisphère nord jamais éclairé en 1986 : gris moyen mesuré.
    body: 'ariel',
    layer: 'surface',
    src: `${V1}/ariel/ariel_voyager_map.png`,
    resolutions: ['1k', '2k'],
    fillHoles: false,
    source:
      'https://pds-rings.seti.org/holdings/volumes/VGISS_7xxx/VGISS_7206/',
    license: 'public-domain',
    credit:
      'NASA/JPL Voyager 2 ISS, PDS Ring-Moon Systems Node, données modifiées',
    tier: 'free',
  },
  {
    // ATLAS FABRIQUÉ le 2026-10-06 : aucune carte de 67P n'est publiée comme donnée, et aucune
    // carte équirectangulaire ne peut la porter (13,5 % de sa surface partage sa direction avec
    // une autre). Vingt-deux images NAC d'OSIRIS d'août 2014 (RO-C-OSINAC-4-PRL-67P-M06-REFLECT-
    // V2.0, PSA) reportées dans l'ATLAS du modèle livré (`scripts/unwrap-shape-model.mjs`), au
    // repère 67P/C-G_CK : `pnpm pose:spice map cg-prelanding --pose truth`, puis `texture`
    // (albédo du 3 août multiplié par le relief fin d'une photomosaïque à phase 25-60°), puis
    // `scripts/compose-albedo-texture.mjs --atlas` avec le même fichier en trois bandes,
    // `--albedo 0.065` (Fornasier et al. 2015) et `--width 2048`. Carrée : le ratio est gardé.
    // Surface non vue (36 %) : gris moyen mesuré, déjà comblé ; la bande du haut est la pastille.
    body: 'churyumov-gerasimenko',
    layer: 'surface',
    src: `${V1}/churyumov-gerasimenko/cg_osiris_atlas.png`,
    resolutions: ['1k', '2k'],
    fillHoles: false,
    source:
      'https://archives.esac.esa.int/psa/ftp/INTERNATIONAL-ROSETTA-MISSION/OSINAC/RO-C-OSINAC-4-PRL-67P-M06-REFLECT-V2.0/',
    license: 'CC BY-NC 3.0 IGO',
    credit: 'ESA/Rosetta OSIRIS (ESA, H. Sierks), données modifiées',
    tier: 'free',
  },
  {
    // Photomosaïque de Stooke (2012) : images AMICA reprojetées sur le modèle de Gaskell
    // (Stooke Small Bodies Maps V2.0, MULTI-SA-MULTI-6-STOOKEMAPS-V2.0, document/25143itokawa/
    // new-itokawa-mosaic.jpg). Domaine public, crédit requis. Grille : 0 aux bords, 180 au centre,
    // longitudes croissantes vers la droite ; recalage sur le modèle livré : pic à 1°, direct.
    body: 'itokawa',
    layer: 'surface',
    src: `${V1}/itokawa/new-itokawa-mosaic.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    tint: null,
    centerLongitude: 180,
    source:
      'https://sbnarchive.psi.edu/pds3/multi_mission/MULTI_SA_MULTI_6_STOOKEMAPS_V2_0/document/aamapdesc.html',
    license: 'public-domain',
    credit:
      'Stooke, P., Stooke Small Bodies Maps V2.0, NASA PDS (JAXA Hayabusa AMICA)',
    tier: 'free',
  },
  {
    // Photomosaïque de Stooke (2000) : images Galileo SSI reprojetées avec le contrôle de position
    // de P. Thomas (Stooke Small Bodies Maps V2.0, document/951gaspra/gabestmo.jpg, 20 px/degré).
    // Domaine public, crédit requis. Grille : longitudes OUEST, 180 aux bords, 0 au centre, donc
    // l'Est vers la droite : le cadrage de l'application, rien à rouler. Recalage par l'OMBRAGE sur
    // la grille de Thomas en longitudes Est : pic à 0°, sans miroir ni pôle retourné (2026-10-05).
    body: 'gaspra',
    layer: 'surface',
    src: `${V1}/gaspra/gabestmo.jpg`,
    // Pas de 4k : la mosaïque fait 7 200 px, mais son 4k ne porte que 0,11 % de variance de plus
    // que le 2k, sous le plancher de `textureLadder.test.ts` (les images Galileo n'ont pas ce détail).
    resolutions: ['2k', '1k'],
    fillHoles: false,
    // COULEUR MOYENNE MESURÉE (2026-10-05) : chrominance des cubes couleur Galileo SSI
    // (galileo.ast-gaspra.color_geom_cubes, PDS) à 671/559/404 nm, séries B, D, E, posée sur la
    // luminance de la mosaïque. Reproduire : scripts/measure-mean-colour.mjs --bands 2,1,0 sur
    // les six cubes (A et F n'ont pas trois bandes, C est écartée : bandes décalées d'un cran).
    tint: [255, 241, 216],
    source:
      'https://sbnarchive.psi.edu/pds3/multi_mission/MULTI_SA_MULTI_6_STOOKEMAPS_V2_0/document/aamapdesc.html',
    license: 'public-domain',
    credit: 'Stooke, P., Stooke Small Bodies Maps V2.0, NASA PDS (Galileo SSI)',
    tier: 'free',
  },
  {
    // Photomosaïque de Stooke et Nyrtsov (2000) : images Galileo SSI reprojetées sur le modèle de
    // Thomas (document/243ida/icylmos2.jpg, 10 px/degré). Même grille que Gaspra. Le modèle de
    // Thomas est en longitudes EST (étiquette 243ida.lbl), repère de Davies et al. 1996 ; recalage
    // par l'ombrage : pic à 0°, sans miroir ni pôle retourné (2026-10-05).
    body: 'ida',
    layer: 'surface',
    src: `${V1}/ida/icylmos2.jpg`,
    resolutions: ['8k', '4k', '2k', '1k'],
    fillHoles: false,
    tint: null,
    source:
      'https://sbnarchive.psi.edu/pds3/multi_mission/MULTI_SA_MULTI_6_STOOKEMAPS_V2_0/document/aamapdesc.html',
    license: 'public-domain',
    credit: 'Stooke, P., Stooke Small Bodies Maps V2.0, NASA PDS (Galileo SSI)',
    tier: 'free',
  },
  {
    body: 'deimos',
    layer: 'surface',
    src: `${V1}/deimos/Mars - Deimos nasa gov.tif`,
    resolutions: ['1k'],
    fillHoles: false,
    tint: null,
    source: 'https://science.nasa.gov/3d-resources/mars-deimos/',
    license: 'public-domain',
    credit: 'NASA (Viking-derived)',
    tier: 'free',
  },

  // --- À traiter / manquants (voir docs/private/TEXTURE_LICENSING_AUDIT.md) ---
  // halley : garder la carte Stooke actuelle (crédit Philip Stooke / NASA PDS requis).
  // pallas, hygiea : aucune texture fidèle n'existe (VLT/SPHERE = forme grise sans texture)
  //   → couleur unie via fallbackColor, pas d'import.
];

/**
 * Comble les pixels ~noirs (zones non imagées) : on part de l'image, on la floute
 * fortement pour propager les couleurs voisines, et on ne substitue QUE là où l'original
 * est quasi noir. Simple, sans faux détail inventé — juste une continuité de teinte.
 */
/**
 * Met au NOIR les pixels entièrement transparents, et à eux seuls.
 *
 * Pourquoi. Un JPEG n'a pas d'alpha : on le jetait (`removeAlpha`). Quand sharp rééchantillonne
 * vraiment, il gère l'alpha en interne et un pixel entièrement transparent ressort noir ; quand
 * la taille demandée ÉGALE celle de la source, il ne rééchantillonne pas, et le RVB « caché »
 * derrière un alpha nul — BLANC dans le PNG de l'anneau de Saturne — ressortait tel quel. Le 8k
 * portait ainsi un bord intérieur blanc opaque (l'anneau lit ce JPEG comme alphaMap), dessiné en
 * haute qualité comme une ellipse lumineuse autour de la planète ; 1k, 2k et 4k étaient justes.
 *
 * Pourquoi pas `flatten` sur le noir : il multiplie aussi la couleur des pixels SEMI-transparents
 * par leur alpha. Mesuré contre l'alpha réel du PNG, la couleur non prémultipliée des niveaux
 * livrés en est plus proche (écart moyen 0,315 contre 0,380), et c'est ce que montrent déjà les
 * qualités moyenne et basse : on reproduit donc ce comportement-là, à toutes les tailles.
 */
async function blackenTransparent(pipeline, width, height) {
  const meta = await pipeline.clone().metadata();
  if (!meta.hasAlpha) return pipeline;
  const { data, info } = await pipeline
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < width * height; i++) {
    const o = i * ch;
    if (data[o + ch - 1] === 0) data[o] = data[o + 1] = data[o + 2] = 0;
  }
  return sharp(data, { raw: { width, height, channels: ch } });
}

/**
 * Roule une image équirectangulaire d'une demi-largeur : une source centrée sur 180° Est devient
 * centrée sur 0, le cadrage de l'application. Sans cela, le drapé d'un modèle de forme tourne la
 * surface d'un demi-tour sur sa forme, sans aucune erreur : c'est ce qu'a porté Bennu du lot 16
 * au 2026-10-04 (étiquette ISIS `CenterLongitude = 180.0`, recalage pente/variance à 179°).
 */
async function rollHalfTurn(pipeline, width, height) {
  const { data, info } = await pipeline
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = Buffer.alloc(data.length);
  const half = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    const row = y * width * ch;
    data.copy(out, row + (width - half) * ch, row, row + half * ch);
    data.copy(out, row, row + half * ch, row + width * ch);
  }
  return sharp(out, { raw: { width, height, channels: ch } });
}

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

/**
 * Lit une image PDS3 à étiquette ATTACHÉE (`.IMG`, comme les mosaïques Cassini ISS du volume
 * `coiss_3006`) et la rend comme entrée brute de sharp. Tout se LIT dans l'étiquette, et tout ce
 * que ce lecteur ne sait pas traiter est REFUSÉ : un octet de 16 bits lu comme 8, ou une carte
 * dont le bord gauche n'est pas l'antiméridien, rendrait une texture plausible et fausse.
 *
 * Le seul cadrage accepté est celui des autres textures : cylindrique simple, centrée sur 0,
 * de -180° à +180° Est de gauche à droite. Une étiquette en longitudes OUEST avec
 * `WESTERNMOST_LONGITUDE = 180` à gauche décrit exactement ce cadrage (Mimas, vérifié le
 * 2026-10-04 sur le cratère Herschel, à sa longitude du gazetteer et non à son miroir).
 */
function readPds3Image(path) {
  const buffer = readFileSync(path);
  const head = buffer.subarray(0, 64 * 1024).toString('latin1');
  const label = head.slice(0, head.search(/^END\s*$/m));
  const value = (key) => {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n<]+)`, 'm').exec(
      label
    );
    if (!match) throw new Error(`${path} : ${key} absent de l'étiquette`);
    return match[1].trim();
  };
  const recordBytes = Number(value('RECORD_BYTES'));
  const imageRecord = Number(value('\\^IMAGE'));
  const width = Number(value('LINE_SAMPLES'));
  const height = Number(value('LINES'));
  const refuse = (why) => {
    throw new Error(`${path} : ${why}, non pris en charge`);
  };
  if (value('SAMPLE_BITS') !== '8')
    refuse(`SAMPLE_BITS ${value('SAMPLE_BITS')}`);
  if (value('MAP_PROJECTION_TYPE') !== 'SIMPLE CYLINDRICAL')
    refuse(`projection ${value('MAP_PROJECTION_TYPE')}`);
  // Le bord GAUCHE est la longitude la plus à l'Ouest dans les deux conventions : 180 en
  // longitudes Ouest, -180 en longitudes Est. Les deux décrivent l'antiméridien.
  const leftEdge = Number(value('WESTERNMOST_LONGITUDE'));
  if (Number(value('CENTER_LONGITUDE')) !== 0 || Math.abs(leftEdge) !== 180)
    refuse(
      `cadrage centré sur ${value('CENTER_LONGITUDE')}, bord gauche ${leftEdge}`
    );
  const offset = (imageRecord - 1) * recordBytes;
  const pixels = buffer.subarray(offset, offset + width * height);
  if (pixels.length !== width * height) refuse('fichier tronqué');
  return { input: pixels, options: { raw: { width, height, channels: 1 } } };
}

/** La source d'une entrée, ouverte par sharp ; une image PDS3 passe par son étiquette. */
function openSource(entry) {
  if (/\.img$/i.test(entry.src)) {
    const { input, options } = readPds3Image(entry.src);
    return sharp(input, { ...options, limitInputPixels: false });
  }
  return sharp(entry.src, { limitInputPixels: false });
}

async function importOne(entry) {
  if (ONLY && entry.body !== ONLY) return;
  if (!existsSync(entry.src)) {
    console.warn(`⚠  Source introuvable : ${entry.src}`);
    return;
  }

  const meta = await openSource(entry).metadata();
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
    let pipe = openSource(entry)
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('srgb');
    // N&B → RGB (+ teinte optionnelle). Les pixels ENTIÈREMENT transparents passent d'abord au
    // noir : cf. `blackenTransparent`.
    pipe = (await blackenTransparent(pipe, width, height)).removeAlpha();
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
    if (entry.centerLongitude === 180) {
      pipe = await rollHalfTurn(pipe, width, height);
    } else if (
      entry.centerLongitude !== undefined &&
      entry.centerLongitude !== 0
    ) {
      throw new Error(
        `${entry.body} : centerLongitude ${entry.centerLongitude} non pris en charge (0 ou 180)`
      );
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
    : '\nImport terminé. Aligne `textureResolutions` (bodies.ts) et recopie la provenance dans sa fiche src/registry/products/textures/.'
);
