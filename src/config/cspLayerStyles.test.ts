import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LES COUCHES 2D NE FABRIQUENT PAS DE `<style>` (GAL-CSP-001). La CSP de production est
 * `style-src 'self'` : une feuille injectée par `document.createElement('style')` est refusée, et
 * la couche s'écrit hors de l'écran sans une erreur de test (le serveur de développement ne pose
 * aucune CSP). Leurs règles vivent dans des feuilles `.css` importées par le module différé, que
 * Vite sort avec son morceau. Les écritures CSSOM (`el.style.transform`, `style.cssText` des
 * panneaux de debug) restent permises : cette garde ne vise que les modules ci-dessous.
 */
const UI = join(import.meta.dirname, '..', 'ui');
const read = (name: string): string => readFileSync(join(UI, name), 'utf8');

const SKY_LAYERS = [
  'constellationNames.ts',
  'deepSkyLayer.ts',
  'meteorLayer.ts',
] as const;

describe('couches 2D et CSP style-src', () => {
  it.each([
    'skyLabels.ts',
    'satelliteLayer.ts',
    'formationMarker.ts',
    ...SKY_LAYERS,
  ])("%s n'injecte aucun <style>", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/createElement\(\s*['"]style['"]\s*\)/);
    expect(source).not.toMatch(/insertRule|adoptedStyleSheets/);
  });

  it('chaque module importe sa feuille externe', () => {
    expect(read('skyLabels.ts')).toContain("import './skyLabels.css'");
    expect(read('satelliteLayer.ts')).toContain(
      "import './satelliteLayer.css'"
    );
    expect(read('formationMarker.ts')).toContain(
      "import './formationMarker.css'"
    );
  });

  it('chaque couche de noms a ses règles dans skyLabels.css (une couche de plus sans CSS échoue)', () => {
    const css = read('skyLabels.css');
    for (const file of SKY_LAYERS) {
      const className = /className:\s*'([a-z-]+)'/.exec(read(file))?.[1];
      expect(className, file).toBeDefined();
      expect(css, `${file} : .${className}`).toMatch(
        new RegExp(String.raw`\.${className}(?![\w-])`)
      );
      expect(css, `${file} : .${className}-item`).toContain(
        `.${className}-item`
      );
    }
  });

  it('le canvas des satellites est fixe, plein écran, sous la capture', () => {
    const css = read('satelliteLayer.css');
    expect(css).toMatch(/#satellite-overlay\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/z-index:\s*21/);
    expect(css).toContain('body.is-capturing #satellite-overlay');
  });
});
