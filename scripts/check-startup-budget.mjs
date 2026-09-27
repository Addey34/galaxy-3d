/* global console, process */
/**
 * LE BUDGET DU DÉMARRAGE, FAMILLE « JAVASCRIPT » (lot 17, phase 17F).
 *
 * Pourquoi ici et pas dans `pnpm verify` : cette famille est la seule des quatre qui n'existe
 * qu'APRÈS un build. Les trois autres — la fenêtre d'éphémérides, les textures, les maillages —
 * se comptent sur ce que le dépôt committe, et vivent donc dans
 * `src/config/startupBudget.test.ts`, dans le gate. Ce script est l'étape bloquante d'après
 * `pnpm build`, comme `scripts/fingerprint-generated.mjs`, et pour la même raison : un contrôle
 * qu'il fallait penser à lancer n'est pas un contrôle.
 *
 * CE QU'IL COMPTE, et ce n'est pas « tout `dist/assets/*.js` ». Le démarrage charge :
 *
 *   1. la CLÔTURE DES IMPORTS STATIQUES depuis l'entrée déclarée par `dist/index.html` — ce que
 *      le navigateur doit avoir avant d'exécuter la première ligne ;
 *   2. les morceaux que le démarrage importe DYNAMIQUEMENT, nommés un par un avec leur raison
 *      dans `core/startupBudget.BOOT_DYNAMIC_CHUNKS` (chargeur glTF, chaîne de post-traitement).
 *
 * Tout le reste doit rester dehors, et cinq morceaux le sont délibérément (le résumé de
 * validation Horizons, le moteur de surfaces, le noyau SPK, les deux façades de fiches). Si l'un
 * d'eux entrait un jour dans la clôture statique, il entrerait dans le budget par la même
 * mesure — c'est exactement ce qu'on veut voir arriver au lieu de le subir.
 *
 * La clôture est calculée en lisant les morceaux, pas en croyant un manifeste : elle est ensuite
 * CONFRONTÉE aux `modulepreload` que Vite a écrits dans `index.html`. Si mon analyse des imports
 * dérive de ce que Vite déclare, ce script échoue en le disant, au lieu de rendre un nombre
 * plausible et faux.
 *
 *   node scripts/check-startup-budget.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

// La règle et le plafond viennent du module pur, jamais recopiés ici.
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
  BOOT_DYNAMIC_CHUNKS,
  NON_BOOT_CHUNKS,
  JAVASCRIPT_STARTUP_BUDGET_BYTES,
  judgeFamilies,
} = await loader.ssrLoadModule('/src/core/startupBudget.ts');
await loader.close();

let index;
try {
  index = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch {
  console.error(
    `dist/index.html absent — lancer \`pnpm build\` avant cette garde.`
  );
  process.exit(1);
}

/** Le morceau d'entrée, tel que le document le déclare. */
const entryMatch = /<script[^>]+src="\/assets\/([^"]+\.js)"/.exec(index);
if (!entryMatch) {
  console.error(
    `aucun script d'entrée trouvé dans dist/index.html : l'ancre a changé de forme. ` +
      `Un \`replace\` qui ne correspond plus est un silence, pas un succès.`
  );
  process.exit(1);
}
const entry = entryMatch[1];

/** Ce que Vite a déclaré en `modulepreload` : le témoin de ma propre analyse. */
const preloaded = new Set(
  [
    ...index.matchAll(
      /<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g
    ),
  ].map((match) => match[1])
);

/**
 * Nom d'un morceau sans son empreinte : `GLTFLoader-BuLyuW6a.js` -> `GLTFLoader`.
 *
 * L'empreinte de Vite fait HUIT caractères et peut contenir `-` (`EffectComposer-vVG9g-JL.js`)
 * comme `_` (`tween-Cs9c6a_y.js`). D'où la longueur EXACTE : un quantificateur ouvert
 * (`{8,}`) mord sur le nom lui-même dès qu'il contient un tiret, et rendait `horizons` pour
 * `horizons-validation-summary-DePDTbov.js` — défaut trouvé par la garde de partition, qui a
 * refusé un morceau qu'elle aurait dû reconnaître. Un nom qui ne correspond PAS fait échouer le
 * script plutôt que de rendre un nom plausible et faux.
 */
