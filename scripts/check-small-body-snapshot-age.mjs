#!/usr/bin/env node
/* global process */
/**
 * L'instantané des petits corps a-t-il dépassé l'âge déclaré ?
 *
 *   pnpm smallbodies:age
 *
 * La règle et l'âge vivent dans `src/core/snapshotAge.ts`, lus par le panneau de l'application :
 * ce script ne fait qu'activer, par une variable d'environnement, le contrôle daté de
 * `src/core/snapshotAge.test.ts`, qui reste éteint dans `pnpm verify`. Passer par Node plutôt
 * que par `VAR=1 vitest` garde la commande identique sous Windows et en CI.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'src/core/snapshotAge.test.ts'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GALAXY_SNAPSHOT_AGE_CHECK: '1' },
  }
);
process.exit(result.status ?? 1);
