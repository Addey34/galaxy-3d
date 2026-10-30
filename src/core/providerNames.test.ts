import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROVIDER_NAMES } from './providerNames';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

/**
 * UN NOM PAR FOURNISSEUR (audit des panneaux, B5). Les modules qui affichent le nom d'une
 * source le lisent dans le registre : un nom écrit en dur à côté est une variante de plus.
 */
const DISPLAYING_MODULES = [
  'src/core/galaxyData.ts',
  'src/core/galaxyDataClient.ts',
  'src/core/earthEventLayers.ts',
  'src/ui/meteoModelLayer.ts',
];

// Les noms du registre et les variantes que l'audit a relevées.
const FORBIDDEN = new Set<string>([
  ...Object.values(PROVIDER_NAMES),
  'ERA5',
  'EONET',
  'NOAA NCEP GFS',
  'NASA Earth Observatory (EONET)',
]);

function literals(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('registre des noms de fournisseurs', () => {
  it.each(DISPLAYING_MODULES)('%s ne code aucun nom en dur', (file) => {
    expect(literals(file).filter((text) => FORBIDDEN.has(text))).toEqual([]);
  });

  it('les attributions des panneaux portent les noms du registre', () => {
    const html = read('index.html');
    const weather = html.slice(
      html.indexOf('wl-attribution'),
      html.indexOf('</p>', html.indexOf('wl-attribution'))
    );
    const events = html.slice(
      html.indexOf('ee-attribution'),
      html.indexOf('</p>', html.indexOf('ee-attribution'))
    );
    for (const name of [
      PROVIDER_NAMES.gfs,
      PROVIDER_NAMES.era5,
      PROVIDER_NAMES.openMeteo,
    ])
      expect(weather, name).toContain(name);
    expect(events).toContain(PROVIDER_NAMES.eonet);
    expect(events).toContain('U.S. Geological Survey');
  });

  it('les libellés des cases d’événements portent les noms du registre', () => {
    const dict = read('src/i18n/dict-en.ts');
    expect(dict).toContain(`Earthquakes (${PROVIDER_NAMES.usgs})`);
    expect(dict).toContain(`Natural events (${PROVIDER_NAMES.eonet})`);
  });
});
