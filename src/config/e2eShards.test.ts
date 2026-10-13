import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignShards,
  e2eSpecFiles,
  readDurations,
} from '../../scripts/e2e-shard.mjs';
import {
  cpuFactors,
  fileSeconds,
  normalisedSeconds,
} from '../../scripts/e2e-durations.mjs';
import {
  E2E_ENVELOPE_MINUTES,
  E2E_WARN_FRACTION,
} from '../../scripts/check-ci-health.mjs';

/**
 * LA RÉPARTITION DES FICHIERS e2e SUR LES MACHINES DE LA CI (2026-10-13) : `scripts/e2e-shard.mjs`
 * la calcule depuis les durées MESURÉES (`e2e/durations.json`), `ci.yml` l'appelle. Ce qui doit
 * tenir, et que rien d'autre ne vérifierait avant une fusion (le job e2e ne tourne que sur main) :
 * chaque fichier tourne une fois et une seule, et aucune machine ne s'approche du seuil d'alerte.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const CI_YML = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf-8');

describe('the e2e files, spread over the CI machines', () => {
  const matrix = /shard: \[([\d, ]+)\]/.exec(CI_YML);
  const call = /scripts\/e2e-shard\.mjs \$\{\{ matrix\.shard \}\} (\d+)/.exec(
    CI_YML
  );

  it('is what ci.yml runs, for as many machines as its matrix has', () => {
    expect(matrix, 'matrice des shards').toBeTruthy();
    expect(call, 'appel de scripts/e2e-shard.mjs dans ci.yml').toBeTruthy();
    const machines = matrix![1]!.split(',').length;
    expect(Number(call![1])).toBe(machines);
    // Plus de `--shard` de Playwright, qui coupait par NOMBRE de tests.
    expect(CI_YML).not.toMatch(/playwright test --shard/);
  });

  const files = e2eSpecFiles(ROOT);
  const durations = readDurations();
  const shards = assignShards(files, durations.seconds, Number(call![1]));

  it('runs every spec file exactly once, and no machine is idle', () => {
    const placed = shards.flatMap((s) => s.files).sort();
    expect(placed).toEqual(files);
    for (const shard of shards) expect(shard.files.length).toBeGreaterThan(0);
  });

  it('measures no file that no longer exists', () => {
    for (const file of Object.keys(durations.seconds))
      expect(files, `${file} mesuré mais absent`).toContain(file);
  });

  it('keeps every machine well under the alert threshold, on the reference CPU', () => {
    const worst = Math.max(...shards.map((s) => s.seconds)) / 60;
    expect(worst).toBeLessThan(E2E_ENVELOPE_MINUTES * E2E_WARN_FRACTION);
  });
});

describe('assignShards', () => {
  it('puts the longest file first on the least loaded machine', () => {
    const shards = assignShards(
      ['a', 'b', 'c', 'd'],
      { a: 10, b: 9, c: 2, d: 1 },
      2
    );
    expect(shards.map((s) => s.files)).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ]);
    expect(shards.map((s) => s.seconds)).toEqual([11, 11]);
  });

  it('weighs an unmeasured file at the median, so a new spec breaks nothing', () => {
    const shards = assignShards(
      ['a', 'b', 'c', 'new'],
      { a: 1, b: 5, c: 9 },
      2
    );
    expect(shards.flatMap((s) => s.files).sort()).toEqual([
      'a',
      'b',
      'c',
      'new',
    ]);
    expect(shards.reduce((sum, s) => sum + s.seconds, 0)).toBe(1 + 5 + 9 + 5);
  });
});

describe('e2e durations, read from CI logs', () => {
  it('reads seconds and minutes, retries included', () => {
    const lines = [
      '  ✓   1 [chromium] › e2e/titan.spec.ts:22:1 › Planetary moons (2.5m)',
      '  ✘  28 [chromium] › e2e/discovery.spec.ts:275:1 › Vénus (2.0m)',
      '  ✓  29 [chromium] › e2e/discovery.spec.ts:275:1 › Vénus (retry #1) (30.5s)',
      '  ✓  30 [chromium] › e2e/a.spec.ts:1:1 › quick (850ms)',
      'not a test line (12s)',
    ];
    expect(fileSeconds(lines)).toEqual({
      'e2e/titan.spec.ts': 150,
      'e2e/discovery.spec.ts': 150.5,
      'e2e/a.spec.ts': 0.85,
    });
  });

  it('fits one factor per CPU from files seen on two of them, against the reference', () => {
    const observations = [
      { file: 'x', cpu: 'AMD EPYC 7763', seconds: 100 },
      { file: 'x', cpu: 'AMD EPYC 9V45', seconds: 64 },
      { file: 'y', cpu: 'AMD EPYC 7763', seconds: 50 },
      { file: 'y', cpu: 'AMD EPYC 9V45', seconds: 32 },
      { file: 'z', cpu: 'AMD EPYC 9V45', seconds: 32 },
    ];
    const factors = cpuFactors(observations);
    expect(factors['AMD EPYC 7763']).toBe(1);
    expect(factors['AMD EPYC 9V45']).toBeCloseTo(0.64, 3);
    // Ramené au 7763 : 32 s sur un 9V45 en valent 50.
    expect(normalisedSeconds(observations, factors).z).toBe(50);
  });
});
