import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { messages } from '@/i18n/allDictionaries';
import { LOCALES } from '@/i18n/locales';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * AUCUNE UNITÉ SI ÉCRITE EN DUR DANS LA FICHE (audit des panneaux, lot 1).
 *
 * Le bouton d'unités ne vaut que si TOUT passe par `core/units.ts`. Avant ce lot, des altitudes,
 * une résolution, une masse, un vent, une gravité et une densité restaient en « km », « kg »,
 * « m/s » quand la personne avait demandé l'impérial. Ce test lit le code de ces formateurs, sans
 * ses commentaires, et refuse une unité de longueur, de masse, de vitesse, d'accélération ou de
 * densité dans un texte littéral. Le kelvin, l'unité astronomique, le g/mol et le temps restent
 * permis : ils n'ont pas d'équivalent impérial (voir l'en-tête de `core/units.ts`).
 */
const FILES = [
  'src/ui/bodyInfo.ts',
  'src/ui/atmosphereBlock.ts',
  'src/ui/discoveryBlock.ts',
  'src/ui/surfacePanel.ts',
];

/** Les textes littéraux d'un fichier TypeScript : chaînes et morceaux fixes des gabarits. */
function literalsOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// Une unité SI de longueur, de masse, de vitesse ou de volume, comme mot d'un texte littéral.
const SI_UNIT =
  /(?:^|[\s\u00a0}])(?:km|kg|m\/s|m\/s²|kg\/m³|mm\/h|km\/h|mbar|bar|hPa)(?:$|[\s\u00a0.,;)])/;

describe('unités en dur dans la fiche', () => {
  it.each(FILES)('%s ne contient aucune unité SI littérale', (file) => {
    const literals = literalsOf(file).filter((text) => SI_UNIT.test(text));
    expect(literals).toEqual([]);
  });

  it('le gabarit « satellite réfuté » ne porte plus de kilomètres', () => {
    for (const locale of LOCALES) {
      const text = messages[locale]['bi.discovery.refutedSearched'];
      expect(text, locale).not.toMatch(/\bkm\b/);
      expect(text, locale).toContain('{radius}');
    }
  });
});
