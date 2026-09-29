#!/usr/bin/env node
/* global console, process */
/**
 * LA SANTÉ D'UN RUN DE CI, LUE PLUTÔT QUE SUPPOSÉE.
 *
 * Pourquoi ce script existe, et ce que la mesure a montré (2026-09-28, lot 24) :
 *
 *  - le job `e2e-full` est `if: push`, donc il ne tourne QUE sur `main`. Aucune CI de branche
 *    ne peut montrer un shard rouge avant une fusion, et une suite locale ne sharde pas ;
 *  - DEUX fusions consécutives sur `main` ont rendu un shard rouge sans que personne le voie
 *    (PR #40, shard 4, `e2e/precip-visual.spec.ts` ; PR #42, shard 6, `e2e/titan.spec.ts`) ;
 *  - et le cas le plus discret n'est pas le rouge : c'est le VERT OBTENU PAR RÉESSAI.
 *    `playwright.config.ts` donne deux reprises en CI, donc un test qui échoue puis passe rend
 *    le job VERT et ne laisse qu'un mot dans un journal que personne n'ouvre. Le run de `main`
 *    du lot 23 (`36426597634`) est annoncé « vert en entier » : il l'est, et pourtant
 *    `precip-visual` et `surfaceImagery` n'y sont passés qu'à la deuxième tentative.
 *
 * Ce script lit donc les DEUX, plus une troisième chose que l'histoire du dépôt désigne comme
 * l'état qui précède une série de runs coupés : un shard qui remplit son enveloppe de 30 min.
 *
 * Il ne dépend PAS de `jq`, qui n'est pas installé sur la machine de développement : il appelle
 * `gh api` et analyse le JSON dans Node. Et il analyse le journal du rapporteur `list` de
 * Playwright, qui écrit son avancement avec des RETOURS CHARIOT — d'où la normalisation des
 * fins de ligne avant toute recherche, sans quoi le filtre ne verrait rien et son silence
 * ressemblerait à « tout va bien ». Les deux pièges sont écrits dans `CLAUDE.md`.
 *
 * Usage :
 *   node scripts/check-ci-health.mjs                 # dernier run CI de main (push)
 *   node scripts/check-ci-health.mjs --run <id>      # un run précis
 *   node scripts/check-ci-health.mjs --markdown      # sortie prête pour un corps d'issue
 *   node scripts/check-ci-health.mjs --json
 *
 * Code de sortie : 0 si le run est SAIN, 1 s'il ne l'est pas, 2 si la mesure n'a pas pu être
 * faite (c'est une distinction qui compte : « je n'ai pas pu lire » n'est pas « tout va bien »).
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Le dépôt. GitHub Actions pose toujours `GITHUB_REPOSITORY`, donc le workflow n'a rien à
 * passer ; en local, le défaut est celui de ce projet.
 */
const REPOSITORY = process.env['GITHUB_REPOSITORY'] || 'Addey34/galaxy-3d';
const WORKFLOW = 'CI';

/**
 * Le garde-fou `timeout-minutes` du job `e2e-full`, recopié ici EXPRÈS et croisé avec
 * `.github/workflows/ci.yml` par `src/config/ciHealth.test.ts` : un script qui lit le YAML pour
 * un seul nombre serait plus fragile que le test qui les compare.
 */
export const E2E_ENVELOPE_MINUTES = 30;

/**
 * Part de l'enveloppe au-delà de laquelle un shard est SIGNALÉ, même vert.
 *
 * 0,8 n'est pas un chiffre rond choisi pour faire joli : le 2026-09-09, le shard 1 occupait
 * 70 % de son enveloppe et c'est l'état qui a précédé la série de runs coupés ; le 2026-09-28,
 * un shard a été CUT à 30m23. Un seuil à 24 min laisse donc le temps d'ajouter une machine
 * avant qu'un run ne se fasse couper, ce qui est exactement ce qu'on veut voir venir.
 */
export const E2E_WARN_FRACTION = 0.8;

/** Un job de la matrice e2e, quel que soit son numéro de shard. */
const E2E_JOB = /^Browser tests \(e2e (\d+)\/(\d+)\)$/;

