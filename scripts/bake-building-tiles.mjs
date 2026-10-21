/* global console, process, fetch, URL, setTimeout, Buffer */
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
 * Trois familles de source, choisies par `source.kind` : `wfs` (BD TOPO), `citygml-zip` (modèle
 * de ville en carreaux ZIP, Berlin LoD2) et `overture-parquet` (Overture Maps, lu par DuckDB dans
 * `scripts/overture-buildings.py`). Toutes rendent la même forme intermédiaire, des objets GeoJSON
 * (emprise extérieure, hauteur, méthode de la hauteur), et partagent tout le reste.
 *
 * Un jeu `unpublished: true` est cuit mais son manifeste reste dans `.cache/unpublished-buildings/` :
 * il n'entre ni dans `public/` ni dans l'index, donc aucune version livrée ne l'annonce (Overture,
 * tant que la relecture de l'ODbL n'est pas faite, docs/private/MICRO_LOT63.md § C.6).
 *
 * Écrit les tuiles dans `.cache/galaxy-data/assets/buildings/<id>/<hachage>/<z>/<x>/<y>.bin`
 * (à téléverser sur le service de données, cf. `services/galaxy-data/README.md`) et le manifeste
 * dans `public/assets/buildings/<id>/manifest.json`, qui nomme le répertoire haché : téléverser
 * les tuiles AVANT de livrer un manifeste qui les nomme.
 */
import { spawnSync } from 'node:child_process';
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
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPE = join(ROOT, 'scripts', 'building-targets.json');
const RAW_CACHE = join(ROOT, '.cache', 'building-bake');
const TILE_OUT = join(ROOT, '.cache', 'galaxy-data', 'assets', 'buildings');
const MANIFEST_OUT = join(ROOT, 'public', 'assets', 'buildings');
const UNPUBLISHED_OUT = join(ROOT, '.cache', 'unpublished-buildings');

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
const { utmToLonLat } = await loader.ssrLoadModule('/src/core/utm.ts');
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

/** Un fichier de la source, depuis le cache ou le réseau, avec sa date de lecture. */
async function fetchBinary(url, minIntervalMs) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const body = join(RAW_CACHE, `${key}.bin`);
  const stamp = `${body}.at`;
  if (existsSync(body) && existsSync(stamp)) {
    return {
      bytes: readFileSync(body),
      at: readFileSync(stamp, 'utf8').trim(),
    };
  }
  if (OFFLINE) throw new Error(`--offline : fichier absent du cache (${url})`);
  let wait = minIntervalMs;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(wait);
    const res = await fetch(url);
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      // Un témoin : l'hébergeur peut répondre 200 avec une page d'erreur, jamais un ZIP.
      if (bytes.readUInt32LE(0) !== 0x04034b50)
        throw new Error(`réponse qui n'est pas un ZIP (${url})`);
      mkdirSync(RAW_CACHE, { recursive: true });
      const at = new Date().toISOString();
      writeFileSync(body, bytes);
      writeFileSync(stamp, at);
      return { bytes, at };
    }
    if (res.status === 429 || res.status >= 500) {
      wait = Math.min(wait * 2, 30000);
      continue;
    }
    throw new Error(`HTTP ${res.status} pour ${url}`);
  }
  throw new Error(`source muette après six essais (${url})`);
}

/** Les entrées d'un ZIP, lues par son répertoire CENTRAL (les en-têtes locaux peuvent mentir). */
function readZipEntries(zip) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP sans répertoire central');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50)
      throw new Error('répertoire central corrompu');
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(dataStart, dataStart + compressed);
    const data = method === 0 ? raw : inflateRawSync(raw);
    if (data.length !== size)
      throw new Error(
        `entrée « ${name} » : taille lue ${data.length}, déclarée ${size}`
      );
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const attr = (text, name) =>
  text.match(
    new RegExp(`name="${name}">\\s*<gen:value>([^<]*)</gen:value>`)
  )?.[1] ?? null;

/**
 * Les bâtiments d'un carreau CityGML. L'emprise est le contour EXTÉRIEUR du `GroundSurface`
 * (projeté en longitude, latitude), la hauteur le `measuredHeight` (toit moins sol, déclaré par la
 * source), la méthode le code `DatenquelleDachhoehe`. Une construction en parties
 * (`BuildingPart`) porte ses attributs sur chaque partie : chacune est un bâtiment.
 */
function parseCityGmlTile(xml, zone) {
  const features = [];
  let withoutGround = 0;
  for (const member of xml.split('<core:cityObjectMember>').slice(1)) {
    const units = member.split(/<bldg:BuildingPart[ >]/);
    // units[0] est l'entête de l'objet entier : il ne porte une emprise que s'il n'a pas de parties.
    for (const unit of units.length > 1 ? units.slice(1) : units) {
      const ground = unit.match(
        /<bldg:GroundSurface[\s\S]*?<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]*)<\/gml:posList>/
      );
      if (!ground) {
        withoutGround++;
        continue;
      }
      const values = ground[1].trim().split(/\s+/).map(Number);
      const ring = [];
      for (let i = 0; i + 2 < values.length; i += 3)
        ring.push(utmToLonLat(zone, values[i], values[i + 1]));
      const height = unit.match(/<bldg:measuredHeight[^>]*>([^<]*)</)?.[1];
      features.push({
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          hauteur: height === undefined ? null : Number(height),
          methode: attr(unit, 'DatenquelleDachhoehe'),
        },
      });
    }
  }
  return { features, withoutGround };
}

