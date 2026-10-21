/* global console, process, fetch, URL, setTimeout */
/**
 * LE CUISEUR DE TUILES DE BÂTIMENTS (lot 63, étape C.2) : lit une source ouverte, UN jeu par
 * source, et écrit des tuiles `GXBD` que le client décodera. Cibles dans
 * `scripts/building-targets.json`, jamais ici.
 *
 *   node scripts/bake-building-tiles.mjs [--only <id>] [--offline] [--dry-run]
 *
 * Le format, l'encodeur et la géométrie des tuiles vivent dans `src/core/buildingTile.ts` : ce
 * script les charge par `ssrLoadModule`, il n'en recopie rien.
 *
 * Réseau : le WFS de la Géoplateforme répond `x-ratelimit-limit-second: 1` (mesuré le
 * 2026-10-21) alors que la page publique annonce 30 par seconde. On tient la valeur MESURÉE : une
 * requête par `minIntervalMs`, reprise avec attente doublée sur un refus. Chaque réponse est mise
 * en cache sur disque et DATÉE à son arrivée (`.at` à côté), donc `--offline` rejoue exactement
 * les mêmes octets et la date de lecture publiée est celle de la source.
 *
 * Écrit les tuiles dans `.cache/galaxy-data/assets/buildings/<id>/<hachage>/<z>/<x>/<y>.bin`
 * (à téléverser sur le service de données, cf. `services/galaxy-data/README.md`) et le manifeste
 * dans `public/assets/buildings/<id>/manifest.json`, qui nomme le répertoire haché : téléverser
 * les tuiles AVANT de livrer un manifeste qui les nomme.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPE = join(ROOT, 'scripts', 'building-targets.json');
const RAW_CACHE = join(ROOT, '.cache', 'building-bake');
const TILE_OUT = join(ROOT, '.cache', 'galaxy-data', 'assets', 'buildings');
const MANIFEST_OUT = join(ROOT, 'public', 'assets', 'buildings');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const OFFLINE = flag('--offline');
const DRY_RUN = flag('--dry-run');

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const {
  encodeBuildingTile,
  decodeBuildingTile,
  HEIGHT_ORIGIN,
  MAX_HEIGHT_DECIMETRES,
  quantizeToTile,
  tileOfLonLat,
} = await loader.ssrLoadModule('/src/core/buildingTile.ts');
await loader.close();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (at) => new Date(at).toISOString().slice(0, 10);

/** Une page de la source, depuis le cache ou le réseau, avec sa date de lecture. */
async function fetchPage(url, minIntervalMs) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const body = join(RAW_CACHE, `${key}.json`);
  const stamp = `${body}.at`;
  if (existsSync(body) && existsSync(stamp)) {
    return {
      json: JSON.parse(readFileSync(body, 'utf8')),
      at: readFileSync(stamp, 'utf8').trim(),
    };
  }
  if (OFFLINE) throw new Error(`--offline : page absente du cache (${url})`);
  let wait = minIntervalMs;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(wait);
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      // Un témoin : une réponse qui n'est pas une collection de bâtiments n'entre JAMAIS au cache.
      const json = JSON.parse(text);
      if (!Array.isArray(json.features))
        throw new Error(`réponse sans « features » (${url})`);
      mkdirSync(RAW_CACHE, { recursive: true });
      const at = new Date().toISOString();
      writeFileSync(body, text);
      writeFileSync(stamp, at);
      return { json, at };
    }
    if (res.status === 429 || res.status >= 500) {
      wait = Math.min(wait * 2, 30000);
      continue;
    }
    throw new Error(`HTTP ${res.status} pour ${url}`);
  }
  throw new Error(`source muette après six essais (${url})`);
}

function originOf(properties, height) {
  const method = properties[height.methodField];
  const value = properties[height.field];
  const classified = height.originByMethod[method] ?? height.otherMethods;
  if (typeof value !== 'number' || !(value > 0)) return HEIGHT_ORIGIN.absent;
  if (classified === 'absent') return HEIGHT_ORIGIN.absent;
  const origin = HEIGHT_ORIGIN[classified];
  if (origin === undefined)
    throw new Error(`origine inconnue « ${classified} »`);
  return origin;
}

