import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LE SCRIPT QUI LIT OVERTURE CLASSE SES HAUTEURS SANS RÉSEAU (lot 63, C.6).
 *
 * `scripts/overture-buildings.py` décide d'où vient la hauteur de chaque bâtiment (lidar, saisie,
 * déduite des étages, absente) et mesure le facteur par étage. Sa classification est une fonction
 * pure avec un auto-contrôle sans DuckDB ni réseau, que ce test lance : un changement qui rangerait
 * une hauteur saisie sous « mesurée », ou déduirait une hauteur sous le seuil de paires, le rend rouge.
 * Aucun interpréteur Python trouvé est un ÉCHEC, jamais un test sauté en silence.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'overture-buildings.py');

function runSelfTest(): { interpreter: string; stdout: string } | null {
  for (const interpreter of ['python3', 'python', 'py']) {
    const run = spawnSync(interpreter, ['-I', SCRIPT, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (run.status === 0) return { interpreter, stdout: run.stdout };
  }
  return null;
}

describe('overture-buildings.py', () => {
  it('passe son auto-contrôle : méthodes de hauteur et seuil de paires, sans réseau', () => {
    const result = runSelfTest();
    expect(result, 'aucun interpréteur Python utilisable').not.toBeNull();
    expect(result!.stdout).toContain('auto-contrôle ok');
  });
});
