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
 * Cause trouvée le même jour : sous 1.61.1 l'option `reducedMotion` de la configuration était
 * ignorée (la page voyait `no-preference`), sous 1.64.1 elle s'applique ; deux scénarios qui ont
 * besoin de mouvement imposent désormais `useAnimatedMotion()` (`e2e/motion.ts`). Le pin ne
 * bloque donc plus une montée, mais il garde toujours le MÉLANGE : les trois paquets à la même
 * version exacte, un seul `playwright-core` dans le lockfile (pair d'axe compris), et les quatre
 * montés ensemble par Dependabot.
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

  it('Dependabot les met à jour ENSEMBLE : un seul groupe nomme les quatre paquets', () => {
    const dependabot = read('.github/dependabot.yml');
    const group = /playwright:\s+patterns:([\s\S]*?)\n\s+safe-updates:/.exec(
      dependabot
    )?.[1];
    expect(
      group,
      'groupe « playwright » absent de dependabot.yml'
    ).toBeTruthy();
    for (const name of [
      '@playwright/test',
      'playwright',
      'playwright-core',
      '@axe-core/playwright',
    ])
      expect(group).toMatch(
        new RegExp(`- '?${name.replace('/', '\\/')}'?\\s*(\\n|$)`)
      );
  });
});
