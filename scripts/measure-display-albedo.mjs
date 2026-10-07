#!/usr/bin/env node
/* global console, process */
/**
 * LA LUMINOSITÉ AFFICHÉE DE CHAQUE SURFACE, DÉRIVÉE DE SON ALBÉDO PUBLIÉ (2026-10-07).
 *
 *   node scripts/measure-display-albedo.mjs           relevé imprimé, rien d'écrit
 *   node scripts/measure-display-albedo.mjs --write   écrit src/config/displayAlbedo.json
 *   node scripts/measure-display-albedo.mjs --check   code 1 si le fichier livré a dérivé
 *
 * Pour chaque corps du catalogue : l'albédo géométrique du RELEVÉ des sources
 * (`src/config/factSources.snapshot.json`, jamais une valeur saisie), la luminance linéaire
 * moyenne MESURÉE de sa plus petite texture de surface livrée, et le gain qui ramène l'une à
 * l'autre. La règle, la constante et la mesure vivent dans `src/core/displayAlbedo.ts`, chargé
 * par Vite comme le fait `compute-mean-motion-scale.mjs` : rien n'est recopié ici.
 *
 * Ordre des sources d'albédo : fiche de satellites du NSSDCA (albédo géométrique VISUEL), fiche
 * de corps du NSSDCA, puis la SBDB du JPL. Un corps dont la source donne DEUX valeurs (Japet,
 * « 0.05 / 0.5 ») ne reçoit aucun gain : aucun nombre unique ne le décrit, et la raison citée est
 * celle de la source.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DISPLAY_PER_ALBEDO as BAKED_PER_ALBEDO } from './display-albedo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/config/displayAlbedo.json');
const write = process.argv.includes('--write');
const check = process.argv.includes('--check');

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const load = (path) => loader.ssrLoadModule(path);
const { CELESTIAL_CONFIG } = await load('/src/config/bodies.ts');
const { allBodies, texturePath } = await load('/src/config/catalog.ts');
const rule = await load('/src/core/displayAlbedo.ts');
await loader.close();

const snapshot = JSON.parse(
  readFileSync(join(ROOT, 'src/config/factSources.snapshot.json'), 'utf8')
);

/** L'albédo publié d'un corps et l'endroit exact du relevé où il est lu. */
function publishedAlbedo(name) {
  const sat = snapshot.nssdcaSatellites?.[name]?.visualGeometricAlbedo;
  if (sat)
    return {
      value: sat.value,
      raw: sat.raw,
      path: `nssdcaSatellites.${name}.visualGeometricAlbedo`,
      url: snapshot.nssdcaSatellites[name].url,
    };
  const body = snapshot.nssdca?.bodies?.[name];
  if (body?.geometricAlbedo !== undefined)
    return {
      value: body.geometricAlbedo,
      raw: String(body.geometricAlbedo),
      path: `nssdca.bodies.${name}.geometricAlbedo`,
      url: body.url,
    };
  const small = snapshot.sbdb?.[name];
  if (small?.albedo)
    return {
      value: small.albedo.value,
      raw: String(small.albedo.value),
      path: `sbdb.${name}.albedo`,
      url: small.url,
    };
  return null;
}

/** La preuve d'une atmosphère, citée, ou `undefined`. */
function atmosphereEvidence(name, config, layers) {
  if (config.atmosphereColor !== undefined || layers.includes('atmosphere'))
    return 'déclarée par le catalogue';
  if (layers.includes('clouds')) return 'nuages déclarés par le catalogue';
  const pressure = snapshot.nssdca?.bodies?.[name]?.surfacePressure;
  if (pressure && pressure.bar >= rule.ATMOSPHERE_MIN_SURFACE_PRESSURE_BAR)
    return `pression de surface « ${pressure.raw} », NSSDCA`;
  const quoted = Object.values(snapshot.articles ?? {}).find(
    (a) => a.atmosphereOf === name
  );
  if (quoted) return `« ${quoted.verifiedQuotes[0]} », ${quoted.url}`;
  return undefined;
}

