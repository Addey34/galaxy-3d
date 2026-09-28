#!/usr/bin/env node
/* global console, process */
/**
 * L'INVENTAIRE DES MANQUES, DÉRIVÉ DU DÉPÔT (lot 22).
 *
 *   pnpm inventory:gaps            relevé lisible
 *   pnpm inventory:gaps --json     le même relevé, en JSON
 *
 * POURQUOI ce script existe : `docs/private/ROADMAP.md` a menti une journée entière parce qu'il
 * RECOPIAIT un état. Aucun nombre de la roadmap ne se recopie plus : il se lit ici. Corps par
 * corps, ce que chacun a et n'a pas — binaire Horizons et son pas, paliers de texture livrés,
 * modèle de forme, jeu de tuiles, champ de hauteurs, faits sourcés et raisons rédigées, page
 * d'atterrissage, vignette — puis la même chose pour les sondes et les objets interstellaires,
 * avec ce qui leur est applicable.
 *
 * **Il ne décide rien, il décrit.** La règle des paliers vit dans `src/core/textureLadder.ts`,
 * celle des faits dans `src/core/bodyFacts.ts`, la file de travail dans `docs/private/VISION.md`
 * § « Ordre d'exécution ». Ce script les interroge par `ssrLoadModule`, comme
 * `scripts/compute-mean-motion-scale.mjs` et `scripts/validate-against-horizons.mjs` : une copie
 * dériverait du lecteur, et c'est exactement l'écart que personne ne voit.
 *
 * La garde est `src/config/inventoryGaps.test.ts`, dans `pnpm verify` : elle exige que le relevé
 * couvre le catalogue ENTIER, donc un corps qui en sortirait rend le test rouge.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': resolve(ROOT, 'src') } },
});

try {
  const { collectInventory } = await loader.ssrLoadModule(
    '/src/inventory/collect.ts'
  );
  const { renderInventory } = await loader.ssrLoadModule(
    '/src/inventory/render.ts'
  );
  const inventory = collectInventory(ROOT);
  console.log(
    asJson ? JSON.stringify(inventory, null, 2) : renderInventory(inventory)
  );
} finally {
  await loader.close();
}
