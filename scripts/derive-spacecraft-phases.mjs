#!/usr/bin/env node
/* global process */
/**
 * Réécrit les phases de satellite des sondes (`satelliteOf` de `src/registry/spacecraft/*.json`)
 * depuis les binaires Horizons livrés.
 *
 *   pnpm spacecraft:phases
 *
 * La dérivation vit dans `src/core/satellitePhases.ts` et la confrontation dans
 * `src/config/satellitePhases.test.ts`, qui échoue dans `pnpm verify` dès qu'une fiche diverge
 * de ses fichiers. Ce script lance ce même test en mode écriture ; relancé tout de suite après,
 * il doit passer. Passer par Node garde la commande identique sous Windows et en CI.
 */
import { spawnSync } from 'node:child_process';

const run = (env) =>
  spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', 'src/config/satellitePhases.test.ts'],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    }
  );

run({ GALAXY_WRITE_SATELLITE_PHASES: '1' });
const check = run({});
process.exit(check.status ?? 1);
