#!/usr/bin/env node
/* global console, process */
/**
 * QUELS FICHIERS e2e TOURNENT SUR QUELLE MACHINE (2026-10-13).
 *
 * `playwright test --shard=i/N` coupe la suite en tranches CONTIGUËS de même NOMBRE de tests, en
 * gardant chaque fichier entier (`fullyParallel: false`). Or les tests ne pèsent pas pareil : un
 * scénario de Titan dure 2,5 min, un test d'accessibilité 5 s, et l'ordre alphabétique groupe les
 * fichiers lourds (`temporal`, `textureLoadState`, `titan`, `tourPlayer`). Mesuré le 2026-10-13
 * (run `38430483193`) : à douze machines, un shard tenait 24,0 min de tests réels sur un EPYC 7763
 * quand un autre en tenait 3,8. Ajouter une machine déplaçait la frontière sans rien régler.
 *
 * Ce script répartit donc les FICHIERS selon leur durée MESURÉE (`e2e/durations.json`, écrit par
 * `scripts/e2e-durations.mjs` depuis des runs de CI), le plus long d'abord sur la machine la
 * moins chargée. Un fichier sans mesure prend la durée MÉDIANE, pour qu'un spec neuf ne casse
 * rien ; la garde `src/config/e2eShards.test.ts` exige que chaque fichier soit placé une fois et
 * une seule. Le parallélisme ne change pas : un worker par machine, le même WebGL logiciel.
 *
 *   node scripts/e2e-shard.mjs <i> <N>   → la liste des fichiers du shard i (1-based) sur N
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const DURATIONS_PATH = resolve(ROOT, 'e2e/durations.json');

/** Les specs de la suite e2e, comme `playwright.config.ts` les voit (`built-*` et `device-*` à part). */
export function e2eSpecFiles(root = ROOT) {
  return readdirSync(resolve(root, 'e2e'))
    .filter(
      (name) =>
        name.endsWith('.spec.ts') &&
        !name.startsWith('built-') &&
        !name.startsWith('device-')
    )
    .map((name) => `e2e/${name}`)
    .sort();
}

/**
 * Répartition « le plus long d'abord, sur le moins chargé » : chaque fichier va à la machine dont
 * le total est le plus petit au moment où on le place. Déterministe (égalités départagées par le
 * nom du fichier, puis par le numéro de machine).
 */
export function assignShards(files, seconds, total) {
  if (!(total >= 1)) throw new Error(`nombre de machines invalide : ${total}`);
  const known = files.map((f) => seconds[f]).filter((s) => s > 0);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 60;
  const weight = (f) => (seconds[f] > 0 ? seconds[f] : median);
  const shards = Array.from({ length: total }, () => ({
    files: [],
    seconds: 0,
  }));
  const order = [...files].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b)
  );
  for (const file of order) {
    let target = shards[0];
    for (const shard of shards)
      if (shard.seconds < target.seconds) target = shard;
    target.files.push(file);
    target.seconds += weight(file);
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

export function readDurations(path = DURATIONS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const current = Number(process.argv[2]);
  const total = Number(process.argv[3]);
  if (!(current >= 1 && current <= total)) {
    console.error('usage : node scripts/e2e-shard.mjs <i> <N>   (1 ≤ i ≤ N)');
    process.exit(2);
  }
  const shards = assignShards(e2eSpecFiles(), readDurations().seconds, total);
  const shard = shards[current - 1];
  if (shard.files.length === 0) {
    console.error(
      `shard ${current}/${total} vide : trop de machines pour la suite`
    );
    process.exit(1);
  }
  process.stdout.write(shard.files.join(' ') + '\n');
}
