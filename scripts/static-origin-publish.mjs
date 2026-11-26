/* global console, process, fetch, Buffer, setTimeout, URL */
/**
 * PRÉPARER ET VÉRIFIER LA PUBLICATION DES MODÈLES D'ENGINS SUR L'ORIGINE DES GROS FICHIERS
 * (GAL-OBJECT-IMMERSION-001). Ce script ne PUBLIE jamais : il lit, il compare, il assemble un dossier
 * local, et il écrit la commande que le PROPRIÉTAIRE lance.
 *
 * LE PIÈGE QU'IL ÉCARTE. Le Worker `galaxy-static` est un Worker de ressources statiques :
 * `wrangler deploy --assets <dossier>` REMPLACE l'ensemble des fichiers servis par le contenu du
 * dossier. Déployer seul `public/assets/models/craft/` retirerait donc les 247 textures et modèles déjà
 * en ligne. Le dossier à déployer est le SURENSEMBLE : `assets/textures` + `assets/models` (craft
 * compris) + `_headers`, et le script prouve, avant, que le Worker sert déjà tout le reste à la bonne
 * taille (donc que ce surensemble ne retire ni ne change rien).
 *
 * Modes :
 *   (défaut)         préflight : lit le Worker, refuse (code 1) si autre chose que les fichiers craft
 *                    manque ou change de taille, ou si un fichier craft n'a pas l'empreinte du registre ;
 *   --stage <dossier> assemble le dossier à déployer (copie locale, rien n'est envoyé) et écrit son
 *                    manifeste (chemin, taille) dans `<dossier>/../<nom>.manifest.json` ;
 *   --verify         APRÈS publication : pour chacun des modèles du registre, HTTP 200, octets, SHA-256 et CORS
 *                    lus sur l'URL réelle, puis le contrôle d'origine complet (`check-asset-origin`) ;
 *   --origin <url>   un autre hôte (essai) ; défaut : VITE_STATIC_ORIGIN, sinon le Worker de production.
 *
 * PUBLICATION ADDITIVE DÉCLARÉE (GAL-CATALOG-EXCELLENCE-001) : `scripts/static-origin-publication.json` liste
 * les fichiers NEUFS attendus (`add`, octets et SHA-256) et les fichiers déjà en ligne qui ne sont plus dans
 * l'arbre de travail (`retain`, remplacés par une ÉDITION dans le catalogue), relus octet pour octet au commit
 * de retour arrière (`git show <commit>:public/<chemin>`). Le préflight exige : les existants identiques en
 * ligne (SHA-256), les `retain` identiques en ligne, EXACTEMENT les `add` à ajouter (absents en ligne, ou déjà
 * identiques), et refuse tout autre fichier absent ou différent. L'assemblage écrit les `retain` dans le
 * surensemble : rien de ce qui est servi n'en sort.
 *
 * Sortie : 0 conforme, 1 écart, 2 origine illisible.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const DIRS = ['assets/textures', 'assets/models'];
const CRAFT = 'assets/models/craft/';
const DEFAULT_ORIGIN = 'https://galaxy-static.galaxy-3d.workers.dev';
const SITE = 'https://galaxy.adrianguichard.dev';
/** Les en-têtes que le Worker sert aujourd'hui (lus le 2026-11-24, texture, modèle et 404) : le `_headers` du dossier doit les reproduire. */
const HEADERS_FILE = `/*
  Access-Control-Allow-Origin: *
  Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges
  Cache-Control: public, max-age=3600, must-revalidate
`;
const WRANGLER = 'wrangler@4.152.0';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const origin = (
  value('--origin') ??
  process.env.VITE_STATIC_ORIGIN ??
  DEFAULT_ORIGIN
)
  .trim()
  .replace(/\/+$/, '');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Les fichiers que la build copie vers le Worker : chemin relatif (barres obliques) -> taille. */
