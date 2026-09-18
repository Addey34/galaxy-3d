#!/usr/bin/env node
/* global console, process */
/**
 * Écrit `src/registry/schema/provider.schema.json` DEPUIS le schéma Zod, jamais à la main.
 *
 * Le JSON Schema commité n'existe que pour l'éditeur : il fait valider les fiches
 * `src/registry/providers/*.json` pendant la saisie, ce que le compilateur ne fait plus une fois
 * la donnée sortie du TypeScript (cf. `docs/private/REGISTRES_LOT7.md` § 5, décision D1). Il est
 * donc une COPIE, et une copie qui peut dériver ne vaut rien : `provider.schema.test.ts` appelle
 * la même fonction que ce script et refuse le moindre écart.
 *
 * Le schéma est du TypeScript, et ce dépôt cible Node 22 en CI : on le charge par le
 * `ssrLoadModule` de Vite, exactement comme `vite.config.ts` charge `src/seo`, plutôt que de
 * dépendre du dépouillement de types de Node.
 *
 * Usage : pnpm schema:generate
 */
import { writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

const OUT = resolve(process.cwd(), 'src/registry/schema/provider.schema.json');

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
  const module = await server.ssrLoadModule('/src/registry/schema/provider.ts');
  await writeFile(OUT, module.providerJsonSchemaText(), 'utf-8');
  console.log(`JSON Schema écrit : ${relative(process.cwd(), OUT)}`);
} finally {
  await server.close();
}
