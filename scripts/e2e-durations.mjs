#!/usr/bin/env node
/* global console, process */
/**
 * LA DURÉE MESURÉE DE CHAQUE FICHIER e2e, POUR RÉPARTIR LES MACHINES (2026-10-13).
 *
 * Lit les journaux des shards e2e d'un ou plusieurs runs de CI (le rapporteur `list` imprime la
 * durée de chaque test, en « (12.3s) » ou « (1.2m) » au-delà d'une minute), additionne par
 * fichier, et écrit `e2e/durations.json`, que `scripts/e2e-shard.mjs` lit.
 *
 * GitHub ne sert pas toujours le même processeur, et en rendu logiciel l'écart va du simple au
 * double (CLAUDE.md). Une durée brute mélangerait donc des machines. Chaque job imprime son CPU
 * (`RUNNER_CPU …`, lu par `scripts/check-ci-health.mjs`) ; un même fichier mesuré sur deux
 * processeurs donne leur rapport, et l'on ajuste par moindres carrés un FACTEUR par processeur,
 * rapporté à l'EPYC 7763, le plus lent qu'on reçoive couramment. Les durées sont écrites dans
 * cette unité (« secondes-7763 »), et le facteur retenu pour chaque processeur est écrit avec
 * elles. Un fichier vu plusieurs fois garde sa durée normalisée la plus LONGUE : la répartition
 * se règle sur le pire cas.
 *
 *   pnpm e2e:durations --run <id> [--run <id> …]
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { inspectRun, jobLog, logLines } from './check-ci-health.mjs';
import { DURATIONS_PATH } from './e2e-shard.mjs';

export const REFERENCE_CPU = 'AMD EPYC 7763';

const TEST_LINE =
  /^\s*[✓✘]\s+\d+\s+\[chromium\]\s+›\s+(e2e\/[^:]+):\d+:\d+\s+›.*\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;

/** Durée par fichier (s) dans les lignes d'un journal, réessais compris (ils coûtent aussi). */
export function fileSeconds(lines) {
  const out = {};
  for (const line of lines) {
    const m = TEST_LINE.exec(line);
    if (!m) continue;
    const value = Number(m[2]);
    const seconds =
      m[3] === 'm' ? value * 60 : m[3] === 'ms' ? value / 1000 : value;
    out[m[1]] = (out[m[1]] ?? 0) + seconds;
  }
  return out;
}

/** Le nom de modèle sans fioritures (« AMD EPYC 7763 64-Core Processor » → « AMD EPYC 7763 »). */
export function cpuKey(model) {
  const m =
    /(AMD EPYC [0-9A-Z]+|Xeon\(R\) Platinum [0-9A-Z]+|Xeon\(R\) [0-9A-Z-]+)/i.exec(
      model ?? ''
    );
  return m
    ? m[1]
        .toUpperCase()
        .replace('XEON(R)', 'Xeon(R)')
        .replace('PLATINUM', 'Platinum')
    : 'inconnu';
}

/**
 * Facteurs de durée par processeur, rapportés à `REFERENCE_CPU`, ajustés sur les fichiers vus sur
 * au moins deux processeurs. `observations` : liste de { file, cpu, seconds }.
 */
export function cpuFactors(observations, reference = REFERENCE_CPU) {
  const cpus = [...new Set(observations.map((o) => o.cpu))];
  const factor = Object.fromEntries(cpus.map((c) => [c, 1]));
  const byFile = new Map();
  for (const o of observations) {
    if (!byFile.has(o.file)) byFile.set(o.file, []);
    byFile.get(o.file).push(o);
  }
  const shared = [...byFile.values()].filter(
    (list) => new Set(list.map((o) => o.cpu)).size > 1
  );
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const num = {};
    const den = {};
    for (const list of shared) {
      const base =
        list.reduce((sum, o) => sum + o.seconds / factor[o.cpu], 0) /
        list.length;
      for (const o of list) {
        num[o.cpu] = (num[o.cpu] ?? 0) + o.seconds * base;
        den[o.cpu] = (den[o.cpu] ?? 0) + base * base;
      }
    }
    for (const c of cpus) if (den[c]) factor[c] = num[c] / den[c];
    const ref = factor[reference] ?? 1;
    for (const c of cpus) factor[c] /= ref;
  }
  return factor;
}

/** Durées normalisées par fichier : la plus longue des observations, chacune ramenée au 7763. */
export function normalisedSeconds(observations, factors) {
  const out = {};
  for (const o of observations) {
    const value = o.seconds / (factors[o.cpu] ?? 1);
    out[o.file] = Math.max(out[o.file] ?? 0, Math.round(value));
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b))
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const runs = [];
  for (let i = 2; i < process.argv.length; i += 1)
    if (process.argv[i] === '--run') runs.push(process.argv[(i += 1)]);
  if (runs.length === 0) {
    console.error('usage : pnpm e2e:durations --run <id> [--run <id> …]');
    process.exit(2);
  }
  const observations = [];
  for (const id of runs) {
    const run = inspectRun(id, { readLogs: false });
    for (const job of run.jobs) {
      if (job.shard === null || job.conclusion === 'skipped') continue;
      const lines = logLines(jobLog(job.id));
      const cpu = cpuKey(
        lines.map((l) => /^RUNNER_CPU (.*?) \|/.exec(l)?.[1]).find(Boolean)
      );
      for (const [file, seconds] of Object.entries(fileSeconds(lines)))
        observations.push({ file, cpu, seconds, run: id });
    }
  }
  const factors = cpuFactors(observations);
  const seconds = normalisedSeconds(observations, factors);
  const total = Object.values(seconds).reduce((a, b) => a + b, 0);
  writeFileSync(
    DURATIONS_PATH,
    JSON.stringify(
      {
        $comment:
          'Écrit par `pnpm e2e:durations`. Durée de chaque fichier e2e en secondes ramenées à un EPYC 7763, lue par scripts/e2e-shard.mjs pour répartir les machines. Ne pas éditer à la main.',
        unit: `secondes sur ${REFERENCE_CPU}`,
        runs: runs.map(Number),
        cpuFactors: Object.fromEntries(
          Object.entries(factors)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, Math.round(v * 100) / 100])
        ),
        seconds,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `${Object.keys(seconds).length} fichiers, ${(total / 60).toFixed(1)} min (${REFERENCE_CPU}) → ${DURATIONS_PATH}`
  );
}
