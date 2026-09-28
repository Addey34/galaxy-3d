import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  E2E_ENVELOPE_MINUTES,
  E2E_WARN_FRACTION,
  judge,
  logLines,
  parsePlaywrightSummary,
} from '../../scripts/check-ci-health.mjs';

/**
 * LE GUETTEUR DE LA CI DE `main`, CONFRONTÉ À CE QUE LA SOURCE ÉMET VRAIMENT (lot 24).
 *
 * Ce dépôt a déjà payé DEUX fois le même défaut, et il est écrit dans `CLAUDE.md` : un guetteur
 * dont le filtre ne correspond à rien de ce que la source émet est aussi muet qu'un guetteur
 * cassé, et son silence ressemble exactement à « tout va bien ». Un guetteur de CI qui ne
 * reconnaîtrait plus le résumé de Playwright serait donc PIRE que pas de guetteur.
 *
 * Les fragments ci-dessous sont COPIÉS des journaux réels des deux runs rouges de `main`, avec
 * leur préfixe `job<TAB>step<TAB>horodatage` et leurs retours chariot — c'est-à-dire la forme que
 * `gh run view --log` rend vraiment, et non une forme réécrite pour l'occasion.
 *
 * Et les deux nombres du script sont croisés avec `ci.yml`, qui en est le propriétaire : un
 * garde-fou porté à 45 min sans que ce seuil suive rendrait le signalement muet.
 */

const CI_YML = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf-8'
);

/**
 * Le résumé du shard 4 de la PR #40 : un test échoué, rien au réessai.
 *
 * Les retours chariot sont ceux du rapporteur `list`, qui écrit son avancement avec `\r`. C'est
 * la raison pour laquelle `logLines` normalise AVANT toute recherche.
 */
const RED_SHARD = [
  'Browser tests (e2e 4/6)\tUNKNOWN STEP\t2026-09-28T06:34:20.3826767Z   1 failed',
  'Browser tests (e2e 4/6)\tUNKNOWN STEP\t2026-09-28T06:34:20.3827711Z     [chromium] › e2e/precip-visual.spec.ts:29:1 › IMERG keeps its native alpha mask and compiles the observed rain layer ',
  'Browser tests (e2e 4/6)\tUNKNOWN STEP\t2026-09-28T06:34:20.3828508Z   34 passed (16.3m)',
].join('\r\n');

/**
 * Le résumé du shard 3 du run du lot 23, annoncé « vert en entier » : il l'est, et il contient
 * un test qui n'est passé qu'au réessai. C'est LE cas que ce guetteur existe pour dire.
 */
const GREEN_BUT_RETRIED = [
  'Browser tests (e2e 3/6)\tUNKNOWN STEP\t2026-09-28T13:25:01.0000000Z   1 flaky',
  'Browser tests (e2e 3/6)\tUNKNOWN STEP\t2026-09-28T13:25:01.0000000Z     [chromium] › e2e/precip-visual.spec.ts:29:1 › IMERG keeps its native alpha mask and compiles the observed rain layer ',
  'Browser tests (e2e 3/6)\tUNKNOWN STEP\t2026-09-28T13:25:01.0000000Z   34 passed (15.5m)',
].join('\r\n');

describe('ce que le guetteur lit dans un journal de Playwright', () => {
  it('reconnaît un test ÉCHOUÉ dans le résumé du rapporteur `list`', () => {
    const summary = parsePlaywrightSummary(logLines(RED_SHARD));
    expect(summary.failed).toEqual([
      '[chromium] › e2e/precip-visual.spec.ts:29:1 › IMERG keeps its native alpha mask and compiles the observed rain layer',
    ]);
    expect(summary.flaky).toEqual([]);
    expect(summary.passed).toBe(34);
    expect(summary.totalMinutes).toBeCloseTo(16.3, 5);
  });

  it('reconnaît un test passé SEULEMENT au réessai, dans un job vert', () => {
    const summary = parsePlaywrightSummary(logLines(GREEN_BUT_RETRIED));
    expect(summary.failed).toEqual([]);
    expect(summary.flaky).toEqual([
      '[chromium] › e2e/precip-visual.spec.ts:29:1 › IMERG keeps its native alpha mask and compiles the observed rain layer',
    ]);
  });

  it('ne confond pas les lignes d’avancement avec un résumé', () => {
    // Pendant toute la suite, le rapporteur n'émet QUE ces lignes-là, séparées par des retours
    // chariot. Un filtre écrit sur « passed|failed » ne voit donc rien pendant vingt minutes.
    const progress = logLines(
      'Browser tests (e2e 1/6)\tUNKNOWN STEP\t2026-09-28T06:20:00.0000000Z   ✓  12 [chromium] › e2e/smoke.spec.ts:4:1 › boots (21.1s)\r  ✓  13 [chromium] › e2e/modes.spec.ts:9:1 › switches (30.2s)\r'
    );
    const summary = parsePlaywrightSummary(progress);
    expect(summary.passed).toBeNull();
    expect(summary.failed).toEqual([]);
    expect(summary.flaky).toEqual([]);
  });
});