const chunkName = (file) => {
  const match = /^(.+)-[A-Za-z0-9_-]{8}\.js$/.exec(file);
  if (!match) {
    console.error(
      `nom de morceau inattendu : « ${file} ». L'empreinte de Vite n'est plus de huit ` +
        `caractères, et tout le classement de cette garde repose sur ce découpage.`
    );
    process.exit(1);
  }
  return match[1];
};

const allChunks = readdirSync(ASSETS).filter((file) => file.endsWith('.js'));

/**
 * Les références `./x.js` d'un morceau, séparées selon qu'elles sont STATIQUES ou DYNAMIQUES.
 *
 * On regarde ce qui précède immédiatement le guillemet : `import(` signe un import dynamique,
 * tout le reste (`from`, `import`, `export...from`) un import statique. Le témoin des
 * `modulepreload` ci-dessous est ce qui fait que cette heuristique n'a pas à être crue.
 */
function references(file) {
  const code = readFileSync(join(ASSETS, file), 'utf8');
  const statik = new Set();
  const dynamic = new Set();
  for (const match of code.matchAll(/["'](\.\/[^"']+\.js)["']/g)) {
    const target = match[1].slice(2);
    const before = code.slice(Math.max(0, match.index - 8), match.index);
    if (/import\(\s*$/.test(before)) dynamic.add(target);
    else statik.add(target);
  }
  return { statik, dynamic };
}

/** Clôture des imports statiques depuis l'entrée. */
const staticClosure = new Set();
const queue = [entry];
while (queue.length > 0) {
  const file = queue.pop();
  if (staticClosure.has(file)) continue;
  if (!allChunks.includes(file)) {
    console.error(`morceau référencé mais absent de dist/assets : ${file}`);
    process.exit(1);
  }
  staticClosure.add(file);
  for (const target of references(file).statik) queue.push(target);
}

// TÉMOIN. Vite précharge exactement les imports statiques de l'entrée, l'entrée exceptée. Si les
// deux ensembles divergent, mon analyse est fausse et le nombre qui suit ne vaut rien.
const closureWithoutEntry = [...staticClosure].filter((file) => file !== entry);
const missingFromPreload = closureWithoutEntry.filter(
  (file) => !preloaded.has(file)
);
const extraInPreload = [...preloaded].filter(
  (file) => !staticClosure.has(file)
);
if (missingFromPreload.length > 0 || extraInPreload.length > 0) {
  console.error(
    `la clôture statique calculée ne correspond pas aux \`modulepreload\` de Vite.\n` +
      `  dans ma clôture, pas préchargés : ${missingFromPreload.join(', ') || '(aucun)'}\n` +
      `  préchargés, hors de ma clôture : ${extraInPreload.join(', ') || '(aucun)'}\n` +
      `Corriger l'analyse avant de croire le budget.`
  );
  process.exit(1);
}

/** Les morceaux importés dynamiquement PENDANT le démarrage, déclarés avec leur raison. */
const bootDynamic = [];
for (const declared of BOOT_DYNAMIC_CHUNKS) {
  const found = allChunks.filter((file) => chunkName(file) === declared.chunk);
  if (found.length !== 1) {
    console.error(
      `\`BOOT_DYNAMIC_CHUNKS\` déclare « ${declared.chunk} », et dist/assets en contient ` +
        `${found.length}. Un morceau déclaré qui n'existe plus est un budget qui compte du vide.`
    );
    process.exit(1);
  }
  bootDynamic.push(found[0]);
}

const bootFiles = [...new Set([...staticClosure, ...bootDynamic])].sort();

// PARTITION EXHAUSTIVE. Sans elle, vider `BOOT_DYNAMIC_CHUNKS` ferait baisser le coût mesure de
// 61 703 octets sans qu'aucune garde ne rougisse : un budget qui compte moins que la realite est
// pire qu'aucun budget. Tout morceau doit donc etre dans la cloture statique, declare dynamique
// au demarrage, ou declare hors demarrage — et un morceau neuf oblige a trancher.
const declaredOut = new Set(NON_BOOT_CHUNKS.map((entry) => entry.chunk));
const unclassified = allChunks.filter(
  (file) => !bootFiles.includes(file) && !declaredOut.has(chunkName(file))
);
if (unclassified.length > 0) {
  console.error(
    `ces morceaux ne sont classes nulle part : ${unclassified.join(', ')}.
` +
      `Soit le demarrage les charge (les declarer dans BOOT_DYNAMIC_CHUNKS avec leur raison), ` +
      `soit non (NON_BOOT_CHUNKS). Un morceau non classe est un budget qui compte du vide.`
  );
  process.exit(1);
}
const vanished = [...declaredOut].filter(
  (name) => !allChunks.some((file) => chunkName(file) === name)
);
if (vanished.length > 0) {
  console.error(
    `NON_BOOT_CHUNKS declare des morceaux qui n'existent plus : ${vanished.join(', ')}.`
  );
  process.exit(1);
}
const sizeOf = (file) => statSync(join(ASSETS, file)).size;
const bootBytes = bootFiles.reduce((sum, file) => sum + sizeOf(file), 0);
const lazy = allChunks.filter((file) => !bootFiles.includes(file)).sort();

const [verdict] = judgeFamilies([
  {
    family: 'javascript',
    bytes: bootBytes,
    budgetBytes: JAVASCRIPT_STARTUP_BUDGET_BYTES,
    method:
      'clôture des imports statiques depuis l’entrée de dist/index.html, plus les morceaux ' +
      'que le démarrage importe dynamiquement (BOOT_DYNAMIC_CHUNKS). Octets BRUTS.',
  },
]);

console.log(
  `\nbudget du démarrage — famille « javascript » (octets BRUTS de dist/assets)\n`
);
for (const file of bootFiles) {
  const kind = staticClosure.has(file)
    ? file === entry
      ? 'entrée'
      : 'statique'
    : 'dynamique au démarrage';
  console.log(`  ${String(sizeOf(file)).padStart(8)} o  ${file}  (${kind})`);
}
console.log(
  `  ${'-'.repeat(8)}\n  ${String(bootBytes).padStart(8)} o  démarrage, ` +
    `budget ${JAVASCRIPT_STARTUP_BUDGET_BYTES} o, ` +
    `marge restante ${verdict.headroomBytes} o`
);
console.log(`\n  hors démarrage, et c'est délibéré :`);
for (const file of lazy)
  console.log(`  ${String(sizeOf(file)).padStart(8)} o  ${file}`);
console.log(
  `\n  Méthode : ${verdict.method}\n  Les trois autres familles (éphémérides, textures, ` +
    `modèles) sont tenues par src/config/startupBudget.test.ts, dans \`pnpm verify\`.\n` +
    `  La mesure de bout en bout, en vrai navigateur : node scripts/measure-startup-bytes.mjs\n`
);

if (!verdict.withinBudget) {
  console.error(
    `BUDGET DÉPASSÉ : le démarrage exécute ${bootBytes} octets de JavaScript pour un budget de ` +
      `${JAVASCRIPT_STARTUP_BUDGET_BYTES}.\nAucune autre famille ne peut financer ce dépassement : ` +
      `c'est délibéré (cf. l'en-tête de src/core/startupBudget.ts). Deux issues honnêtes — ` +
      `alléger le démarrage, ou relever le plafond dans un commit qui écrit pourquoi.`
  );
  process.exit(1);
}
