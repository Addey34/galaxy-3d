#!/usr/bin/env node
/* global console, fetch */
/**
 * IMPORT DU BARÈME DE COULEURS GIBS d'une couche satellite, en donnée locale.
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
 * Le fichier écrit porte sa source, sa version et sa date de lecture ; `gibsLegend.test.ts` le
 * confronte au barème utilisé par la couche.
 */
import { writeFileSync } from 'node:fs';

const LAYER = 'MERRA2_2m_Air_Temperature_Monthly';
const VERSION = 'v1.3';
const OUT = 'src/config/gibsColormap.json';
/** Nombre d'arrêts conservés : assez pour que le dégradé ne perde aucune inflexion visible. */
const STOPS = 24;

const url = `https://gibs.earthdata.nasa.gov/colormaps/${VERSION}/${LAYER}.xml`;
const response = await fetch(url);
if (!response.ok) throw new Error(`HTTP ${response.status} : ${url}`);
const xml = await response.text();

// Le fichier contient DEUX barèmes : « No Data » d'abord, puis le vrai. On prend celui qui
// déclare une unité, et on échoue si la forme change plutôt que d'écrire un dégradé vide.
const block = [
  ...xml.matchAll(/<ColorMap ([^>]*)>([\s\S]*?)<\/ColorMap>/g),
].find((m) => /units="/.test(m[1]));
if (!block) throw new Error('aucun barème avec unité dans le fichier GIBS');
const units = /units="([^"]+)"/.exec(block[1])[1];

const entries = [...block[2].matchAll(/<ColorMapEntry ([^>]*)\/>/g)]
  .map((m) => m[1])
  .filter((attrs) => !/nodata="true"|transparent="true"/.test(attrs))
  .map((attrs) => {
    const rgb = /rgb="(\d+),(\d+),(\d+)"/.exec(attrs);
    const range = /value="\[([^,]+),([^)\]]+)[)\]]"/.exec(attrs);
    if (!rgb || !range) throw new Error(`entrée illisible : ${attrs}`);
    return {
      rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      from: range[1],
      to: range[2],
    };
  });
if (entries.length < 3)
  throw new Error(`barème trop court : ${entries.length}`);

// Bornes FINIES : les deux entrées extrêmes disent « -INF » et « +INF », ce qui est une
// saturation, pas une borne. La première et la dernière valeur numériques font la plage.
const finite = (raw) => (/^[-+]?[\d.]+$/.test(raw) ? Number(raw) : null);
const min = entries.map((e) => finite(e.from)).find((v) => v !== null);
const max = [...entries]
  .reverse()
  .map((e) => finite(e.to))
  .find((v) => v !== null);
if (min === undefined || max === undefined || !(min < max))
  throw new Error(`bornes illisibles : ${min} → ${max}`);

// Sous-échantillonnage régulier, extrémités comprises.
const stops = Array.from({ length: STOPS }, (_, k) => {
  const index = Math.round((k * (entries.length - 1)) / (STOPS - 1));
  return {
    offset: Number((k / (STOPS - 1)).toFixed(4)),
    rgb: entries[index].rgb,
  };
});

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      generatedBy: 'scripts/import-gibs-colormap.mjs',
      layer: LAYER,
      source: url,
      retrieved: new Date().toISOString().slice(0, 10),
      units,
      min,
      max,
      entries: entries.length,
      stops,
    },
    null,
    2
  )}\n`
);
console.log(
  `écrit ${OUT} : ${entries.length} entrées ${units}, ${min} → ${max}, ${STOPS} arrêts`
);
