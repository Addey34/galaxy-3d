/* global console, process */
/**
 * L'A/B DE PERFORMANCE D'UNE PR QUI TOUCHE AU RENDU (lot 56, piste 4).
 *
 * Deux builds servis sur deux origines (la base et la branche), mesurés par
 * `scripts/measure-perf.mjs --software` scène par scène, en ALTERNANCE sur la MÊME machine :
 * A B A B… GitHub sert des processeurs différents, et en rendu logiciel la même scène coûte du
 * simple au double de l'un à l'autre (piège « GitHub ne sert pas toujours le même processeur ») ;
 * deux runs simultanés sur deux machines mesureraient donc surtout la loterie du processeur.
 * L'alternance absorbe aussi une dérive lente de la machine (température, cache disque).
 *
 * Pour chaque scène et chaque grandeur, le rapport des MÉDIANES branche / base. Les grandeurs :
 *   - `steadyP50` : durée médiane d'une image au régime (ms) ;
 *   - `approachBlockedMs` : temps total des blocages du fil principal pendant l'approche (ms) ;
 *   - `driverMiB` : mémoire du pilote au régime (Mio, registre du lot 56).
 *
 * Le SEUIL ne se choisit pas : il se calibre en faisant tourner la base contre ELLE-MÊME
 * (`--origin-b` = `--origin-a`), sur plusieurs machines, et se lit dans
 * `src/config/perfAbThresholds.json` (écart mesuré et seuil, par grandeur). Code 1 sur une
 * régression au-delà du seuil.
 *
 * Usage :
 *   node scripts/perf-ab.mjs --origin-a http://localhost:4301 --origin-b http://localhost:4302 \
 *     --scenes overview,earth-explo --rounds 3 --json reports/perf-ab.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const METRICS = {
  steadyP50: (r) => r.steady.frames.p50Ms,
  approachBlockedMs: (r) => r.approach.longTasks.totalMs,
  driverMiB: (r) => (r.steady.driver ? r.steady.driver.total / 1048576 : NaN),
};

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Les seuils calibrés (`src/config/perfAbThresholds.json`). */
export const THRESHOLDS = JSON.parse(
  readFileSync(resolve(HERE, '../src/config/perfAbThresholds.json'), 'utf8')
).thresholds;

/**
 * Le verdict d'un rapport : `regression` au-dessus de 1 + seuil, `gain` au-dessous de 1 - seuil,
 * `noise` entre les deux ; `unmeasured` quand la grandeur manque d'un côté.
 */
export function verdict(name, ratio) {
  if (!Number.isFinite(ratio)) return 'unmeasured';
  const t = THRESHOLDS[name];
  if (ratio > 1 + t) return 'regression';
  if (ratio < 1 - t) return 'gain';
  return 'noise';
}

/** Les rapports branche / base des médianes, par scène et par grandeur. */
export function compare(samples) {
  const out = {};
  for (const [scene, { a, b }] of Object.entries(samples)) {
    out[scene] = {};
    for (const [name, read] of Object.entries(METRICS)) {
      const ma = median(a.map(read));
      const mb = median(b.map(read));
      out[scene][name] = {
        a: ma,
        b: mb,
        ratio: mb / ma,
        verdict: verdict(name, mb / ma),
      };
    }
  }
  return out;
}

function measure(origin, scene) {
  const file = resolve(tmpdir(), `perf-ab-${process.pid}-${Date.now()}.json`);
  execFileSync(
    process.execPath,
    [
      resolve(HERE, 'measure-perf.mjs'),
      '--software',
      '--origin',
      origin,
      '--only',
      scene,
      '--json',
      file,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  const result = JSON.parse(readFileSync(file, 'utf8')).results[0];
  rmSync(file, { force: true });
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const originA = flag('--origin-a');
  const originB = flag('--origin-b', originA);
  const scenes = flag('--scenes', 'overview,earth-explo').split(',');
  const rounds = Number(flag('--rounds', '3'));
  const json = flag('--json', null);
  const samples = Object.fromEntries(scenes.map((s) => [s, { a: [], b: [] }]));
  for (let round = 0; round < rounds; round += 1)
    for (const scene of scenes) {
      // L'ordre alterne d'un tour à l'autre : A B, puis B A.
      const order = round % 2 === 0 ? ['a', 'b'] : ['b', 'a'];
      for (const side of order)
        samples[scene][side].push(
          measure(side === 'a' ? originA : originB, scene)
        );
    }
  const ratios = compare(samples);
  for (const [scene, metrics] of Object.entries(ratios))
    for (const [name, { a, b, ratio, verdict: v }] of Object.entries(metrics))
      console.log(
        `${scene.padEnd(14)} ${name.padEnd(18)} base ${a.toFixed(1)}  branche ${b.toFixed(1)}  rapport ${ratio.toFixed(3)}  ${v === 'regression' ? 'RÉGRESSION' : v === 'gain' ? 'gain' : v === 'noise' ? 'dans le bruit' : 'non mesuré'} (seuil ${(THRESHOLDS[name] * 100).toFixed(1)} %)`
      );
  if (json) {
    mkdirSync(dirname(resolve(json)), { recursive: true });
    writeFileSync(
      resolve(json),
      `${JSON.stringify({ originA, originB, rounds, ratios, samples }, null, 2)}\n`
    );
  }
}