const ORDER = ['1k', '2k', '4k', '8k'];
const rows = [];
for (const { name, config } of allBodies(CELESTIAL_CONFIG)) {
  const surface = config.textureResolutions?.surface ?? [];
  const level = ORDER.find((r) => surface.includes(r));
  const layers = Object.keys(config.textureResolutions ?? {});
  const candidate = {
    kind: config.kind,
    atmosphereEvidence: atmosphereEvidence(name, config, layers),
    hasSurfaceTexture: level !== undefined,
    ...(config.model?.albedo !== undefined
      ? { bakedAlbedo: config.model.albedo }
      : {}),
  };
  const excluded = rule.displayAlbedoExclusion(candidate);
  if (excluded) {
    rows.push({
      body: name,
      rule: 'excluded',
      exclusion: excluded.kind,
      reason: excluded.reason,
    });
    continue;
  }
  if (!candidate.hasSurfaceTexture) {
    // Couleur cuite à l'albédo du modèle (sa propre référence, `albedoSource`).
    rows.push({
      body: name,
      rule: 'baked',
      albedo: config.model.albedo,
      gain: round(rule.bakedGain(BAKED_PER_ALBEDO)),
    });
    continue;
  }
  const albedo = publishedAlbedo(name);
  if (!albedo) {
    rows.push({
      body: name,
      rule: 'excluded',
      exclusion: 'noAlbedo',
      reason: 'aucun albédo géométrique dans les sources du relevé',
    });
    continue;
  }
  if (albedo.value === null) {
    rows.push({
      body: name,
      rule: 'excluded',
      exclusion: 'twoAlbedos',
      reason: `la source publie deux albédos, « ${albedo.raw} » : aucun nombre unique ne décrit ce corps`,
      source: { path: albedo.path, url: albedo.url },
    });
    continue;
  }
  const file = `public/assets/textures/${texturePath(name, 'surface')}_${level}.jpg`;
  if (!existsSync(join(ROOT, file))) throw new Error(`${file} absent`);
  const { data, info } = await sharp(join(ROOT, file))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mean = rule.meanLinearLuminance(
    data,
    info.width,
    info.height,
    info.channels,
    Boolean(config.model?.atlas)
  );
  rows.push({
    body: name,
    rule: 'texture',
    albedo: albedo.value,
    source: { path: albedo.path, url: albedo.url },
    texture: file,
    textureMeanLuminance: round(mean),
    gain: round(rule.displayGain(albedo.value, mean)),
  });
}

function round(x) {
  return Math.round(x * 1e5) / 1e5;
}

const table = {
  $comment:
    'Écrit par `node scripts/measure-display-albedo.mjs --write`. Ne pas éditer à la main. Règle : `src/core/displayAlbedo.ts`.',
  luminancePerAlbedo: rule.DISPLAY_LUMINANCE_PER_ALBEDO,
  // Ce que l'application lit, SEUL (import nommé : Vite écarte `rows` du bundle). Les corps
  // absents gardent un gain de 1, donc leur luminosité d'avant la règle.
  gains: Object.fromEntries(
    rows.filter((r) => r.gain !== undefined).map((r) => [r.body, r.gain])
  ),
  rows,
};
const text = `${JSON.stringify(table, null, 2)}\n`;

for (const r of rows)
  console.log(
    r.body.padEnd(24),
    r.rule.padEnd(9),
    r.rule === 'texture'
      ? `albédo ${r.albedo}  moyenne ${r.textureMeanLuminance}  gain ${r.gain}`
      : r.rule === 'baked'
        ? `albédo ${r.albedo}  gain ${r.gain}`
        : r.reason
  );

if (check) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (shipped !== text) {
    console.error(
      '\nsrc/config/displayAlbedo.json a DÉRIVÉ : relancer avec --write'
    );
    process.exit(1);
  }
  console.log('\ntable à jour');
} else if (write) {
  writeFileSync(OUT, text);
  console.log(
    `\nécrit : ${rows.length} corps dans src/config/displayAlbedo.json`
  );
}
