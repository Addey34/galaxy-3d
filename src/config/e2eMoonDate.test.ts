import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AUCUN SCÉNARIO NE DÉMARRE SUR LA LUNE À LA DATE COURANTE (ligne 44.2).
 *
 * La scène lunaire change avec la date : certains jours la Terre est dans le champ derrière la
 * Lune et double le coût d'une image en rendu logiciel, ce qui a rendu `main` rouge le
 * 2026-10-01 sans qu'un octet du produit change. Le contrat et ses mesures vivent dans
 * `e2e/moonScene.ts`. Cette garde tient la règle pour les scénarios à venir : un démarrage sur la
 * Lune (`/moon/`, `?body=moon`) doit citer `MOON_SCENE_DATE` sur la même ligne.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const E2E = join(ROOT, 'e2e');

/**
 * Une CHAÎNE qui désigne une page lunaire : un chemin `/moon/…` (ou `moon/…`) au début d'un
 * littéral, ou une requête qui porte `body=moon`. Sur la chaîne et non sur l'appel : un démarrage
 * écrit sur plusieurs lignes, comme Prettier les met en forme, échapperait sinon à la garde. Les
 * chemins d'actifs (`/assets/…/moon/…`) ne commencent pas par `moon/` et ne sont pas concernés.
 */
const MOON_PAGE = /(['"`])(\/?moon\/[^'"`]*|[^'"`]*[?&]body=moon\b[^'"`]*)\1/g;

export function undatedMoonBoots(source: string): number[] {
  return (
    source
      .split('\n')
      .map((line, k) => ({ line, k: k + 1 }))
      // Un commentaire qui CITE une page, ou une assertion sur le chemin d'une page déjà ouverte
      // (`toBe('/moon/')`), ne démarre rien.
      .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .filter(({ line }) => !/\.(toBe|toMatch|toContain)\(/.test(line))
      .filter(({ line }) =>
        [...line.matchAll(MOON_PAGE)].some(
          (m) => !m[2]!.includes('MOON_SCENE_DATE')
        )
      )
      .map(({ k }) => k)
  );
}

describe('scènes lunaires de la suite e2e', () => {
  it('reconnaît les deux formes de démarrage, datées ou non (témoin)', () => {
    expect(undatedMoonBoots("await page.goto('/moon/');")).toEqual([1]);
    expect(undatedMoonBoots("await boot(page, '?body=moon');")).toEqual([1]);
    expect(
      undatedMoonBoots('await boot(page, `moon/?date=${MOON_SCENE_DATE}`);')
    ).toEqual([]);
    // Écrit sur plusieurs lignes, la chaîne seule suffit à le reconnaître.
    expect(
      undatedMoonBoots("    '?debug-surface&mode=explo&body=moon'")
    ).toEqual([1]);
    expect(
      undatedMoonBoots("route('**/assets/place-observations/moon/*.json'")
    ).toEqual([]);
    expect(undatedMoonBoots(' * Sur `?body=moon` la couche des noms')).toEqual(
      []
    );
    expect(
      undatedMoonBoots("expect(new URL(page.url()).pathname).toBe('/moon/');")
    ).toEqual([]);
    // Une autre lune ou une fiche qui cite la Lune sans y démarrer n'est pas concernée.
    expect(undatedMoonBoots("await page.goto('/moons/');")).toEqual([]);
    expect(
      undatedMoonBoots("await page.locator('#orbit-moon').click();")
    ).toEqual([]);
  });

  it('date chaque démarrage sur la Lune', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(E2E).filter((f) => f.endsWith('.ts')))
      for (const line of undatedMoonBoots(
        readFileSync(join(E2E, file), 'utf-8')
      ))
        offenders.push(`e2e/${file}:${line}`);
    expect(offenders).toEqual([]);
  });
});
