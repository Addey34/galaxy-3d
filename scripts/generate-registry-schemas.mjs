#!/usr/bin/env node
/* global console, process */
/**
 * Écrit les JSON Schema des registres (`src/registry/schema/*.schema.json`) DEPUIS les schémas
 * Zod, jamais à la main.
 *
 * Ces JSON Schema n'existent que pour l'éditeur : ils font valider les fiches
 * `src/registry/**.json` pendant la saisie, ce que le compilateur ne fait plus une fois la donnée
 * sortie du TypeScript (cf. `docs/private/REGISTRES_LOT7.md` § 5, décision D1). Ce sont donc des
 * COPIES, et une copie qui peut dériver ne vaut rien : chaque `*.schema.test.ts` appelle la même
 * fonction que ce script et refuse le moindre écart.
 *
 * Les schémas sont du TypeScript, et la CI tourne sous Node 22 : on les charge par le
 * `ssrLoadModule` de Vite, exactement comme `vite.config.ts` charge `src/seo`, plutôt que de
 * dépendre du dépouillement de types de Node.
 *
 * Usage : pnpm schema:generate
 */
import { writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

/** Chaque schéma : module source, fonction qui sérialise, fichier écrit. */
const SCHEMAS = [
  ['provider.ts', 'providerJsonSchemaText', 'provider.schema.json'],
  ['product.ts', 'productJsonSchemaText', 'product.schema.json'],
];

const DIR = resolve(process.cwd(), 'src/registry/schema');

const server = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  // Rien à pré-empaqueter ici : sans cela le scanner d'esbuild part sur un chemin absolu
  // Windows et crache une trace inutile alors que le chargement SSR, lui, aboutit.
  optimizeDeps: { noDiscovery: true },
});
try {
  for (const [source, serialise, out] of SCHEMAS) {
    const module = await server.ssrLoadModule(`/src/registry/schema/${source}`);
    const target = resolve(DIR, out);
    await writeFile(target, module[serialise](), 'utf-8');
    console.log(`JSON Schema écrit : ${relative(process.cwd(), target)}`);
  }
} finally {
  await server.close();
}
