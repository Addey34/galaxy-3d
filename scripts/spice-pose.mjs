/* global console, process */
/**
 * L'OUTIL DE POSE SPICE (2026-10-06) : retrouve l'orientation d'un petit corps dans les images
 * d'une mission, depuis les noyaux SPICE, pour y draper une carte. La méthode et la raison du
 * choix de Python + spiceypy sont en tête de `scripts/spice-pose/posekit.py`.
 *
 *   node scripts/spice-pose.mjs fetch  eros-approach
 *   node scripts/spice-pose.mjs guard  eros-approach   # la garde : code 1 si elle rompt
 *   node scripts/spice-pose.mjs search <cible> [--model <corps>] [--poles N]
 *
 * Ce fichier ne fait que préparer l'environnement : un venv dans `.cache/spice-pose/venv`, aux
 * versions EXACTES de `scripts/spice-pose/requirements.txt` (recréé si la liste change), puis
 * `python -I`, qui n'importe rien du dossier courant (les images téléchargées sont des données).
 * Hors de `pnpm verify` et de la CI : il faut le réseau, des centaines de mégaoctets de noyaux
 * et plusieurs minutes de calcul.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENV = join(ROOT, '.cache/spice-pose/venv');
const REQ = join(ROOT, 'scripts/spice-pose/requirements.txt');
const STAMP = join(VENV, 'requirements.lock');
const py = join(
  VENV,
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);

const wanted = readFileSync(REQ, 'utf8');
if (
  !existsSync(py) ||
  !existsSync(STAMP) ||
  readFileSync(STAMP, 'utf8') !== wanted
) {
  const base =
    process.env.PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3');
  console.log(`préparation de l'environnement Python (${base})`);
  if (!existsSync(py))
    execFileSync(base, ['-m', 'venv', VENV], { stdio: 'inherit' });
  execFileSync(py, ['-m', 'pip', 'install', '-q', '-r', REQ], {
    stdio: 'inherit',
  });
  writeFileSync(STAMP, wanted);
}
// La recherche sature tous les cœurs pendant de longues minutes : `guard` relance une
// recherche complète par modèle (le vrai corps, puis chaque témoin). En priorité basse
// elle rend la main dès qu'un éditeur en demande, sans rien perdre quand la machine est
// libre. Les enfants héritent de la priorité, donc les workers `--jobs` aussi.
// SPICE_POSE_PRIORITY=normal pour retrouver le comportement d'avant.
if (process.env.SPICE_POSE_PRIORITY !== 'normal') {
  try {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // priorité non modifiable sur cette plateforme : on continue normalement
  }
}
const run = spawnSync(
  py,
  ['-I', join(ROOT, 'scripts/spice-pose/pose.py'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: ROOT }
);
process.exit(run.status ?? 1);