function gh(path) {
  return execFileSync('gh', ['api', path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function ghJson(path) {
  return JSON.parse(gh(path));
}

/**
 * Le journal d'un job. `gh run view --log` plutôt que l'API : l'API rend une redirection que
 * `gh api` ne suit pas, et ce chemin-là est celui qui a effectivement rendu les journaux des
 * deux runs rouges pendant l'enquête.
 *
 * `-R` EXPLICITE, et ce n'est pas décoratif : sans lui, `gh run view` déduit le dépôt du dossier
 * COURANT et échoue par « not a git repository » dès qu'on le lance d'ailleurs. Mesuré en jouant
 * l'étape du guetteur depuis un dossier de travail : les six journaux devenaient illisibles d'un
 * coup, et seul le job déjà rouge sauvait le verdict.
 */
function jobLog(jobId) {
  try {
    return execFileSync(
      'gh',
      ['run', 'view', '-R', REPOSITORY, '--job', String(jobId), '--log'],
      {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        // `stderr` CAPTURé et non hérité : sinon l'explication de `gh` (« logs will be available
        // when it is complete ») s'imprime à côté du rapport au lieu d'y entrer.
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (error) {
    const said = String(error?.stderr ?? '').trim();
    throw new Error(said || String(error?.message ?? error), { cause: error });
  }
}

/**
 * Les lignes d'un journal de job, débarrassées du préfixe `job<TAB>step<TAB>horodatage` que
 * `gh` ajoute, et des retours chariot du rapporteur `list`.
 */
export function logLines(raw) {
  return (
    raw
      // `\r\n` D'ABORD : c'est UN saut de ligne. Remplacer `\r` en premier le doublerait et
      // glisserait une ligne vide entre un compte et le titre qui le suit, ce qui coupait la
      // lecture du résumé — trouvé par la garde, sur un fragment de journal RÉEL.
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n')
      .map((line) => line.replace(/^[^\t]*\t[^\t]*\t\S+\s?/, ''))
  );
}

/**
 * Le VERDICT d'une suite Playwright, lu dans le bloc de résumé du rapporteur `list`.
 *
 * Ce bloc est la seule partie du journal écrite avec de vrais sauts de ligne et dans une forme
 * stable : un compte, puis un titre de test par ligne indentée. On lit les quatre catégories
 * qui disent quelque chose — `failed`, `flaky`, `timed out`, `interrupted` — et `passed`, qui
 * porte la durée totale.
 *
 * `flaky` est la catégorie qui compte le plus ici : c'est celle qu'un job VERT contient.
 */
export function parsePlaywrightSummary(lines) {
  const categories = { failed: [], flaky: [], timedOut: [], interrupted: [] };
  const keys = {
    failed: 'failed',
    flaky: 'flaky',
    'timed out': 'timedOut',
    interrupted: 'interrupted',
  };
  let passed = null;
  let totalMinutes = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const passedMatch = /^\s{2}(\d+) passed \(([\d.]+)(m|s)\)\s*$/.exec(line);
    if (passedMatch) {
      passed = Number(passedMatch[1]);
      totalMinutes =
        passedMatch[3] === 'm'
          ? Number(passedMatch[2])
          : Number(passedMatch[2]) / 60;
      continue;
    }
    const headMatch =
      /^\s{2}(\d+) (failed|flaky|timed out|interrupted)\s*$/.exec(line);
    if (!headMatch) continue;
    const bucket = categories[keys[headMatch[2]]];
    // Les titres suivent, indentés de quatre espaces, jusqu'au prochain compte.
    for (let next = index + 1; next < lines.length; next += 1) {
      const title = /^\s{4}(\S.*)$/.exec(lines[next]);
      if (!title) break;
      bucket.push(title[1].trim());
    }
  }

  return { passed, totalMinutes, ...categories };
}

function minutesBetween(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  return (Date.parse(completedAt) - Date.parse(startedAt)) / 60_000;
}

function latestMainRun() {
  const runs = ghJson(
    `repos/${REPOSITORY}/actions/runs?branch=main&event=push&status=completed&per_page=20`
  );
  const run = runs.workflow_runs.find(
    (candidate) => candidate.name === WORKFLOW
  );
  if (!run)
    throw new Error(
      `aucun run « ${WORKFLOW} » terminé sur main dans les 20 derniers`
    );
  return run;
}

/** Tout ce qu'on sait d'un run, sans aucun jugement encore porté. */
export function inspectRun(runId, { readLogs = true } = {}) {
  const run = ghJson(`repos/${REPOSITORY}/actions/runs/${runId}`);
  const { jobs } = ghJson(
    `repos/${REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`
  );

  const inspected = jobs.map((job) => {
    const shard = E2E_JOB.exec(job.name);
    const minutes = minutesBetween(job.started_at, job.completed_at);
    const base = {
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      minutes,
      shard: shard ? Number(shard[1]) : null,
      summary: null,
    };
    if (!shard || !readLogs || job.conclusion === 'skipped') return base;
    try {
      base.summary = parsePlaywrightSummary(logLines(jobLog(job.id)));
    } catch (error) {
      base.summary = { unreadable: String(error?.message ?? error) };
    }
    return base;
  });

  return {
    id: run.id,
    title: run.display_title,
    sha: run.head_sha,
    conclusion: run.conclusion,
    attempt: run.run_attempt,
    url: run.html_url,
    createdAt: run.created_at,
    supersededBy: supersedingRun(run),
    jobs: inspected,
  };
}

/**
 * LE RUN QUI A REMPLACÉ CELUI-CI, s'il existe.
 *
 * `ci.yml` déclare `concurrency: cancel-in-progress`, donc deux fusions rapprochées ANNULENT le
 * run de la première. Ce run-là n'est pas malade, il est remplacé : ses shards portent
 * `cancelled` et aucun n'a échoué. Le dire non sain ouvre une issue pour rien, et **un guetteur
 * qui crie au loup finit ignoré** — c'est arrivé le 2026-09-29, issue #55 ouverte sur le run du
 * lot 29 annulé par la poussée du lot 30.
 *
 * Le signal est précis et vérifiable : un run du MÊME workflow, sur la MÊME branche, de numéro
 * SUPÉRIEUR, et créé AVANT que celui-ci ne se termine. Rien d'autre ne vaut : l'API n'expose
 * nulle part « annulé par la concurrence ».
 */
function supersedingRun(run) {
  if (run.conclusion !== 'cancelled') return null;
  let list;
  try {
    list = ghJson(
      `repos/${REPOSITORY}/actions/workflows/${run.workflow_id}/runs` +
        `?branch=${encodeURIComponent(run.head_branch)}&per_page=30`
    );
  } catch {
    // On ne SAIT pas : on ne prétend donc pas que le run est remplacé.
    return null;
  }
  const ended = Date.parse(run.updated_at);
  for (const other of list.workflow_runs ?? []) {
    if (other.id === run.id) continue;
    if (other.run_number <= run.run_number) continue;
    if (Date.parse(other.created_at) > ended) continue;
    return { id: other.id, number: other.run_number, url: other.html_url };
  }
  return null;
}

/**
 * Le jugement, séparé de la lecture : trois natures de défaut, nommées, jamais confondues.
 *
 *  - `red`    : un job a échoué, été annulé ou coupé. C'est ce qu'on croyait surveiller.
 *  - `retried`: un test n'est passé qu'à la deuxième ou troisième tentative. Le job est VERT.
 *  - `full`   : un shard remplit son enveloppe. Rien n'est rouge, et c'est l'état d'avant.
 */
export function judge(run) {
  const red = [];
  const retried = [];
  const full = [];
  const unreadable = [];

  for (const job of run.jobs) {
    if (job.conclusion === 'skipped') continue;
    if (job.conclusion !== 'success')
      red.push({ job: job.name, conclusion: job.conclusion });
    const summary = job.summary;
    if (!summary) continue;
    if (summary.unreadable) {
      unreadable.push({ job: job.name, reason: summary.unreadable });
      continue;
    }
    for (const title of summary.flaky)
      retried.push({ job: job.name, test: title });
    for (const title of summary.failed)
      red.push({ job: job.name, test: title, conclusion: 'test failed' });
    for (const title of summary.timedOut)
      red.push({ job: job.name, test: title, conclusion: 'test timed out' });
    if (
      job.minutes !== null &&
      job.shard !== null &&
      job.minutes >= E2E_ENVELOPE_MINUTES * E2E_WARN_FRACTION
    )
      full.push({ job: job.name, minutes: job.minutes });
  }

  /**
   * UN RUN REMPLACÉ N'EST PAS UN RUN MALADE.
   *
   * `cancel-in-progress` annule le run de la fusion précédente dès qu'une autre arrive : tous ses
   * shards portent alors `cancelled`, aucun n'a échoué, et le verdict qui compte est celui du run
   * SUIVANT. Le condition est stricte — il faut qu'un run plus récent existe ET qu'AUCUN job
   * n'ait réellement échoué : un vrai échec survenu avant l'annulation reste un défaut, et il
   * serait scandaleux de le taire sous prétexte que le run a été coupé ensuite.
   */
  const onlyCancelled =
    run.supersededBy != null &&
    run.jobs.every(
      (job) =>
        job.conclusion === 'success' ||
        job.conclusion === 'skipped' ||
        job.conclusion === 'cancelled'
    );

  return {
    superseded: onlyCancelled,
    // UN JOURNAL ILLISIBLE REND LE RUN NON SAIN, et c'est le point. Sans cette condition, six
    // journaux injoignables et aucun job rouge auraient rendu « run SAIN » — c'est-à-dire
    // exactement le silence qui a fait passer deux runs rouges pour verts.
    healthy:
      onlyCancelled ||
      (red.length === 0 &&
        retried.length === 0 &&
        full.length === 0 &&
        unreadable.length === 0),
    red,
    retried,
    full,
    unreadable,
  };
}

function minutes(value) {
  return value === null ? '?' : `${value.toFixed(1)} min`;
}

function render(run, verdict, { markdown }) {
  const bullet = markdown ? '- ' : '  ';
  const out = [];
  const heading = markdown ? '### ' : '';
  out.push(
    `${markdown ? '## ' : ''}CI ${run.id} · ${run.conclusion} · ${run.title}`
  );
  out.push(`${bullet}commit ${run.sha.slice(0, 7)}, tentative ${run.attempt}`);
  out.push(`${bullet}${run.url}`);
  out.push('');

  out.push(`${heading}Jobs`);
  for (const job of run.jobs) {
    if (job.conclusion === 'skipped') continue;
    const counts = job.summary?.unreadable
      ? ' journal illisible'
      : job.summary
        ? ` ${job.summary.passed ?? '?'} passés` +
          (job.summary.flaky.length
            ? `, ${job.summary.flaky.length} au réessai`
            : '') +
          (job.summary.failed.length
            ? `, ${job.summary.failed.length} échoués`
            : '')
        : '';
    out.push(
      `${bullet}${job.name} — ${job.conclusion}, ${minutes(job.minutes)}${counts}`
    );
  }
  out.push('');

  if (verdict.red.length) {
    out.push(`${heading}Rouge`);
    for (const entry of verdict.red)
      out.push(
        `${bullet}${entry.job} — ${entry.conclusion}${entry.test ? ` : ${entry.test}` : ''}`
      );
    out.push('');
  }
  if (verdict.retried.length) {
    out.push(`${heading}Vert SEULEMENT grâce à un réessai`);
    out.push(
      `${bullet}Un test qui échoue puis passe rend le job vert. C'est le défaut le plus discret de cette CI.`
    );
    for (const entry of verdict.retried)
      out.push(`${bullet}${entry.job} : ${entry.test}`);
    out.push('');
  }
  if (verdict.full.length) {
    out.push(`${heading}Enveloppe presque pleine`);
    out.push(
      `${bullet}Seuil : ${(E2E_ENVELOPE_MINUTES * E2E_WARN_FRACTION).toFixed(0)} min sur les ${E2E_ENVELOPE_MINUTES} du garde-fou.`
    );
    for (const entry of verdict.full)
      out.push(`${bullet}${entry.job} — ${minutes(entry.minutes)}`);
    out.push('');
  }
  if (verdict.unreadable.length) {
    out.push(`${heading}Journaux illisibles`);
    for (const entry of verdict.unreadable)
      out.push(`${bullet}${entry.job} — ${entry.reason}`);
    out.push('');
  }

  out.push(
    verdict.superseded
      ? `VERDICT : run REMPLACÉ par le run ${run.supersededBy.number} ` +
          `(${run.supersededBy.url}), annulé par la règle de concurrence et non par une panne. ` +
          `Aucun job n'a échoué ; c'est le run suivant qui fait foi.`
      : verdict.healthy
        ? 'VERDICT : run SAIN (aucun job rouge, aucun réessai, aucune enveloppe pleine).'
        : 'VERDICT : run NON SAIN.'
  );
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const runArg = argv.indexOf('--run');
  const asJson = argv.includes('--json');
  const markdown = argv.includes('--markdown');

  let run;
  try {
    const id = runArg >= 0 ? argv[runArg + 1] : latestMainRun().id;
    if (!id) throw new Error('--run attend un identifiant de run');
    run = inspectRun(id);
    // UN RUN EN COURS NE SE JUGE PAS, ET NE SE DÉCLARE PAS NON SAIN POUR AUTANT. Mesuré : `gh run
    // view --job` refuse le journal d'un job POURTANT TERMINÉ tant que le run ne l'est pas
    // (« logs will be available when it is complete »), donc tous les journaux seraient illisibles.
    // C'est « je ne peux pas mesurer », pas « le run est mauvais » : code 2.
    if (run.conclusion === null)
      throw new Error(
        `le run ${run.id} est encore en cours : ses journaux ne sont pas servis avant la fin`
      );
  } catch (error) {
    // Ne JAMAIS confondre « je n'ai pas pu lire » avec « tout va bien » : c'est exactement le
    // silence qui a fait passer deux runs rouges pour verts.
    console.error(`MESURE IMPOSSIBLE : ${error?.message ?? error}`);
    process.exit(2);
  }

  const verdict = judge(run);
  console.log(
    asJson
      ? JSON.stringify({ run, verdict }, null, 2)
      : render(run, verdict, { markdown })
  );
  process.exit(verdict.healthy ? 0 : 1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