async function bakeSet(set) {
  const [lon0, lat0, lon1, lat1] = set.bboxLonLat;
  const base = new URL(set.source.endpoint);
  const params = {
    service: 'WFS',
    version: '2.0.0',
    typeNames: set.source.typeName,
    request: 'GetFeature',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    // MESURÉ : avec EPSG:4326 le serveur répond à l'ordre longitude, latitude ; l'ordre inverse
    // rend 0 résultat en HTTP 200, sans erreur.
    bbox: `${lon0},${lat0},${lon1},${lat1},EPSG:4326`,
    sortBy: 'cleabs',
  };
  for (const [k, v] of Object.entries(params)) base.searchParams.set(k, v);

  const features = [];
  const seen = new Set();
  let oldest = null;
  let newest = null;
  for (let start = 0; ; start += set.source.pageSize) {
    const url = new URL(base);
    url.searchParams.set('count', String(set.source.pageSize));
    url.searchParams.set('startIndex', String(start));
    const { json, at } = await fetchPage(
      url.toString(),
      set.source.minIntervalMs
    );
    if (oldest === null || at < oldest) oldest = at;
    if (newest === null || at > newest) newest = at;
    for (const f of json.features) {
      const id = f.properties?.cleabs ?? f.id;
      if (seen.has(id)) continue;
      seen.add(id);
      features.push(f);
    }
    if (json.features.length < set.source.pageSize) break;
  }

  // Rangement : un bâtiment va dans la tuile de son centre (moyenne des sommets de son anneau).
  const tiles = new Map();
  const stats = {
    sourceFeatures: features.length,
    polygons: 0,
    skippedNonPolygon: 0,
    verticesAtMarginEdge: 0,
    heightAboveRange: 0,
    byOrigin: {
      absent: 0,
      measured: 0,
      interpolated: 0,
      derivedFromFloors: 0,
      unspecified: 0,
    },
  };
  const originName = Object.fromEntries(
    Object.entries(HEIGHT_ORIGIN).map(([k, v]) => [v, k])
  );
  for (const f of features) {
    const g = f.geometry;
    const polygons =
      g?.type === 'MultiPolygon'
        ? g.coordinates
        : g?.type === 'Polygon'
          ? [g.coordinates]
          : null;
    if (!polygons) {
      stats.skippedNonPolygon++;
      continue;
    }
    const origin = originOf(f.properties ?? {}, set.height);
    const rawHeight = f.properties?.[set.height.field];
    let decimetres =
      origin === HEIGHT_ORIGIN.absent ? 0 : Math.round(rawHeight * 10);
    if (decimetres > MAX_HEIGHT_DECIMETRES) {
      decimetres = MAX_HEIGHT_DECIMETRES;
      stats.heightAboveRange++;
    }
    for (const poly of polygons) {
      const exterior = poly[0].slice(0, -1); // sans le point de fermeture
      if (exterior.length < 3) continue;
      let cx = 0;
      let cy = 0;
      for (const [lon, lat] of exterior) {
        cx += lon;
        cy += lat;
      }
      const tile = tileOfLonLat(
        cx / exterior.length,
        cy / exterior.length,
        set.zoom
      );
      const ring = new Uint16Array(exterior.length * 2);
      exterior.forEach(([lon, lat], i) => {
        const [qx, qy] = quantizeToTile(lon, lat, tile);
        if (qx === 0 || qx === 65535 || qy === 0 || qy === 65535)
          stats.verticesAtMarginEdge++;
        ring[2 * i] = qx;
        ring[2 * i + 1] = qy;
      });
      const key = `${tile.column}/${tile.row}`;
      if (!tiles.has(key)) tiles.set(key, { ...tile, buildings: [] });
      tiles
        .get(key)
        .buildings.push({ ring, heightDecimetres: decimetres, origin });
      stats.polygons++;
      stats.byOrigin[originName[origin]]++;
    }
  }

  // Encodage, puis relecture de CHAQUE tuile par le décodeur de production.
  const encoded = [];
  for (const tile of [...tiles.values()].sort(
    (a, b) => a.column - b.column || a.row - b.row
  )) {
    const bytes = new Uint8Array(encodeBuildingTile(tile));
    const back = decodeBuildingTile(bytes.buffer.slice(0), tile);
    if (back.buildings.length !== tile.buildings.length)
      throw new Error(
        `tuile ${tile.column}/${tile.row} : relecture incohérente`
      );
    encoded.push({ tile, bytes });
  }
  const hash = createHash('sha1');
  for (const { tile, bytes } of encoded) {
    hash.update(`${tile.zoom}/${tile.column}/${tile.row}:`);
    hash.update(bytes);
  }
  const digest = hash.digest('hex').slice(0, 10);

  const manifest = {
    id: set.id,
    title: set.title,
    body: set.body,
    format: 'GXBD',
    version: 1,
    zoom: set.zoom,
    directory: `assets/buildings/${set.id}/${digest}`,
    source: {
      name: set.source.name,
      typeName: set.source.typeName,
      license: set.source.license,
      licenseUrl: set.source.licenseUrl,
      attribution: set.source.attribution,
      // Dates de lecture portées par les réponses elles-mêmes (la plus ancienne, la plus récente).
      readFrom: day(oldest),
      readTo: day(newest),
    },
    bboxLonLat: set.bboxLonLat,
    totals: {
      tiles: encoded.length,
      bytes: encoded.reduce((s, e) => s + e.bytes.byteLength, 0),
      ...stats,
    },
    tiles: encoded.map(({ tile, bytes }) => ({
      column: tile.column,
      row: tile.row,
      buildings: tile.buildings.length,
      bytes: bytes.byteLength,
    })),
  };

  console.log(
    `${set.id} : ${stats.sourceFeatures} objets, ${stats.polygons} polygones, ${encoded.length} tuiles, ` +
      `${manifest.totals.bytes} octets (${digest})`
  );
  console.log(
    `  origines des hauteurs : ${JSON.stringify(stats.byOrigin)} ; sommets au bord de la marge : ${stats.verticesAtMarginEdge} ; non polygones : ${stats.skippedNonPolygon}`
  );
  if (DRY_RUN) return;

  const dir = join(TILE_OUT, set.id, digest);
  rmSync(dir, { recursive: true, force: true });
  for (const { tile, bytes } of encoded) {
    const file = join(
      dir,
      String(tile.zoom),
      String(tile.column),
      `${tile.row}.bin`
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  mkdirSync(join(MANIFEST_OUT, set.id), { recursive: true });
  writeFileSync(
    join(MANIFEST_OUT, set.id, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  console.log(`  tuiles : ${dir}`);
}

const recipe = JSON.parse(readFileSync(RECIPE, 'utf8'));
const sets = recipe.sets.filter((s) => !only || s.id === only);
if (!sets.length) throw new Error(`aucun jeu « ${only} » dans la recette`);
for (const set of sets) await bakeSet(set);

// L'index lit les manifestes EN PLACE, dans l'ordre de la recette : c'est l'ordre de priorité
// (le premier jeu qui couvre un lieu gagne, `config/buildingSets.ts`). Il est dérivé, jamais écrit
// à la main, et un jeu sans manifeste n'y figure pas.
if (!DRY_RUN) {
  const entries = [];
  for (const set of recipe.sets) {
    const file = join(MANIFEST_OUT, set.id, 'manifest.json');
    if (!existsSync(file)) continue;
    const m = JSON.parse(readFileSync(file, 'utf8'));
    entries.push({
      id: m.id,
      body: m.body,
      bboxLonLat: m.bboxLonLat,
      manifest: `assets/buildings/${m.id}/manifest.json`,
    });
  }
  writeFileSync(
    join(MANIFEST_OUT, 'index.json'),
    `${JSON.stringify({ sets: entries }, null, 2)}\n`
  );
  console.log(`index : ${entries.length} jeu(x)`);
}
