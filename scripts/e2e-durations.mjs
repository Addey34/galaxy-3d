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
 *
 * Un spec NEUF n'a pas de mesure avant son premier run, et la médiane qu'on lui prêtait sous-pesait
 * les scénarios lourds (GAL-CI-EFFICIENCY-001, #572 : `satelliteTracking` pesait 384 s, la médiane en
 * donnait ~140, et la machine 3/11 a fini à 27,7 min). Deux outils ferment ce trou :
 *   pnpm e2e:durations --estimate e2e/x.spec.ts=300   écrit une ESTIMATION (marquée `estimated`) ;
 *       la garde de `src/config/e2eShards.test.ts` EXIGE une entrée par spec, donc `pnpm verify` refuse
 *       un spec sans durée. Repère : 60 s par scénario (le 90e centile mesuré est 53 s) ;
 *   pnpm e2e:durations --check --run <id> [--run <id> …]   compare un run à `durations.json` (avec les
 *       facteurs de processeur déjà écrits) et liste les specs sans mesure, ceux qui ne tiennent que sur
 *       une estimation, et ceux dont la durée a bougé de plus de 50 % et de 60 s.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectRun, jobLog, logLines } from './check-ci-health.mjs';
import { DURATIONS_PATH } from './e2e-shard.mjs';

const ROOT = resolve(import.meta.dirname, '..');

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

/**
 * Un job de shard dont on lit les durées : seulement un job RÉUSSI. Un job rouge (ou annulé)
 * contient des tests arrêtés par leur délai (3 min chacun pour `surfaceImageryEarth.spec.ts`
 * dans le run 42469732295, soit 1 470 s contre 959 s sur les runs verts), et la durée retenue
 * d'un fichier est la plus LONGUE observée : un seul job en échec gonflerait la répartition.
 */