describe('le jugement, et ses trois natures de défaut', () => {
  const shard = (
    name: string,
    conclusion: string,
    minutes: number,
    summary: ReturnType<typeof parsePlaywrightSummary> | null
  ) => ({ id: 1, name, conclusion, minutes, shard: 4, summary });

  it('un job rouge est rouge', () => {
    const verdict = judge({
      jobs: [shard('Browser tests (e2e 4/6)', 'failure', 17.3, null)],
    });
    expect(verdict.healthy).toBe(false);
    expect(verdict.red).toHaveLength(1);
  });

  it('un job VERT dont un test a été réessayé n’est pas sain', () => {
    const verdict = judge({
      jobs: [
        shard(
          'Browser tests (e2e 3/6)',
          'success',
          15.5,
          parsePlaywrightSummary(logLines(GREEN_BUT_RETRIED))
        ),
      ],
    });
    expect(verdict.healthy).toBe(false);
    expect(verdict.red).toEqual([]);
    expect(verdict.retried).toHaveLength(1);
  });

  it('un shard qui remplit son enveloppe est signalé, même vert', () => {
    const verdict = judge({
      jobs: [
        shard(
          'Browser tests (e2e 4/6)',
          'success',
          E2E_ENVELOPE_MINUTES * E2E_WARN_FRACTION + 0.1,
          parsePlaywrightSummary(
            logLines(RED_SHARD.replace('1 failed', '0 failed'))
          )
        ),
      ],
    });
    expect(verdict.full).toHaveLength(1);
    expect(verdict.healthy).toBe(false);
  });

  it('un journal ILLISIBLE rend le run non sain, jamais sain par défaut', () => {
    // Le cas mesuré : `gh run view` sans `-R` échoue par « not a git repository », les six
    // journaux deviennent illisibles d'un coup, et un run dont aucun job n'est rouge serait
    // déclaré sain. C'est le silence qu'on refuse.
    const verdict = judge({
      jobs: [
        shard('Browser tests (e2e 1/6)', 'success', 13.9, {
          passed: null,
          totalMinutes: null,
          failed: [],
          flaky: [],
          timedOut: [],
          interrupted: [],
          unreadable: 'Command failed: gh run view --job 1 --log',
        }),
      ],
    });
    expect(verdict.healthy).toBe(false);
    expect(verdict.unreadable).toHaveLength(1);
    expect(verdict.red).toEqual([]);
  });

  it('un run entièrement propre est sain', () => {
    const clean = parsePlaywrightSummary(
      logLines(
        'Browser tests (e2e 1/6)\tUNKNOWN STEP\t2026-09-28T06:20:00.0000000Z   34 passed (13.9m)'
      )
    );
    const verdict = judge({
      jobs: [
        shard('Browser tests (e2e 1/6)', 'success', 13.9, clean),
        { ...shard('Browser smoke test', 'skipped', 0, null), shard: null },
      ],
    });
    expect(verdict.healthy).toBe(true);
  });
});

describe('les deux nombres du guetteur viennent de `ci.yml`', () => {
  it('l’enveloppe est celle du garde-fou du job e2e', () => {
    // Le `timeout-minutes` qui suit la matrice des shards, c'est-à-dire celui du job e2e-full.
    const afterMatrix = CI_YML.slice(
      CI_YML.indexOf('shard: [1, 2, 3, 4, 5, 6]')
    );
    const guard = /timeout-minutes:\s*(\d+)/.exec(afterMatrix);
    expect(
      guard,
      'le garde-fou du job e2e n’a pas été trouvé dans ci.yml'
    ).toBeTruthy();
    expect(Number(guard![1])).toBe(E2E_ENVELOPE_MINUTES);
  });

  it('le seuil de signalement reste sous l’enveloppe', () => {
    expect(E2E_WARN_FRACTION).toBeGreaterThan(0);
    expect(E2E_WARN_FRACTION).toBeLessThan(1);
  });

  it('le guetteur est déclenché par le workflow `CI` et par lui seul', () => {
    const watch = readFileSync(
      resolve(import.meta.dirname, '../../.github/workflows/main-ci-watch.yml'),
      'utf-8'
    );
    expect(watch).toContain("workflows: ['CI']");
    expect(watch).toContain('branches: [main]');
    // Le nom du workflow surveillé doit être celui que `ci.yml` se donne, sinon le déclencheur
    // ne se lie à rien et le guetteur ne tourne JAMAIS, silencieusement.
    expect(CI_YML.startsWith('name: CI\n')).toBe(true);
    // Sans ce droit, l'ouverture de l'issue échoue et le guetteur ne dit rien.
    expect(watch).toContain('issues: write');
  });
});
