import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LES VISITES NE SONT PAS DANS LE DÉMARRAGE (GAL-TOUR-SCALE-001).
 *
 * Le démarrage de l'application est la clôture des imports STATIQUES depuis son point d'entrée.
 * Avant ce lot, `MainSolarSystemApp` important `config/tourScripts` y faisait entrer toutes les
 * fiches ; chaque visite de plus coûtait environ 3 ko à tous les visiteurs. Ce test lit la SOURCE
 * (sans build) et nomme le fichier fautif : aucun module du démarrage n'atteint le registre des
 * visites ni leur façade exhaustive, et le lecteur ne les atteint que par `import()`.
 *
 * Le parcours ignore les `import type` (effacés à la compilation) et les `import()` (morceaux à la
 * demande) : c'est exactement ce que Rollup compte dans la clôture statique. La confirmation sur les
 * octets livrés est `pnpm budget:startup`, qui exige un morceau `tour-<id>` hors démarrage par fiche.
 */
const SRC = resolve(import.meta.dirname, '../..');
const ENTRY = join(SRC, 'MainSolarSystemApp.ts');

const STATIC_IMPORT =
  /(?:^|[\s;}])(?:import|export)\s+(?!type[\s{*])(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Les spécificateurs importés statiquement par une source (valeurs seulement). */
export function staticSpecifiers(source: string): string[] {
  return [...stripComments(source).matchAll(STATIC_IMPORT)].map((m) => m[1]!);
}

function resolveSpecifier(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (base === null) return null; // paquet ou module virtuel : hors du graphe du dépôt
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.json`,
    join(base, 'index.ts'),
  ])
    if (existsSync(candidate) && /\.(ts|json)$/.test(candidate))
      return candidate;
  return null;
}

/** La clôture statique depuis `entry`, lue par `read` (injectable pour la falsification). */
export function staticClosure(
  entry: string,
  read: (file: string) => string | null,
  resolver: (from: string, spec: string) => string | null = resolveSpecifier
): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.ts')) continue;
    const source = read(file);
    if (source === null) continue;
    for (const specifier of staticSpecifiers(source)) {
      const next = resolver(file, specifier);
      if (next) queue.push(next);
    }
  }
  return seen;
}

const TOURS_DIR = join(SRC, 'registry', 'tours');
const FACADE = join(SRC, 'config', 'tourScripts.ts');
const read = (file: string): string | null =>
  existsSync(file) ? readFileSync(file, 'utf-8') : null;

describe('le démarrage et les visites', () => {
  const closure = staticClosure(ENTRY, read);

  it('le parcours voit bien le démarrage (borne : un graphe vide prouverait tout)', () => {
    expect(closure.size).toBeGreaterThan(150);
    expect(closure.has(join(SRC, 'config', 'bodies.ts'))).toBe(true);
    expect(closure.has(join(SRC, 'ui', 'tourLaunchers.ts'))).toBe(true);
  });

  it('aucun module du démarrage n’atteint le registre des visites ni leur façade exhaustive', () => {
    const leaked = [...closure].filter(
      (file) => file === FACADE || file.startsWith(TOURS_DIR)
    );
    expect(leaked).toEqual([]);
  });

  it('le lecteur de visites n’est PAS dans le démarrage : il est importé par import()', () => {
    expect(closure.has(join(SRC, 'ui', 'tourPlayer.ts'))).toBe(false);
  });

  it('le parcours ignore les import type et les import() comme Rollup', () => {
    expect(
      staticSpecifiers(
        `import type { A } from './a';\nimport { b } from './b';\nconst c = import('./c');\nexport { d } from './d';\nexport type { E } from './e';\nimport './f';`
      )
    ).toEqual(['./b', './d', './f']);
  });

  it('FALSIFIÉ : un import statique de la façade depuis le démarrage est vu', () => {
    const fake = new Map<string, string>([
      [ENTRY, `import { TOUR_SCRIPTS } from './config/tourScripts';`],
      [FACADE, `import { loadTourScripts } from '@/registry/tours/all';`],
    ]);
    const files = staticClosure(
      ENTRY,
      (file) => fake.get(file) ?? null,
      (from, specifier) => {
        if (specifier === './config/tourScripts') return FACADE;
        if (specifier === '@/registry/tours/all')
          return join(TOURS_DIR, 'all.ts');
        return resolveSpecifier(from, specifier);
      }
    );
    expect(files.has(FACADE)).toBe(true);
    expect(files.has(join(TOURS_DIR, 'all.ts'))).toBe(true);
  });
});

describe('le lecteur de visites', () => {
  it('ne lit les fiches que par le catalogue dérivé et le chargeur différé', () => {
    const source = readFileSync(join(SRC, 'ui', 'tourPlayer.ts'), 'utf-8');
    const specs = staticSpecifiers(source);
    expect(specs).toContain('virtual:tour-catalogue');
    expect(specs).toContain('@/registry/tours/lazy');
    expect(specs).not.toContain('@/config/tourScripts');
    expect(specs).not.toContain('@/registry/tours/all');
  });
});