function localInventory() {
  const map = new Map();
  for (const dir of DIRS)
    for (const file of walk(join(PUBLIC, dir)))
      map.set(relative(PUBLIC, file).split(sep).join('/'), statSync(file).size);
  return map;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const registry = JSON.parse(
  readFileSync(join(ROOT, 'src/registry/craft/files.json'), 'utf8')
);
/** La publication déclarée : fichiers neufs attendus et fichiers gardés en ligne (cf. en-tête). */
const publication = JSON.parse(
  readFileSync(join(ROOT, 'scripts/static-origin-publication.json'), 'utf8')
);
const ADDED = new Map(publication.add.map((f) => [f.path, f]));

/** Les octets d'un fichier gardé, lus au commit de retour arrière ; refusés s'ils ne sont pas ceux du manifeste. */
function retainedBytes(f) {
  const out = spawnSync(
    'git',
    ['show', `${publication.rollback.commit}:public/${f.path}`],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
  );
  if (out.status !== 0)
    throw new Error(
      `${f.path} : illisible au commit ${publication.rollback.commit}`
    );
  const bytes = out.stdout;
  if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256)
    throw new Error(`${f.path} : octets du commit différents du manifeste`);
  return bytes;
}

const craftFiles = Object.entries(registry.files).map(([id, f]) => ({
  id,
  path: `${CRAFT}${id}.glb`,
  bytes: f.bytes,
  sha256: f.sha256,
}));

/**
 * Lit le fichier EN ENTIER et rend son état, sa taille et son empreinte. Pas de HEAD : mesuré le
 * 2026-11-24, ce Worker ne renvoie PAS `Content-Length` sur un HEAD, et `check-asset-origin.mjs` tient
 * alors la taille pour égale à celle de la build (il ne voit que la PRÉSENCE). Ici, un octet différent se voit.
 */
