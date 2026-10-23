#!/usr/bin/env node
/* global console, process */
/**
 * LE GUETTEUR DE DÉRIVE DES DONNÉES GÉNÉRÉES.
 *
 * Les générateurs qui lisent une source du monde (gazetteer de l'UAI, registre du PDS, Horizons,
 * archive de Galileo…) savent chacun comparer ce qui est livré à ce que la source sert
 * aujourd'hui : `--check`. Personne ne les lançait, si bien que la dérive du 2026-10-23 (un
 * nouveau nom UAI, deux noms d'instruments corrigés, le type de Dimorphos, deux lignes
 * divergentes pour Hayabusa) n'a été vue que parce qu'un audit les a rejoués à la main.
 *
 * TROIS verdicts par générateur, et le troisième est le piège : un `--check` sort en code 1
 * aussi bien pour une VRAIE dérive que pour un plantage (Horizons en HTTP 500, un registre qui
 * rend deux lignes divergentes). Les confondre ferait ouvrir « les données ont dérivé » quand
 * c'est la source qui est muette, et le remède n'est pas le même.
 *   - à jour       code 0 ;
 *   - DÉRIVÉ       code ≠ 0, la sortie le dit, aucune trace de plantage : relancer le
 *                  générateur sans `--check` et relire le diff ;
 *   - NON MESURÉ   plantage ou délai dépassé : « je n'ai pas pu mesurer » n'est pas « tout va
 *                  bien » (même règle que `check-source-health.mjs`).
 *
 * Codes de sortie : 0 tout est à jour ; 1 au moins une dérive ; 2 rien n'a dérivé mais au moins
 * un générateur n'a pas pu être mesuré. Aucun fichier du dépôt n'est modifié : `--check` ne
 * touche à rien.
 *
 * Usage : node scripts/check-data-drift.mjs [--markdown] [--only <fragment>]
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Les générateurs sondés. Chaque `script` est une entrée de `package.json` qui accepte `--check`. */
export const DRIFT_GENERATORS = [
  {
    id: 'gazetteer',
    script: 'gazetteer:generate',
    about: 'noms de la surface (UAI)',
  },
  {
    id: 'missions',
    script: 'missions:generate',
    about: 'missions par corps (PDS)',
  },
  {
    id: 'instruments',
    script: 'instruments:generate',
    about: 'instruments des sondes (PDS)',
  },
  {
    id: 'atmosphere',
    script: 'atmosphere:generate',
    about: 'profil mesuré de Jupiter (Galileo)',
  },
  {
    id: 'discovery',
    script: 'discovery:generate',
    about: 'découvertes (JPL, SBDB, NSSDCA)',
  },
  { id: 'flybys', script: 'flybys:generate', about: 'survols (Horizons)' },
  {
    id: 'orbits',
    script: 'orbits:generate',
    about: 'mises en orbite (Horizons)',
  },
  {
    id: 'contacts',
    script: 'contacts:generate',
    about: 'contacts avec un corps (Horizons)',
  },
  {
    id: 'perihelia',
    script: 'perihelia:generate',
    about: 'périhélies (Horizons)',
  },
];

const PER_GENERATOR_TIMEOUT_MS = 25 * 60 * 1000;

/**
 * Le verdict d'UNE exécution. Pure : c'est elle que les tests confrontent à des sorties RÉELLES.
 * @param {number|null} code code de sortie, `null` quand le délai a été dépassé
 * @param {string} output sortie standard et d'erreur réunies
 * @returns {'ok' | 'drift' | 'unmeasured'}
 */
export function classify(code, output) {
  if (code === 0) return 'ok';
  if (code === null) return 'unmeasured';
  // Une trace de plantage (« Error: … » ou une ligne « at … ») : la source n'a pas répondu, ou a
  // répondu quelque chose que le générateur refuse de trancher. Ce n'est pas une dérive mesurée.
  if (/^\s*\w*Error\b/m.test(output) || /^\s+at\s/m.test(output))
    return 'unmeasured';
  if (/d[ée]riv/i.test(output)) return 'drift';
  return 'unmeasured';
}

/** Les dernières lignes utiles d'une sortie, sans la ligne de bruit du gestionnaire de paquets. */
export function excerpt(output, lines = 6) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line && !line.startsWith('[ELIFECYCLE]') && !line.startsWith('$ ')
    )
    .slice(0, lines)
    .join('\n');
}

function runGenerator({ script }) {
  const run = spawnSync('pnpm', [script, '--check'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: PER_GENERATOR_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  const timedOut = run.error?.code === 'ETIMEDOUT';
  const code = timedOut ? null : (run.status ?? 1);
  return { verdict: classify(code, output), output };
}

function main() {
  const args = process.argv.slice(2);
  const markdown = args.includes('--markdown');
  const only = args.includes('--only')
    ? args[args.indexOf('--only') + 1]
    : null;
  const chosen = DRIFT_GENERATORS.filter((g) => !only || g.id.includes(only));
  if (chosen.length === 0) {
    console.error(`aucun générateur ne correspond à « ${only} »`);
    process.exit(2);
  }

  const results = chosen.map((g) => ({ ...g, ...runGenerator(g) }));
  const drift = results.filter((r) => r.verdict === 'drift');
  const unmeasured = results.filter((r) => r.verdict === 'unmeasured');
  const ok = results.filter((r) => r.verdict === 'ok');

  const lines = [];
  lines.push(
    markdown
      ? `## Dérive des données générées : ${ok.length} à jour, ${drift.length} dérivées, ${unmeasured.length} non mesurées (sur ${results.length})`
      : `DONNÉES : ${ok.length} à jour, ${drift.length} dérivées, ${unmeasured.length} non mesurées (sur ${results.length})`
  );
  const section = (title, rows, advice) => {
    if (rows.length === 0) return;
    lines.push('', markdown ? `### ${title}` : title, '', advice, '');
    for (const r of rows) {
      lines.push(
        markdown
          ? `- **${r.id}** (${r.about}), \`pnpm ${r.script} --check\``
          : `  ${r.id} : ${r.about}`
      );
      lines.push(
        markdown ? '  ```' : '',
        ...excerpt(r.output)
          .split('\n')
          .map((l) => `  ${l}`)
      );
      if (markdown) lines.push('  ```');
    }
  };
  section(
    'Dérivées',
    drift,
    'La source sert autre chose que ce qui est livré. Relancer le générateur SANS `--check`, relire le diff, puis `pnpm search:generate` et `pnpm fingerprint:generated --write` (commit séparé).'
  );
  section(
    'Non mesurées',
    unmeasured,
    'Le générateur a planté ou dépassé son délai : la source est muette ou sert une réponse qu’il refuse de trancher. Ce n’est PAS « tout va bien ».'
  );
  if (ok.length > 0)
    lines.push('', `À jour : ${ok.map((r) => r.id).join(', ')}.`);
  console.log(lines.join('\n'));

  process.exit(drift.length > 0 ? 1 : unmeasured.length > 0 ? 2 : 0);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
