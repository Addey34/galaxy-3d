#!/usr/bin/env node
/* global console, fetch */
/**
 * IMPORT DES BARÈMES DE COULEURS GIBS des couches satellite, en donnée locale.
 *
 * Pourquoi. La légende de la couche « température satellite » était un `<img src>` vers
 * `gibs.earthdata.nasa.gov/legends/….svg`, que NOTRE PROPRE CSP bloque (`img-src 'self' data:
 * blob:`) : la légende n'est jamais apparue en production. Le SVG pèse d'ailleurs 324 ko et
 * embarque un `<script>`, ce qu'on ne souhaite pas livrer.
 *
 * GIBS publie le même barème sous forme lisible par une machine
 * (`/colormaps/v1.3/<couche>.xml`) : couleurs RVB et intervalles de valeurs. Ce script en tire
 * un dégradé compact que l'application rend en CSS, comme pour ses propres couches de modèle.
 * Les COULEURS RESTENT CELLES DE LA NASA — rien n'est inventé — et plus aucune image distante
 * n'est demandée.
 *
 *   pnpm gibs:colormap
 *
 * TOUTES les couches qui en ont besoin, et pas la seule première (lot 53, 2026-10-16) : la liste
 * vit dans `GIBS_LEGEND_LAYERS` de `src/core/gibsLegend.ts`, seule propriétaire, lue ici et jamais
 * recopiée. Le fichier écrit est rangé par couche ; chaque barème porte sa source, sa version et
 * sa date de lecture, et `gibsLegend.test.ts` confronte le fichier à cette liste.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION = 'v1.3';
const OUT = 'src/config/gibsColormap.json';
/** Nombre d'arrêts conservés : assez pour que le dégradé ne perde aucune inflexion visible. */
const STOPS = 24;

const declared = /GIBS_LEGEND_LAYERS[^=]*=\s*\[([^\]]*)\]/.exec(
  readFileSync('src/core/gibsLegend.ts', 'utf8')
);
const LAYERS = declared
  ? [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];
if (LAYERS.length === 0)
  throw new Error('GIBS_LEGEND_LAYERS illisible dans src/core/gibsLegend.ts');

// L'adresse d'une palette se LIT dans les capacités de sa couche : son nom n'est pas toujours
// celui de la couche (`GHRSST_L4_MUR_Sea_Surface_Temperature` publie
// `GHRSST_Sea_Surface_Temperature.xml`, mesuré le 2026-10-16 ; la construire rendait un 404).
const CAPABILITIES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml';
const capabilities = await (async () => {
  const res = await fetch(CAPABILITIES);
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${CAPABILITIES}`);
  return res.text();
})();

function colormapUrl(layer) {
  const block = capabilities
    .split('<Layer>')
    .find((l) => l.includes(`<ows:Identifier>${layer}</ows:Identifier>`));
  if (!block) throw new Error(`${layer} : absente des capacités de GIBS`);
  const href = new RegExp(
    `xlink:href=['"]([^'"]+/colormaps/${VERSION}/[^'"]+\\.xml)['"]`
  ).exec(block)?.[1];
  if (!href) throw new Error(`${layer} : aucune palette ${VERSION} déclarée`);
  return href;
}

async function readColormap(layer) {
  const url = colormapUrl(layer);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} : ${url}`);
  const xml = await response.text();

  // Le fichier contient DEUX barèmes : « No Data » d'abord, puis le vrai. On prend celui qui
  // déclare une unité, et on échoue si la forme change plutôt que d'écrire un dégradé vide.
  const block = [
    ...xml.matchAll(/<ColorMap ([^>]*)>([\s\S]*?)<\/ColorMap>/g),
  ].find((m) => /units="/.test(m[1]));
  if (!block) throw new Error(`${layer} : aucun barème avec unité`);
  const units = /units="([^"]+)"/.exec(block[1])[1];

  const entries = [...block[2].matchAll(/<ColorMapEntry ([^>]*)\/>/g)]
    .map((m) => m[1])
    .filter((attrs) => !/nodata="true"|transparent="true"/.test(attrs))
    .map((attrs) => {
      const rgb = /rgb="(\d+),(\d+),(\d+)"/.exec(attrs);
      const range = /value="\[([^,]+),([^)\]]+)[)\]]"/.exec(attrs);
      if (!rgb || !range)
        throw new Error(`${layer} : entrée illisible : ${attrs}`);
      return {
        rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
        from: range[1],
        to: range[2],
      };
    });
  if (entries.length < 3)
    throw new Error(`${layer} : barème trop court : ${entries.length}`);

  // Bornes FINIES : les deux entrées extrêmes disent « -INF » et « +INF », ce qui est une
  // saturation, pas une borne. La première et la dernière valeur numériques font la plage.
  const finite = (raw) => (/^[-+]?[\d.]+$/.test(raw) ? Number(raw) : null);
  const min = entries.map((e) => finite(e.from)).find((v) => v !== null);
  const max = [...entries]
    .reverse()
    .map((e) => finite(e.to))
    .find((v) => v !== null);
  if (min === undefined || max === undefined || !(min < max))
    throw new Error(`${layer} : bornes illisibles : ${min} → ${max}`);

  // Sous-échantillonnage régulier, extrémités comprises.
  const stops = Array.from({ length: STOPS }, (_, k) => {
    const index = Math.round((k * (entries.length - 1)) / (STOPS - 1));
    return {
      offset: Number((k / (STOPS - 1)).toFixed(4)),
      rgb: entries[index].rgb,
    };
  });
  console.log(`${layer} : ${entries.length} entrées ${units}, ${min} → ${max}`);
  return {
    generatedBy: 'scripts/import-gibs-colormap.mjs',
    layer,
    source: url,
    retrieved: new Date().toISOString().slice(0, 10),
    units,
    min,
    max,
    entries: entries.length,
    stops,
  };
}

const out = {};
for (const layer of LAYERS) out[layer] = await readColormap(layer);
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`écrit ${OUT} : ${LAYERS.length} barèmes`);