export function isMeasurableJob(job) {
  return job.shard !== null && job.conclusion === 'success';
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

/**
 * Ce que la répartition enregistrée ne dit plus juste, d'après des durées mesurées (déjà normalisées).
 * Pur : `recorded` = `seconds`, `estimated` = les entrées qui ne sont qu'une estimation.
 */
export function staleEntries(measured, recorded, estimated = []) {
  const out = { unmeasured: [], estimated: [], moved: [] };
  for (const [file, seconds] of Object.entries(measured)) {
    const before = recorded[file];
    if (!(before > 0)) out.unmeasured.push({ file, seconds });
    else if (estimated.includes(file))
      out.estimated.push({ file, seconds, before });
    else if (
      Math.abs(seconds - before) > 60 &&
      Math.abs(seconds - before) > before / 2
    )
      out.moved.push({ file, seconds, before });
  }
  return out;
}

const COMMENT =
  'Écrit par `pnpm e2e:durations`. Durée de chaque fichier e2e en secondes ramenées à un EPYC 7763, lue par scripts/e2e-shard.mjs pour répartir les machines. Ne pas éditer à la main.';

function readRecorded() {
  return existsSync(DURATIONS_PATH)
    ? JSON.parse(readFileSync(DURATIONS_PATH, 'utf8'))
    : { seconds: {} };
}

function writeDurations(doc) {
  writeFileSync(DURATIONS_PATH, JSON.stringify(doc, null, 2) + '\n');
}

const sorted = (record) =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

/** Les observations d'un ou plusieurs runs de CI : fichier, processeur, secondes brutes. */
function observe(runs) {
  const observations = [];
  for (const id of runs) {
    const run = inspectRun(id, { readLogs: false });
    for (const job of run.jobs) {
      if (!isMeasurableJob(job)) continue;
      const lines = logLines(jobLog(job.id));
      const cpu = cpuKey(
        lines.map((l) => /^RUNNER_CPU (.*?) \|/.exec(l)?.[1]).find(Boolean)
      );
      for (const [file, seconds] of Object.entries(fileSeconds(lines)))
        observations.push({ file, cpu, seconds, run: id });
    }
  }
  return observations;
}

function estimate(entries, recorded) {
  // Une estimation par spec neuf : marquée, pour que `--check` dise de la remplacer par une mesure.
  const seconds = { ...recorded.seconds };
  const estimated = new Set(recorded.estimated ?? []);
  for (const entry of entries) {
    const [file, value] = entry.split('=');
    if (!file || !(Number(value) > 0)) {
      console.error(
        `estimation illisible : ${entry} (attendu e2e/x.spec.ts=300)`
      );
      process.exit(2);
    }
    seconds[file] = Number(value);
    estimated.add(file);
  }
  writeDurations({
    ...recorded,
    seconds: sorted(seconds),
    estimated: [...estimated].sort(),
  });
  console.log(
    `${entries.length} estimation(s) écrite(s) dans ${DURATIONS_PATH}`
  );
}

function check(runs, observations, recorded) {
  // Un seul run ne suffit pas à ajuster les facteurs : ceux déjà écrits servent.
  const factors =
    runs.length > 1 ? cpuFactors(observations) : (recorded.cpuFactors ?? {});
  const measured = normalisedSeconds(observations, factors);
  const stale = staleEntries(
    measured,
    recorded.seconds,
    recorded.estimated ?? []
  );
  const line = (e) =>
    `  ${e.file}  ${Math.round(e.seconds)} s${e.before ? ` (enregistré : ${e.before} s)` : ''}`;
  for (const [title, list] of [
    ['SANS MESURE enregistrée', stale.unmeasured],
    ['enregistrés en ESTIMATION seulement', stale.estimated],
    ['durée bougée de plus de 50 % et 60 s', stale.moved],
  ])
    if (list.length) console.log(`${title} :\n${list.map(line).join('\n')}`);
  const total =
    stale.unmeasured.length + stale.estimated.length + stale.moved.length;
  console.log(
    total
      ? `\nRépartition à relire : pnpm e2e:durations --run ${runs.join(' --run ')}`
      : 'Répartition à jour.'
  );
  process.exit(total ? 1 : 0);
}

function refresh(runs, observations, recorded) {
  // Un seul run ne suffit pas à ajuster les facteurs (aucun fichier n'y est vu sur deux processeurs, tous
  // vaudraient 1) : ceux déjà écrits servent, comme pour `--check`. Deux runs ou plus : ajustement.
  const factors =
    runs.length > 1 || !recorded.cpuFactors
      ? cpuFactors(observations)
      : recorded.cpuFactors;
  const seconds = { ...normalisedSeconds(observations, factors) };
  // Un spec ajouté APRÈS ces runs garde son entrée (mesurée ou estimée) tant qu'il existe.
  const estimated = [];
  for (const [file, value] of Object.entries(recorded.seconds))
    if (!(file in seconds) && existsSync(resolve(ROOT, file))) {
      seconds[file] = value;
      if ((recorded.estimated ?? []).includes(file)) estimated.push(file);
    }
  const total = Object.values(seconds).reduce((a, b) => a + b, 0);
  writeDurations({
    $comment: COMMENT,
    unit: `secondes sur ${REFERENCE_CPU}`,
    runs: runs.map(Number),
    cpuFactors: Object.fromEntries(
      Object.entries(factors)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    seconds: sorted(seconds),
    ...(estimated.length ? { estimated: estimated.sort() } : {}),
  });
  console.log(
    `${Object.keys(seconds).length} fichiers, ${(total / 60).toFixed(1)} min (${REFERENCE_CPU}) → ${DURATIONS_PATH}`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const runs = [];
  const estimates = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--run') runs.push(args[(i += 1)]);
    if (args[i] === '--estimate') estimates.push(args[(i += 1)]);
  }
  const recorded = readRecorded();
  if (estimates.length > 0) {
    estimate(estimates, recorded);
  } else if (runs.length === 0) {
    console.error(
      'usage : pnpm e2e:durations --run <id> [--run <id> …]\n        pnpm e2e:durations --check --run <id> [--run <id> …]\n        pnpm e2e:durations --estimate e2e/x.spec.ts=300'
    );
    process.exit(2);
  } else {
    const observations = observe(runs);
    if (args.includes('--check')) check(runs, observations, recorded);
    else refresh(runs, observations, recorded);
  }
}
