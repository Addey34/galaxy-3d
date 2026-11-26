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
/** Chemin de base (sans _res.jpg) d'une entrée, dérivé du corps + couche (+ édition, `catalog.texturePath`). */
function baseName(body, layer, edition) {
  return `${body}_${toSnake(layer)}${edition ? `__${edition}` : ''}`;
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
 *  - edition    : version scientifique de la carte, dans le nom du fichier (`{body}_{layer}__{edition}_{res}.jpg`),
 *                 la même que `textureEditions` de la fiche du corps : une carte qui CHANGE de contenu
 *                 prend un nom neuf, l'ancienne reste servie sous le sien (publication additive).
 *  - unobserved : 'latitude-band-mean' pour une carte d'ATMOSPHÈRE dont des latitudes ne sont pas
 *                 observées (calottes au-delà du limbe, bande cachée par les anneaux) : une ligne
 *                 dont plus de 1 % des pixels sont noirs est NON OBSERVÉE, ainsi que
 *                 `unobservedMarginDeg` degrés de part et d'autre (franges colorées du bord de
 *                 coupe). Une calotte prend la couleur MOYENNE mesurée des `unobservedBandDeg`
 *                 degrés observés qui la bordent ; une bande intérieure, le passage linéaire entre
 *                 les moyennes des deux bords. Aucun détail en longitude n'est créé. Calculé à la
 *                 résolution de la source, avant tout redimensionnement.
 *  - partialRows : 'row-mean' (avec `unobserved`, GAL-ATMOSPHERES-001) : une latitude PARTIELLEMENT observée
 *                 garde ses longitudes observées ; les autres (noirs, ou, avec `discordantChannels`, à canaux
 *                 discordants : un canal sous 12 ou sous 30 % du plus fort, les franges où un filtre manque ; à
 *                 réserver aux sources qui en ont, une vraie couleur saturée y passerait pour une frange) et
 *                 `unobservedMarginDeg` degrés de franges
 *                 autour d'elles, en longitude) prennent la couleur moyenne MESURÉE de cette même latitude
 *                 (moyenne zonale, légitime pour une atmosphère en bandes). Une latitude vide, ou observée
 *                 sur moins de 5 % de sa longueur, suit la règle de `unobserved`. Le journal donne la part de
 *                 la SURFACE complétée (pondérée par le cosinus de la latitude). Sans cette option, l'ancien
 *                 traitement (ligne entière) reste celui des éditions déjà publiées, à l'octet près.
 *  - trimInclusiveGrid : la carte échantillonne les degrés ENTIERS bornes comprises (721 × 361 à 2 px par
 *                 degré : 0 et 360 de longitude, -90 et +90 de latitude) ; la dernière colonne (doublon
 *                 de la première) et la dernière ligne sont retirées, d'où 720 × 360 sans rééchantillonnage
 *                 (décalage d'un demi-pixel, 0,25 degré, assumé et écrit dans la fiche).
 *  - flipLongitude : l'Est croît vers la GAUCHE dans la source (README) : chaque ligne est retournée avant
 *                 le cadrage (`centerLongitude`).
 *  - baseTierAtSourceWidth : une source plus étroite que 1024 px donne le palier de base (`1k`, le niveau
 *                 de démarrage, toujours livré) à SA largeur, sans agrandissement ; les paliers au-dessus
 *                 sont refusés comme d'habitude.
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
// Hubble OPAL (Outer Planet Atmospheres Legacy, MAST HLSP, DOI 10.17909/T9G593) : cartes globales
// DATÉES de l'atmosphère, CC BY 4.0, attribution lue dans l'en-tête FITS (`LIC_ATTR`) le 2026-11-26.
const OPAL = {
  license: 'CC BY 4.0',
  credit: 'NASA, ESA, A.A. Simon, M.H. Wong (Hubble OPAL, DOI 10.17909/T9G593)',
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
    // Hubble OPAL, rotation 2025a (2025-12-11, 07:24 à 15:40 UT), composite couleur F631N/F502N/F395N du
    // producteur, 10 px/degré (3600 px : rien au-delà de 2k). Se retélécharge :
    // https://archive.stsci.edu/missions/hlsp/opal/cycle32/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2025a_f395n-f502n-f631n_v1_globalmap.tif
    // Bord gauche = 0° Ouest System III, longitudes Ouest DÉCROISSANTES vers la droite (README) : l'Est
    // croît vers la droite depuis 0, d'où le demi-tour. Remplace le 2026-11-26 la carte de Solar System Scope.
    body: 'jupiter',
    layer: 'surface',
    src: `${V1}/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2025a_f395n-f502n-f631n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    edition: 'opal_2025a',
    unobserved: 'latitude-band-mean',
    unobservedMarginDeg: 3,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2025a (2025-08-29, 05:53 à 23:47 UT, cinq mois après le passage de la Terre
    // dans le plan des anneaux), composite F631N/F502N/F395N du producteur, 5 px/degré (1800 px : 1k
    // seulement). Se retélécharge :
    // https://archive.stsci.edu/missions/hlsp/opal/cycle32/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif
    // Bord gauche = 360° Ouest System III, décroissant vers la droite (README) : même cadrage que Jupiter.
    body: 'saturn',
    layer: 'surface',
    src: `${V1}/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    edition: 'opal_2025a',
    unobserved: 'latitude-band-mean',
    unobservedMarginDeg: 3,
    unobservedBandDeg: 2,
    ...OPAL,
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
    // Mosaïque contrôlée USGS 702 m/pixel (938 nm, 23 048 x 11 524), jeu de données
    // DOI 10.5066/P14FAEKS publié en 2026, « marked with CC0 1.0 Universal » (lu à la source le
    // 2026-10-31). Remplace la mosaïque 4005 m, qui avait des raccords visibles et des lacunes
    // aux latitudes moyennes nord. Étiquette ISIS : CenterLongitude = 180, équirectangulaire.
    // Fichier PNG 8 bits du même jeu (73 Mo), retéléchargement :
    // https://www.sciencebase.gov/catalog/item/68a5107ad4be02198e361c35
    src: `${V1}/titan/titan_controlled_global_702m.png`,
    // 2k et 1k : le 4k ne porte que 0,24 % de variance de plus que le 2k, sous le plancher de
    // 0,25 % de `textureLadder.test.ts` (mesure du 2026-10-31), et la couche de tuiles VIMS de
    // Titan (8192 px) doit rester plus fine que la base (`surfaceTilesets.test.ts`).
    resolutions: ['2k', '1k'],
    fillHoles: true, // 0,2 % de pixels noirs, surtout au pôle sud
    // Centrée sur 180° Est (étiquette ISIS) : livrée tournée d'un demi-tour. Voir
    // `src/config/textureOrientation.test.ts`.
    centerLongitude: 180,
    tint: null,
    source: 'https://www.sciencebase.gov/catalog/item/68a5107ad4be02198e361c35',
    license: 'public-domain',
    credit:
      'USGS Astrogeology Science Center, NASA/JPL-Caltech/SSI (Cassini ISS)',
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
    // Carte FABRIQUÉE le 2026-10-07, même chaîne qu'Ariel : six images NAC de Voyager 2 du
    // 1986-01-24 (VGISS_7206, GEOMED), `pnpm pose:spice map titania-voyager --pose truth
    // --step 0.25`, puis `scripts/compose-albedo-texture.mjs` avec le même fichier en trois bandes,
    // `--albedo 0.27` (NSSDCA) et `--width 1440`. 1k seulement : le pixel le plus fin (3,4 km) ne
    // porte que 1 458 px de circonférence. Repère vérifié sur les noms de l'UAI (Gertrude,
    // Calphurnia, Ursula, Jessica). Hémisphère nord jamais éclairé en 1986 : gris moyen mesuré.
    body: 'titania',
    layer: 'surface',
    src: `${V1}/titania/titania_voyager_map.png`,
    resolutions: ['1k'],
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
  // --- Éditions OPAL datées (GAL-ATMOSPHERES-001), une entrée par observation ---
  {
    // Hubble OPAL, rotation 2015a (2015-01-19, README : bord gauche = 360 degrés Ouest System III, décroissant vers la droite).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle22/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2015a_f395n-f502n-f631n_v1_globalmap.tif
    body: 'jupiter',
    layer: 'surface',
    edition: 'opal_2015a',
    src: `${V1}/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2015a_f395n-f502n-f631n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 3,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2020a (2020-08-24/25, même cadrage ; source à canal alpha (transparent = non observé)).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle27/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2020a_f395n-f502n-f631n_v1_globalmap.tif
    body: 'jupiter',
    layer: 'surface',
    edition: 'opal_2020a',
    src: `${V1}/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2020a_f395n-f502n-f631n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 3,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2018a (2018-06-06, observée de -8 à +90 degrés (anneaux ouverts), même cadrage).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle25/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2018a_f395n-f502n-f631n_v1_globalmap.tif
    body: 'saturn',
    layer: 'surface',
    edition: 'opal_2018a',
    src: `${V1}/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2018a_f395n-f502n-f631n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 3,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2022a (2022-09-21/22, bandes partielles au Sud (anneaux), même cadrage).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle29/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2022a_f395n-f502n-f631n_v1_globalmap.tif
    body: 'saturn',
    layer: 'surface',
    edition: 'opal_2022a',
    src: `${V1}/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2022a_f395n-f502n-f631n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 3,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2015a (2015-09-12, README : bord gauche = 0 degré Est, croissant vers la droite).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle23/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2015a_f467m-f547m-f657n_v1_globalmap.tif
    body: 'uranus',
    layer: 'surface',
    edition: 'opal_2015a',
    src: `${V1}/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2015a_f467m-f547m-f657n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    trimInclusiveGrid: true,
    baseTierAtSourceWidth: true,
    discordantChannels: true,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 5,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2020a (2020-10-08/09, même cadrage).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle28/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2020a_f467m-f547m-f657n_v1_globalmap.tif
    body: 'uranus',
    layer: 'surface',
    edition: 'opal_2020a',
    src: `${V1}/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2020a_f467m-f547m-f657n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    trimInclusiveGrid: true,
    baseTierAtSourceWidth: true,
    discordantChannels: true,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 5,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2026a (2026-10-19, README : bord DROIT = 0 degré Est, croissant vers la GAUCHE (retournée)).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle34/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2026a_f657n-f547m-f467m_v1_globalmap.tif
    body: 'uranus',
    layer: 'surface',
    edition: 'opal_2026a',
    src: `${V1}/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2026a_f657n-f547m-f467m_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    flipLongitude: true,
    trimInclusiveGrid: true,
    baseTierAtSourceWidth: true,
    discordantChannels: true,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 5,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2015a (2015-09-18, README : bord gauche = 180 degrés Ouest, décroissant vers la droite (déjà centrée sur 0)).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle22/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2015a_f467m-f547m-f657n_v1_globalmap.tif
    body: 'neptune',
    layer: 'surface',
    edition: 'opal_2015a',
    src: `${V1}/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2015a_f467m-f547m-f657n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 0,
    trimInclusiveGrid: true,
    baseTierAtSourceWidth: true,
    discordantChannels: true,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 5,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2018a (2018-09, README : bord gauche = 360 degrés Ouest ; pannes de gyroscope, couverture partielle de certains filtres).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle25/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2018a_f467m-f547m-f657n_v1_globalmap.tif
    body: 'neptune',
    layer: 'surface',
    edition: 'opal_2018a',
    src: `${V1}/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2018a_f467m-f547m-f657n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    trimInclusiveGrid: true,
    baseTierAtSourceWidth: true,
    discordantChannels: true,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 5,
    unobservedBandDeg: 2,
    ...OPAL,
  },
  {
    // Hubble OPAL, rotation 2026a (2026-08-31, README : bord gauche = 360 degrés Ouest).
    // https://archive.stsci.edu/missions/hlsp/opal/cycle33/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2026a_f467m-f547m-f657n_v1_globalmap.tif
    body: 'neptune',
    layer: 'surface',
    edition: 'opal_2026a',
    src: `${V1}/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2026a_f467m-f547m-f657n_v1_globalmap.tif`,
    resolutions: ['4k', '2k', '1k'],
    fillHoles: false,
    centerLongitude: 180,
    trimInclusiveGrid: true,
    baseTierAtSourceWidth: true,
    discordantChannels: true,
    unobserved: 'latitude-band-mean',
    partialRows: 'row-mean',
    unobservedMarginDeg: 5,
    unobservedBandDeg: 2,
    ...OPAL,
  },
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

/**
 * Les latitudes non observées d'une carte d'atmosphère (`unobserved: 'latitude-band-mean'`), remplacées
 * par la couleur moyenne MESURÉE des latitudes observées qui les bordent. Rend une entrée brute de sharp.
 */
async function fillUnobservedLatitudes(entry) {
  const { data, info } = await sharp(entry.src, { limitInputPixels: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const rowsPerDeg = H / 180;
  const observed = new Array(H);
  for (let y = 0; y < H; y++) {
    let black = 0;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      if (data[o] + data[o + 1] + data[o + 2] < 6) black++;
    }
    observed[y] = black <= W * 0.01;
  }
  // La marge : les franges du bord de coupe sont des pixels colorés mais faux.
  const margin = Math.round((entry.unobservedMarginDeg ?? 0) * rowsPerDeg);
  const keep = observed.slice();
  for (let y = 0; y < H; y++)
    if (!observed[y])
      for (let d = -margin; d <= margin; d++)
        if (y + d >= 0 && y + d < H) keep[y + d] = false;
  const band = Math.max(
    1,
    Math.round((entry.unobservedBandDeg ?? 2) * rowsPerDeg)
  );
  /** Couleur moyenne des `band` lignes observées à partir de `from`, dans le sens `step`. */
  const bandMean = (from, step) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = from, k = 0; y >= 0 && y < H && k < band; y += step) {
      if (!keep[y]) break;
      k++;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * C;
        sum[0] += data[o];
        sum[1] += data[o + 1];
        sum[2] += data[o + 2];
        n++;
      }
    }
    return n ? sum.map((v) => v / n) : null;
  };
  let replaced = 0;
  for (let y = 0; y < H;) {
    if (keep[y]) {
      y++;
      continue;
    }
    let end = y;
    while (end < H && !keep[end]) end++;
    const above = y > 0 ? bandMean(y - 1, -1) : null;
    const below = end < H ? bandMean(end, 1) : null;
    if (!above && !below)
      throw new Error(`${entry.src} : aucune latitude observée`);
    for (let r = y; r < end; r++) {
      const t = above && below ? (r - y + 1) / (end - y + 1) : 0;
      const colour =
        above && below
          ? above.map((a, i) => a + (below[i] - a) * t)
          : (above ?? below);
      for (let x = 0; x < W; x++) {
        const o = (r * W + x) * C;
        data[o] = Math.round(colour[0]);
        data[o + 1] = Math.round(colour[1]);
        data[o + 2] = Math.round(colour[2]);
      }
      replaced++;
    }
    y = end;
  }
  console.log(
    `  latitudes non observées remplacées : ${replaced} lignes sur ${H} (${((replaced / H) * 100).toFixed(1)} %)`
  );
  return {
    input: data,
    options: { raw: { width: W, height: H, channels: C } },
  };
}

/**
 * Une carte d'atmosphère préparée par la règle complète (`partialRows: 'row-mean'`, cf. en-tête) : grille
 * inclusive retirée, longitude retournée si la source l'exige, latitudes partielles complétées par leur
 * moyenne zonale, latitudes vides par la moyenne des bords. Rend une entrée brute de sharp.
 */
async function prepareAtmosphereMap(entry) {
  const raw = await sharp(entry.src, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let W = raw.info.width;
  let H = raw.info.height;
  const srcW = W;
  if (entry.trimInclusiveGrid) {
    W -= 1;
    H -= 1;
  }
  const C = 3;
  const data = Buffer.alloc(W * H * C);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = entry.flipLongitude ? W - 1 - x : x;
      const i = (y * srcW + sx) * 4;
      const o = (y * W + x) * C;
      // Un pixel transparent est non observé : il compte comme noir.
      const a = raw.data[i + 3];
      data[o] = a ? raw.data[i] : 0;
      data[o + 1] = a ? raw.data[i + 1] : 0;
      data[o + 2] = a ? raw.data[i + 2] : 0;
    }
  // Manquant : noir, OU bandes discordantes au bord de la couverture (franges arc-en-ciel : un filtre
  // n'y a pas observé, un canal tombe presque à zéro). Mesuré sur les cartes OPAL d'Uranus et de
  // Neptune : leurs vraies couleurs gardent un rapport min/max de canal de 0,5 et plus.
  const black = (o) => {
    const lo = Math.min(data[o], data[o + 1], data[o + 2]);
    const hi = Math.max(data[o], data[o + 1], data[o + 2]);
    if (hi < 6) return true;
    // Seulement là où la source a ces franges (`discordantChannels`) : sur Jupiter, la Grande Tache rouge
    // (bleu faible) passerait pour une frange et serait effacée (vu le 2026-11-26 sur l'édition 2015a).
    return entry.discordantChannels === true && (lo < 12 || lo < hi * 0.3);
  };
  const rowsPerDeg = H / 180;
  const marginRows = Math.round((entry.unobservedMarginDeg ?? 0) * rowsPerDeg);
  const marginCols = Math.round(((entry.unobservedMarginDeg ?? 0) * W) / 360);
  // 1. Lignes vides (ou presque) ; marge en latitude autour d'elles.
  const empty = new Array(H).fill(false);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (black((y * W + x) * C)) n++;
    empty[y] = n >= W * 0.95;
  }
  const emptyCore = empty.slice();
  for (let y = 0; y < H; y++)
    if (emptyCore[y])
      for (let d = -marginRows; d <= marginRows; d++)
        if (y + d >= 0 && y + d < H) empty[y + d] = true;
  // 2. Masque des pixels manquants, DILATÉ en latitude ET en longitude (les franges du bord de la
  // couverture sont des pointes verticales : une marge en longitude seule les laissait), puis les lignes
  // partielles complétées par leur moyenne zonale.
  const raw0 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (empty[y] || black((y * W + x) * C)) raw0[y * W + x] = 1;
  const horiz = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (raw0[y * W + x])
        for (let d = -marginCols; d <= marginCols; d++)
          horiz[y * W + ((x + d + W) % W)] = 1;
  const missing = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (horiz[y * W + x])
        for (let d = -marginRows; d <= marginRows; d++)
          if (y + d >= 0 && y + d < H) missing[(y + d) * W + x] = 1;
  const replacedPixel = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    if (empty[y]) continue;
    const sum = [0, 0, 0];
    let n = 0;
    for (let x = 0; x < W; x++)
      if (!missing[y * W + x]) {
        const o = (y * W + x) * C;
        sum[0] += data[o];
        sum[1] += data[o + 1];
        sum[2] += data[o + 2];
        n++;
      }
    if (n === W) continue;
    if (n < W * 0.05) {
      empty[y] = true;
      continue;
    }
    for (let x = 0; x < W; x++)
      if (missing[y * W + x]) {
        const o = (y * W + x) * C;
        data[o] = Math.round(sum[0] / n);
        data[o + 1] = Math.round(sum[1] / n);
        data[o + 2] = Math.round(sum[2] / n);
        replacedPixel[y * W + x] = 1;
      }
  }
  // 3. Lignes vides : moyenne mesurée des bords observés (calotte) ou passage linéaire (bande).
  const band = Math.max(
    1,
    Math.round((entry.unobservedBandDeg ?? 2) * rowsPerDeg)
  );
  const bandMean = (from, step) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = from, k = 0; y >= 0 && y < H && k < band; y += step) {
      if (empty[y]) break;
      k++;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * C;
        sum[0] += data[o];
        sum[1] += data[o + 1];
        sum[2] += data[o + 2];
        n++;
      }
    }
    return n ? sum.map((v) => v / n) : null;
  };
  for (let y = 0; y < H;) {
    if (!empty[y]) {
      y++;
      continue;
    }
    let end = y;
    while (end < H && empty[end]) end++;
    const above = y > 0 ? bandMean(y - 1, -1) : null;
    const below = end < H ? bandMean(end, 1) : null;
    if (!above && !below)
      throw new Error(`${entry.src} : aucune latitude observée`);
    for (let r = y; r < end; r++) {
      const t = above && below ? (r - y + 1) / (end - y + 1) : 0;
      const colour =
        above && below
          ? above.map((a, i) => a + (below[i] - a) * t)
          : (above ?? below);
      for (let x = 0; x < W; x++) {
        const o = (r * W + x) * C;
        data[o] = Math.round(colour[0]);
        data[o + 1] = Math.round(colour[1]);
        data[o + 2] = Math.round(colour[2]);
        replacedPixel[r * W + x] = 1;
      }
    }
    y = end;
  }
  // 4. Part de la SURFACE complétée (aire : cosinus de la latitude du centre de la ligne).
  let area = 0;
  let filled = 0;
  for (let y = 0; y < H; y++) {
    const weight = Math.cos(((90 - (y + 0.5) / rowsPerDeg) * Math.PI) / 180);
    for (let x = 0; x < W; x++) {
      area += weight;
      if (replacedPixel[y * W + x]) filled += weight;
    }
  }
  console.log(
    `  surface complétée : ${((filled / area) * 100).toFixed(1)} % (latitudes partielles par leur moyenne zonale, vides par la moyenne des bords) ; carte ${W}×${H}`
  );
  return {
    input: data,
    options: { raw: { width: W, height: H, channels: C } },
  };
}

const prepared = new Map();

/** La source d'une entrée, ouverte par sharp ; une image PDS3 passe par son étiquette. */
function openSource(entry) {
  if (prepared.has(entry)) {
    const { input, options } = prepared.get(entry);
    return sharp(input, { ...options, limitInputPixels: false });
  }
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

  if (entry.partialRows === 'row-mean' && !prepared.has(entry)) {
    if (entry.unobserved !== 'latitude-band-mean')
      throw new Error(`${entry.body} : partialRows exige unobserved`);
    prepared.set(entry, await prepareAtmosphereMap(entry));
  } else if (entry.unobserved === 'latitude-band-mean' && !prepared.has(entry))
    prepared.set(entry, await fillUnobservedLatitudes(entry));
  else if (entry.unobserved !== undefined && !prepared.has(entry))
    throw new Error(
      `${entry.body} : unobserved ${entry.unobserved} non pris en charge`
    );
  const meta = await openSource(entry).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  const outDir = join(TEX_DIR, entry.body);

  // Un anneau (ou toute source non 2:1) garde son ratio d'origine : on ne downscale que la
  // largeur, la hauteur suit le ratio source. Forcer 2:1 déformerait la bande radiale.
  const isEqui = Math.abs(srcWidth / srcHeight - 2) < 0.05;
  const heightFor = (w) =>
    isEqui ? Math.round(w / 2) : Math.round((w * srcHeight) / srcWidth);

  const base = baseName(entry.body, entry.layer, entry.edition);
  console.log(
    `\n${entry.body}/${base}  (source ${srcWidth}×${srcHeight} ${meta.format}${isEqui ? '' : ' — ratio préservé'})`
  );

  // Cibles réellement générables (pas d'upscale au-delà de la source).
  // Le palier de base à la largeur de la source quand elle est plus étroite (`baseTierAtSourceWidth`).
  const baseAtSource =
    entry.baseTierAtSourceWidth && srcWidth < QUALITY_WIDTH['1k'];
  const widthOf = (q) =>
    baseAtSource && q === '1k' ? srcWidth : QUALITY_WIDTH[q];
  const targets = entry.resolutions.filter((q) => widthOf(q) <= srcWidth);
  const dropped = entry.resolutions.filter((q) => widthOf(q) > srcWidth);
  if (dropped.length) {
    console.log(
      `  (ignoré, > source : ${dropped.join(', ')} — la source ne fait que ${srcWidth}px)`
    );
  }

  for (const q of targets) {
    const width = widthOf(q);
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
