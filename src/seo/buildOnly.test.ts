import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `src/seo/` NE DOIT JAMAIS ATTEINDRE LE BUNDLE CLIENT.
 *
 * Ce dossier existe pour le build : il fabrique les pages par corps, le sitemap et les
 * vignettes de partage. Il contient donc un rastériseur de sphère, un rastériseur de maillage
 * avec tampon de profondeur, un échantillonnage bilinéaire et des gabarits SVG — du code que
 * personne n'exécute dans un navigateur et que personne ne devrait télécharger. Un seul
 * `import` depuis `src/` suffirait à l'embarquer chez chaque visiteur.
 *
 * La règle était documentée et vérifiée À LA MAIN : `docs/ARCHITECTURE.md` et `CLAUDE.md`
 * disent tous deux « vérifier avec `grep renderSphere dist/assets/*.js` ». Un contrôle qu'il
 * faut penser à faire n'est pas un contrôle — c'est la même leçon que la vérification de ce
 * qui est réellement déployé, devenue une étape de CI le 2026-09-11.
 *
 * Ce test lit la SOURCE plutôt que le bundle : pas besoin d'avoir construit, et le message
 * d'échec nomme le fichier fautif au lieu d'un chunk minifié.
 */

const SRC = resolve(import.meta.dirname, '..');

/** Tous les fichiers TypeScript de `src/`, hors `src/seo/` et hors tests. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (full === join(SRC, 'seo')) continue;
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('isolation de src/seo', () => {
  const files = appSources();

  it('trouve bien les sources de l’application', () => {
    // Borne : un balayage vide rendrait tout le reste vert sans rien prouver — le mode
    // d'échec exact que ce dépôt a déjà payé ailleurs.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('SolarSystemApp.ts'))).toBe(true);
  });

  it('n’est importé par AUCUN module de l’application', () => {
    const guilty: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      // Couvre les trois écritures possibles : alias, relatif remontant, et import dynamique.
      if (/from\s+['"](@\/seo\/|\.{1,2}\/(\.\.\/)*seo\/)/.test(source))
        guilty.push(relative(SRC, file));
      if (/import\s*\(\s*['"](@\/seo\/|\.{1,2}\/(\.\.\/)*seo\/)/.test(source))
        guilty.push(relative(SRC, file));
    }
    expect(
      guilty,
      `ces modules importent src/seo, qui partirait alors dans le bundle client : ${guilty.join(', ')}`
    ).toEqual([]);
  });

  it('attrape vraiment un import fautif', () => {
    // Falsification intégrée : sans elle, ce test passerait aussi sur une regex cassée.
    const patterns = [
      `import { renderSphere } from '@/seo/socialCard';`,
      `import { renderShape } from '../seo/socialCard';`,
      `const card = await import('@/seo/socialCard');`,
    ];
    for (const line of patterns) {
      const matched =
        /from\s+['"](@\/seo\/|\.{1,2}\/(\.\.\/)*seo\/)/.test(line) ||
        /import\s*\(\s*['"](@\/seo\/|\.{1,2}\/(\.\.\/)*seo\/)/.test(line);
      expect(matched, `non détecté : ${line}`).toBe(true);
    }
    // Et l'inverse : un import légitime qui contient « seo » ailleurs ne doit pas mordre.
    expect(
      /from\s+['"](@\/seo\/|\.{1,2}\/(\.\.\/)*seo\/)/.test(
        `import { x } from '@/core/seoHelpers';`
      )
    ).toBe(false);
  });
});
