import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import { formatFixed, formatInteger, formatPercent } from './localNumber';

const UI = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Appels `.toFixed(` PERMIS dans `src/ui` : la valeur n'est pas lue par une personne
 * (attribut `data-*`, clé de cache, largeur CSS, test numérique) ou le fichier est une sonde de
 * débogage. Tout autre texte visible passe par `localNumber.ts` : `toFixed` écrit un point
 * décimal en français, en espagnol et en portugais (audit des panneaux, A4).
 */
const ALLOWED = new Set([
  'atmosphereBlock.ts', // `Number(mantissa.toFixed(1)) >= 10` : test de report, jamais affiché
  'loader.ts', // largeur CSS en %
  'lookAtFormation.ts', // clé de cache
  'placeDive.ts', // attribut data-*
  'surfacePanel.ts', // attributs data-*
  'surfaceProbe.ts', // sonde de mesure
]);

function toFixedCalls(file: string): number {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(UI, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toFixed'
    )
      count++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

describe('nombres localisés dans l’interface', () => {
  beforeEach(() => {
    // `setLocale` écrit `<html lang>` ; l'environnement de test n'a pas de DOM.
    vi.stubGlobal('document', { documentElement: {} });
  });

  afterEach(async () => {
    await setLocale('en');
    vi.unstubAllGlobals();
  });

  it('aucun toFixed dans src/ui hors liste permise et sondes', () => {
    const offenders = readdirSync(UI)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => !/Debug\.ts$/.test(f) && !ALLOWED.has(f))
      .filter((f) => toFixedCalls(f) > 0);
    expect(offenders).toEqual([]);
  });

  it('suit la langue : virgule en français, point en anglais', async () => {
    await setLocale('en');
    expect(formatFixed(1, 2)).toBe('1.00');
    expect(formatInteger(12345)).toBe('12,345');
    await setLocale('fr');
    expect(formatFixed(1, 2)).toBe('1,00');
    expect(formatInteger(12345)).toMatch(/^12\s345$/u);
    expect(formatPercent(0.41)).toMatch(/^41\s%$/u);
    await setLocale('en');
    expect(formatPercent(0.41)).toBe('41%');
  });
});