/** L'emprise d'un jeu : déclarée (WFS) ou DÉRIVÉE des carreaux qu'il lit (CityGML), jamais tapée. */
function bboxOf(set) {
  if (set.bboxLonLat) return set.bboxLonLat;
  const { tiles, zone } = set.source;
  const east = tiles.map((t) => t[0]);
  const north = tiles.map((t) => t[1]);
  const corners = [
    [Math.min(...east) * 1000, Math.min(...north) * 1000],
    [(Math.max(...east) + 1) * 1000, Math.min(...north) * 1000],
    [Math.min(...east) * 1000, (Math.max(...north) + 1) * 1000],
    [(Math.max(...east) + 1) * 1000, (Math.max(...north) + 1) * 1000],
  ].map(([e, n]) => utmToLonLat(zone, e, n));
  const r = (v) => Math.round(v * 1e5) / 1e5;
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return [
    r(Math.min(...lons)),
    r(Math.min(...lats)),
    r(Math.max(...lons)),
    r(Math.max(...lats)),
  ];
}

async function readCityGml(set) {
  const { urlTemplate, tiles, zone, minIntervalMs } = set.source;
  const features = [];
  let oldest = null;
  let newest = null;
  let withoutGround = 0;
  for (const [east, north] of tiles) {
    const url = urlTemplate.replace('{east}', east).replace('{north}', north);
    const { bytes, at } = await fetchBinary(url, minIntervalMs);
    if (oldest === null || at < oldest) oldest = at;
    if (newest === null || at > newest) newest = at;
    const entries = readZipEntries(bytes);
    if (entries.length !== 1)
      throw new Error(`${url} : ${entries.length} entrées, une attendue`);
    const parsed = parseCityGmlTile(entries[0].data.toString('utf8'), zone);
    withoutGround += parsed.withoutGround;
    for (const f of parsed.features) features.push(f);
    console.log(
      `  carreau ${east}_${north} : ${parsed.features.length} bâtiments (${parsed.withoutGround} objets sans emprise)`
    );
  }
  return { features, oldest, newest, skippedNoFootprint: withoutGround };
}

/** Les faits que la lecture d'Overture publie au manifeste (facteur par étage mesuré, version). */
const overtureFacts = new Map();

async function readOverture(set) {
  const { release } = set.source;
  const [x0, y0, x1, y1] = set.bboxLonLat;
  const key = createHash('sha1')
    .update(`${release}:${set.bboxLonLat}`)
    .digest('hex')
    .slice(0, 16);
  const file = join(RAW_CACHE, `overture-${key}.json`);
  if (!existsSync(file)) {
    if (OFFLINE)
      throw new Error(`--offline : extrait Overture absent (${file})`);
    mkdirSync(RAW_CACHE, { recursive: true });
    const run = spawnSync(
      'uv',
      [
        'run',
        '--with',
        'duckdb',
        'python',
        join(ROOT, 'scripts', 'overture-buildings.py'),
        '--release',
        release,
        '--bbox',
        `${x0},${y0},${x1},${y1}`,
        '--out',
        file,
      ],
      { stdio: 'inherit' }
    );
    if (run.status !== 0) throw new Error("lecture d'Overture échouée");
  }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(json.features))
    throw new Error('extrait Overture sans « features »');
  console.log(
    `  Overture ${json.release} : ${json.features.length} bâtiments, facteur par étage ${JSON.stringify(json.floorsFactor)}, méthodes ${JSON.stringify(json.counts)}`
  );
  overtureFacts.set(set.id, {
    floorsFactor: json.floorsFactor,
    release: json.release,
  });
  return { features: json.features, oldest: json.readAt, newest: json.readAt };
}

async function readWfs(set) {
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
  return { features, oldest, newest };
}

async function bakeSet(set) {
  const {
    features,
    oldest,
    newest,
    skippedNoFootprint = 0,
  } = set.source.kind === 'citygml-zip'
    ? await readCityGml(set)
    : set.source.kind === 'overture-parquet'
      ? await readOverture(set)
      : await readWfs(set);

  // Rangement : un bâtiment va dans la tuile de son centre (moyenne des sommets de son anneau).
  const tiles = new Map();
  const stats = {
    sourceFeatures: features.length,
    polygons: 0,
    skippedNonPolygon: 0,
    skippedNoFootprint,
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
      typeName: set.source.typeName ?? set.source.dataset,
      ...(overtureFacts.get(set.id) ?? {}),
      license: set.source.license,
      licenseUrl: set.source.licenseUrl,
      attribution: set.source.attribution,
      // Dates de lecture portées par les réponses elles-mêmes (la plus ancienne, la plus récente).
      readFrom: day(oldest),
      readTo: day(newest),
    },
    bboxLonLat: bboxOf(set),
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
    `  origines des hauteurs : ${JSON.stringify(stats.byOrigin)} ; sommets au bord de la marge : ${stats.verticesAtMarginEdge} ; non polygones : ${stats.skippedNonPolygon} ; sans emprise : ${stats.skippedNoFootprint}`
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
  // Un jeu non publié garde son manifeste hors de `public/` : aucune version livrée ne l'annonce.
  const manifestRoot = set.unpublished ? UNPUBLISHED_OUT : MANIFEST_OUT;
  mkdirSync(join(manifestRoot, set.id), { recursive: true });
  writeFileSync(
    join(manifestRoot, set.id, 'manifest.json'),
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
