import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ZOD NE DOIT JAMAIS ATTEINDRE LE BUNDLE CLIENT.
 *
 * Le lot 7 valide les registres avec Zod, et cette validation a été choisie en `devDependency`
 * précisément parce qu'elle coûte ZÉRO octet livré : elle tourne en CI, dans les tests et au
 * serveur de dev, jamais dans le navigateur (`docs/private/REGISTRES_LOT7.md` § 5, décision D1).
 * Une promesse de ce genre ne tient que si quelque chose la vérifie : un seul `import` de valeur
 * depuis `src/` suffirait à embarquer Zod chez chaque visiteur, sans qu'aucun test ne rougisse et
 * sans qu'aucune page ne change.
 *
 * Même famille que `src/seo/buildOnly.test.ts`, et même raison : la règle était jusqu'ici une
 * phrase dans un document. Deux contrôles, dont le premier suffit :
 *
 *   1. AUCUN module de l'application n'importe `zod` comme valeur, ni `src/registry/schema/`
 *      autrement que par `import type` (qui s'efface à la compilation). Ce contrôle lit la
 *      SOURCE : il n'a pas besoin d'un build et nomme le fichier fautif ;
 *   2. si un `dist/` existe, aucun morceau livré ne porte la marque de Zod. C'est la confirmation
 *      sur les octets réellement servis ; elle est ignorée quand rien n'a été construit, parce
 *      qu'un test qui échoue faute de build serait désactivé dans la semaine.
 */

const SRC = resolve(import.meta.dirname, '../..');
const DIST_ASSETS = resolve(SRC, '../dist/assets');

/** Le seul dossier autorisé à importer Zod : le schéma lui-même, jamais livré. */
const SCHEMA_DIR = join(SRC, 'registry', 'schema');

/** Import de VALEUR de `zod` (les imports de type, eux, disparaissent à la compilation). */
const VALUE_IMPORT_ZOD =
  /(?:^|[\s;}])import\s+(?!type\s)[^;]*?from\s*['"]zod(?:\/[^'"]*)?['"]|import\s*\(\s*['"]zod(?:\/[^'"]*)?['"]|require\s*\(\s*['"]zod(?:\/[^'"]*)?['"]/;

/** Import de VALEUR du dossier de schémas, qui tirerait Zod avec lui. */
const VALUE_IMPORT_SCHEMA =
  /(?:^|[\s;}])import\s+(?!type\s)[^;]*?from\s*['"](?:@\/registry\/schema\/|\.{1,2}\/(?:\.\.\/)*schema\/)|import\s*\(\s*['"](?:@\/registry\/schema\/|\.{1,2}\/(?:\.\.\/)*schema\/)/;

/**
 * Les commentaires sont retirés AVANT l'analyse. Sans cela, le mot « import » écrit dans une
 * phrase de documentation servait d'amorce et le motif enjambait jusqu'à l'`import type` suivant :
 * `providers/index.ts` était accusé à tort, alors qu'il fait exactement ce qu'il faut. Trouvé en
 * lançant le test, pas en le relisant.
 *
 * Seules les lignes COMMENÇANT par `//` sont traitées comme des commentaires de ligne : un `//`
 * au milieu d'une ligne appartient presque toujours à une URL.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Modules de l'application : tout `src/`, hors tests et hors le dossier de schémas. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (full === SCHEMA_DIR) continue;
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('isolation de zod', () => {
  const files = appSources();

  it('trouve bien les sources de l’application', () => {
    // Borne : un balayage vide rendrait tout le reste vert sans rien prouver.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('SolarSystemApp.ts'))).toBe(true);
    expect(
      files.some((f) => f.endsWith(join('registry', 'providers', 'index.ts')))
    ).toBe(true);
  });

  it('n’est importé comme valeur par AUCUN module de l’application', () => {
    const guilty: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf-8'));
      if (VALUE_IMPORT_ZOD.test(source))
        guilty.push(`${relative(SRC, file)} (zod)`);
      if (VALUE_IMPORT_SCHEMA.test(source))
        guilty.push(`${relative(SRC, file)} (registry/schema)`);
    }
    expect(
      guilty,
      `ces modules embarqueraient zod dans le bundle client ; n’en prendre que le TYPE (import type) : ${guilty.join(', ')}`
    ).toEqual([]);
  });

  it('attrape vraiment un import fautif, et laisse passer un import de type', () => {
    // Falsification intégrée : sans elle, ce test passerait aussi sur une regex cassée.
    for (const line of [
      `import { z } from 'zod';`,
      `import { z } from 'zod/v4';`,
      `const { z } = await import('zod');`,
      `import { providerSchema } from '../schema/provider';`,
      `import { providerSchema } from '@/registry/schema/provider';`,
    ]) {
      expect(
        VALUE_IMPORT_ZOD.test(line) || VALUE_IMPORT_SCHEMA.test(line),
        `non détecté : ${line}`
      ).toBe(true);
    }
    for (const line of [
      `import type { ProviderRecord } from '../schema/provider';`,
      `import type { z } from 'zod';`,
      `import { ZOD_LIKE } from '@/core/zodiac';`,
    ]) {
      expect(
        VALUE_IMPORT_ZOD.test(line) || VALUE_IMPORT_SCHEMA.test(line),
        `faux positif : ${line}`
      ).toBe(false);
    }
  });

  /**
   * Marques que Zod laisse même minifié : ses noms de PROPRIÉTÉ, qu'aucun minifieur ne renomme
   * sans casser l'accès (`_zod` est la propriété interne de chaque schéma, `$ZodError` le nom
   * de sa classe d'erreur, repris tel quel dans des chaînes).
   */
  const ZOD_MARKERS = ['_zod', '$ZodError', 'toJSONSchema'];

  it('n’apparaît dans aucun morceau livré (si un build existe)', () => {
    let chunks: string[];
    try {
      chunks = readdirSync(DIST_ASSETS).filter((n) => n.endsWith('.js'));
    } catch {
      return; // pas de build ici : le contrôle sur la source ci-dessus fait foi.
    }
    expect(chunks.length).toBeGreaterThan(0);
    const guilty: string[] = [];
    for (const chunk of chunks) {
      const code = readFileSync(join(DIST_ASSETS, chunk), 'utf-8');
      for (const marker of ZOD_MARKERS)
        if (code.includes(marker)) guilty.push(`${chunk} : ${marker}`);
    }
    expect(
      guilty,
      `zod semble livré dans dist/assets : ${guilty.join(', ')}`
    ).toEqual([]);
  });
});