async function head(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${origin}/${path}`);
      if (res.status !== 200) {
        await res.arrayBuffer();
        return { status: res.status, size: NaN, sha: '' };
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return { status: 200, size: bytes.length, sha: sha256(bytes) };
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

async function pool(items, worker, size = 12) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

async function preflight() {
  const inventory = localInventory();
  const problems = [];
  // 1. Les fichiers craft du dépôt sont ceux du registre (taille et empreinte).
  for (const f of craftFiles) {
    const file = join(PUBLIC, f.path);
    if (!existsSync(file)) {
      problems.push(`craft absent du dépôt : ${f.path}`);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256)
      problems.push(`craft différent du registre : ${f.path}`);
  }
  // 1 bis. Les fichiers neufs déclarés sont dans le dépôt, à l'octet près ; un gardé n'y est plus.
  for (const f of publication.add) {
    const file = join(PUBLIC, f.path);
    if (!existsSync(file)) problems.push(`neuf absent du dépôt : ${f.path}`);
    else {
      const bytes = readFileSync(file);
      if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256)
        problems.push(`neuf différent du manifeste : ${f.path}`);
    }
  }
  for (const f of publication.retain) {
    if (inventory.has(f.path))
      problems.push(`gardé encore dans l'arbre de travail : ${f.path}`);
    try {
      retainedBytes(f);
    } catch (error) {
      problems.push(String(error.message));
    }
  }
  // 2. Le Worker sert déjà tout le reste, à la même taille.
  const paths = [...inventory.keys()].filter(
    (p) => !p.startsWith(CRAFT) && !ADDED.has(p)
  );
  const seen = await pool(paths, head, 6);
  let unreadable = 0;
  const existing = { same: 0, absent: [], different: [] };
  paths.forEach((path, i) => {
    const r = seen[i];
    if (!r) unreadable++;
    else if (r.status !== 200) existing.absent.push(path);
    else if (
      r.size !== inventory.get(path) ||
      r.sha !== sha256(readFileSync(join(PUBLIC, path)))
    )
      existing.different.push(path);
    else existing.same++;
  });
  if (unreadable) {
    console.error(
      `${unreadable} fichier(s) illisible(s) sur ${origin} : origine injoignable.`
    );
    process.exit(2);
  }
  for (const p of existing.absent)
    problems.push(
      `absent du Worker (serait ajouté par le surensemble, À EXAMINER) : ${p}`
    );
  for (const p of existing.different)
    problems.push(`contenu différent sur le Worker (serait remplacé) : ${p}`);
  // 2 bis. Les gardés sont en ligne, octet pour octet : le surensemble les y laisse.
  const retainSeen = await pool(publication.retain, (f) => head(f.path), 6);
  publication.retain.forEach((f, i) => {
    const r = retainSeen[i];
    if (!r) problems.push(`gardé illisible en ligne : ${f.path}`);
    else if (r.status !== 200)
      problems.push(`gardé absent en ligne : ${f.path}`);
    else if (r.size !== f.bytes || r.sha !== f.sha256)
      problems.push(`gardé différent en ligne : ${f.path}`);
  });
  // 2 ter. Les neufs : EXACTEMENT ceux du manifeste sont à ajouter (absents), ou déjà là, identiques.
  const addSeen = await pool(publication.add, (f) => head(f.path), 6);
  const addPending = [];
  publication.add.forEach((f, i) => {
    const r = addSeen[i];
    if (!r) problems.push(`neuf illisible en ligne : ${f.path}`);
    else if (r.status === 200 && (r.size !== f.bytes || r.sha !== f.sha256))
      problems.push(
        `neuf DÉJÀ en ligne avec un autre contenu (interdit) : ${f.path}`
      );
    else if (r.status !== 200) addPending.push(f);
  });
  // 3. Les fichiers craft ne sont pas encore (ou sont déjà) en ligne : on le dit. PUBLICATION ADDITIVE
  // (GAL-OBJECT-IMMERSION-002) : un fichier craft DÉJÀ en ligne doit y être octet pour octet (même taille, même
  // SHA-256), sinon le surensemble le REMPLACERAIT, ce que ce protocole interdit.
  const craftSeen = await pool(craftFiles, (f) => head(f.path));
  if (craftSeen.some((r) => !r)) {
    console.error(`Origine injoignable pour un fichier craft : ${origin}`);
    process.exit(2);
  }
  const online = craftFiles.filter(
    (f, i) =>
      craftSeen[i]?.status === 200 &&
      craftSeen[i].size === f.bytes &&
      craftSeen[i].sha === f.sha256
  );
  craftFiles.forEach((f, i) => {
    const r = craftSeen[i];
    if (r?.status === 200 && (r.size !== f.bytes || r.sha !== f.sha256))
      problems.push(
        `craft DÉJÀ en ligne avec un autre contenu (serait remplacé, interdit) : ${f.path}`
      );
  });
  const toAdd = craftFiles.filter((f, i) => craftSeen[i]?.status !== 200);
  const bytesTotal = craftFiles.reduce((n, f) => n + f.bytes, 0);
  console.log(`Origine lue : ${origin}`);
  console.log(
    `Surensemble à déployer : ${inventory.size + publication.retain.length} fichiers (${paths.length} existants + ${craftFiles.length} craft + ${publication.add.length} neufs + ${publication.retain.length} gardés au commit de retour arrière ; ${bytesTotal} octets de craft).`
  );
  console.log(
    `Déjà en ligne, octet pour octet (SHA-256) : ${existing.same} sur ${paths.length}. Craft déjà en ligne : ${online.length} sur ${craftFiles.length}.`
  );
  console.log(
    `Craft à AJOUTER (absents du Worker) : ${toAdd.length}${toAdd.length ? ` : ${toAdd.map((f) => `${f.path} (${f.bytes} o)`).join(', ')}` : ''}.`
  );
  console.log(
    `Fichiers neufs déclarés : ${publication.add.length}, à AJOUTER : ${addPending.length}${addPending.length ? ` : ${addPending.map((f) => `${f.path} (${f.bytes} o, ${f.sha256.slice(0, 12)}…)`).join(', ')}` : ''}.`
  );
  console.log(
    `Gardés en ligne (retour arrière ${publication.rollback.commit.slice(0, 8)}) : ${publication.retain.length - problems.filter((p) => p.startsWith('gardé')).length} sur ${publication.retain.length} identiques.`
  );
  if (problems.length) {
    console.error(`${problems.length} écart(s) :\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    'PRÉFLIGHT CONFORME : le surensemble ne retire ni ne modifie aucun fichier en ligne.'
  );
  console.log(
    'Pour assembler le dossier : node scripts/static-origin-publish.mjs --stage <dossier>'
  );
}

function stage(target) {
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    console.error(
      `${dir} n'est pas vide : choisir un dossier neuf (rien n'est supprimé ici).`
    );
    process.exit(1);
  }
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const d of DIRS)
    cpSync(join(PUBLIC, d), join(dir, d), { recursive: true });
  // Les gardés, relus au commit de retour arrière et vérifiés : le surensemble ne retire rien.
  for (const f of publication.retain) {
    const target = join(dir, f.path);
    if (existsSync(target)) {
      console.error(`${f.path} : déjà dans le dossier, refus d'écraser.`);
      process.exit(1);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, retainedBytes(f));
  }
  writeFileSync(join(dir, '_headers'), HEADERS_FILE);
  const manifest = walk(dir)
    .map((f) => ({
      path: relative(dir, f).split(sep).join('/'),
      bytes: statSync(f).size,
      sha256: sha256(readFileSync(f)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifestFile = `${dir}.manifest.json`;
  writeFileSync(
    manifestFile,
    JSON.stringify({ files: manifest.length, manifest }, null, 1)
  );
  const total = manifest.reduce((n, f) => n + f.bytes, 0);
  console.log(
    `Dossier assemblé : ${dir} (${manifest.length} fichiers dont _headers, ${total} octets).`
  );
  console.log(`Manifeste : ${manifestFile}`);
  console.log(
    '\nÀ lancer PAR LE PROPRIÉTAIRE (publie : irréversible côté visiteurs, jamais lancé par ce script) :'
  );
  console.log(
    `  npx ${WRANGLER} deploy --assets "${dir}" --name galaxy-static --compatibility-date 2026-11-24`
  );
  console.log(
    'Essai à blanc, sans rien envoyer (déjà passé le 2026-11-24, « Read 347 files » = fichiers + dossiers) :'
  );
  console.log(
    `  npx ${WRANGLER} deploy --dry-run --assets "${dir}" --name galaxy-static --compatibility-date 2026-11-24`
  );
  console.log('Puis : node scripts/static-origin-publish.mjs --verify');
}

async function verify() {
  const problems = [];
  for (const f of [...craftFiles, ...publication.add, ...publication.retain]) {
    const url = `${origin}/${f.path}`;
    let res;
    try {
      res = await fetch(url, { headers: { Origin: SITE } });
    } catch (error) {
      problems.push(`${f.path} : illisible (${error.message})`);
      continue;
    }
    if (res.status !== 200) {
      problems.push(`${f.path} : HTTP ${res.status}`);
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const cors = res.headers.get('access-control-allow-origin');
    const type = res.headers.get('content-type') ?? '';
    const ok =
      bytes.length === f.bytes &&
      sha256(bytes) === f.sha256 &&
      (cors === '*' || cors === SITE);
    console.log(
      `${ok ? 'ok  ' : 'ÉCART'} ${f.path}  HTTP 200, ${bytes.length} o, sha256 ${sha256(bytes).slice(0, 12)}…, CORS ${cors}, ${type}`
    );
    if (bytes.length !== f.bytes)
      problems.push(`${f.path} : ${bytes.length} octets, ${f.bytes} attendus`);
    else if (sha256(bytes) !== f.sha256)
      problems.push(`${f.path} : SHA-256 différent du registre`);
    if (cors !== '*' && cors !== SITE)
      problems.push(
        `${f.path} : CORS « ${cors} » (le site ne pourrait pas le lire)`
      );
  }
  // Les fichiers DÉJÀ en ligne gardent leurs en-têtes (le `_headers` du dossier reproduit ceux du Worker).
  for (const sample of [
    'assets/textures/earth/earth_surface_1k.jpg',
    'assets/models/phobos/phobos_shape_1k.glb',
  ]) {
    const res = await fetch(`${origin}/${sample}`, {
      headers: { Origin: SITE },
    });
    await res.arrayBuffer();
    const got = {
      status: res.status,
      cors: res.headers.get('access-control-allow-origin'),
      expose: res.headers.get('access-control-expose-headers'),
      cache: res.headers.get('cache-control'),
    };
    const want = {
      status: 200,
      cors: '*',
      expose: 'Content-Range, Content-Length, Accept-Ranges',
      cache: 'public, max-age=3600, must-revalidate',
    };
    for (const key of Object.keys(want))
      if (got[key] !== want[key])
        problems.push(
          `${sample} : en-tête « ${key} » = ${got[key]} (attendu ${want[key]})`
        );
  }
  if (problems.length) {
    console.error(`${problems.length} écart(s) :\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    "\nContrôle d'origine complet (présence et taille de TOUS les gros fichiers) :"
  );
  const check = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/check-asset-origin.mjs')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DIST_DIR: 'public',
        VITE_ASSET_ORIGIN:
          process.env.VITE_ASSET_ORIGIN ??
          'https://galaxy-data.adrianguichard.dev',
        VITE_STATIC_ORIGIN: origin,
      },
    }
  );
  process.exit(check.status ?? 2);
}

const target = value('--stage');
if (flag('--verify')) await verify();
else if (target) stage(target);
else await preflight();
