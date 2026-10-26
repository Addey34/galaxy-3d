/* global console, process */
/** Prépare la sortie Cloudflare Pages sans recopier les ressources servies ailleurs. */
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist');
const target = join(root, 'dist-pages');
const externalDirectories = new Set([
  'assets/kernels',
  'assets/ephemerides',
  'assets/textures',
  'assets/models',
]);
const maxFiles = 20_000;
const maxFileBytes = 25 * 1024 * 1024;

for (const key of ['VITE_ASSET_ORIGIN', 'VITE_STATIC_ORIGIN'])
  if (!process.env[key]?.startsWith('https://'))
    throw new Error(
      `${key} doit désigner une origine HTTPS avant le build Pages.`
    );

if (!existsSync(join(source, 'index.html')))
  throw new Error('Build absent : lancer pnpm build avant prepare-pages.mjs.');
if (resolve(target) !== resolve(root, 'dist-pages'))
  throw new Error('Dossier de sortie inattendu.');

rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter(path) {
    const rel = relative(source, path).split(sep).join('/');
    return !externalDirectories.has(rel);
  },
});

const firebase = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
const security = firebase.hosting.headers.find(
  (block) => block.source === '**'
);
if (!security || security.headers.length === 0)
  throw new Error('En-têtes de sécurité Firebase absents.');
const lines = [
  '/*',
  ...security.headers.map(({ key, value }) => `  ${key}: ${value}`),
  '',
  '/sw.js',
  '  Cache-Control: no-cache, no-store, must-revalidate',
  '  Service-Worker-Allowed: /',
  '',
];
if (lines.some((line) => line.length > 2000))
  throw new Error(
    'Un en-tête dépasse la limite Cloudflare Pages de 2 000 caractères.'
  );
writeFileSync(join(target, '_headers'), lines.join('\n'), 'utf8');

let count = 0;
let bytes = 0;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(path);
      continue;
    }
    const rel = relative(target, path).split(sep).join('/');
    const size = statSync(path).size;
    if (size > maxFileBytes)
      throw new Error(`${rel} dépasse 25 Mio (${size} octets).`);
    count++;
    bytes += size;
  }
}
inspect(target);
if (count > maxFiles)
  throw new Error(
    `${count} fichiers dépassent la limite Pages Free de ${maxFiles}.`
  );
console.log(
  `Cloudflare Pages : ${count} fichiers, ${(bytes / 1024 / 1024).toFixed(1)} Mio dans ${target}`
);
