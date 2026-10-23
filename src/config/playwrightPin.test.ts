import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as {
  devDependencies: Record<string, string>;
};

/**
 * PLAYWRIGHT SE MONTE EN BLOC, ET SEULEMENT À UNE VERSION DONT LES SCÉNARIOS ONT ÉTÉ REJOUÉS.
 *
 * Payé le 2026-10-23 : un passage à 1.64.1 avait l'air anodin (`pnpm verify`, build, axe et pages
 * verts) et a mis `main` au rouge, parce que son Chromium embarqué casse deux scénarios de rendu
 * que seule la suite e2e complète rejoue. Puis, en revenant en arrière, `@axe-core/playwright`
 * s'est résolu contre `playwright-core` 1.64.1 (son pair n'était déclaré nulle part) et
 * `tsc` a refusé deux versions de `Page` mélangées.
 *
 * Cette garde ne dit pas « ne monte jamais » : elle refuse le MÉLANGE, et elle rend le pin
 * visible. Pour monter, changer les trois ensemble (et @axe-core/playwright si besoin) et rejouer les deux scénarios nommés dans
 * `.github/dependabot.yml`.
 */
describe('Playwright : une seule version, partout', () => {
  const deps = pkg.devDependencies;

  it('les trois paquets Playwright sont épinglés à la MÊME version exacte', () => {
    const versions = ['@playwright/test', 'playwright', 'playwright-core'].map(
      (name) => deps[name]
    );
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(versions).size).toBe(1);
  });

  it("le lockfile ne résout qu'UNE version de playwright-core (le pair d'axe compris)", () => {
    const lock = read('pnpm-lock.yaml');
    const resolved = new Set(
      [...lock.matchAll(/playwright-core@(\d+\.\d+\.\d+)/g)].map((m) => m[1])
    );
    expect([...resolved]).toEqual([deps['playwright-core']]);
  });

  it("Dependabot n'en remonte aucun tant que la limite est écrite, et la limite part de la version suivante", () => {
    const [major, minor] = deps['playwright']!.split('.').map(Number);
    const dependabot = read('.github/dependabot.yml');
    const floor = `>=${major}.${minor! + 1}.0`;
    for (const name of ['@playwright/test', 'playwright', 'playwright-core'])
      expect(dependabot).toMatch(
        new RegExp(`dependency-name: '?${name}'?\\s+versions: \\['${floor}'\\]`)
      );
  });
});
