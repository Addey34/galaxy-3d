import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * GAL-PERF-001A : capture, hors ligne, visites et VR sont chargés À LA DEMANDE. Cette garde lit les
 * sources : la racine de composition n'importe plus statiquement leurs modules lourds (sinon ils
 * rentrent de nouveau dans la clôture du démarrage), et chaque lanceur les importe dynamiquement.
 * Falsifiée : réintroduire `import { setupCapture } from './ui/capture'` dans `MainSolarSystemApp.ts`
 * fait échouer la première assertion.
 */
const read = (p: string): string => readFileSync(p, 'utf8');
const main = read('src/MainSolarSystemApp.ts');

const HEAVY = ['capture', 'offlineData', 'webxr', 'guidedTour', 'tourPlayer'];

describe('chargement différé du démarrage', () => {
  it.each(HEAVY)(
    'MainSolarSystemApp n’importe pas statiquement ui/%s',
    (name) => {
      const staticImport = new RegExp(
        `^import (?!type)[^;]*from '[.]/ui/${name}';`,
        'm'
      );
      expect(main).not.toMatch(staticImport);
    }
  );

  it.each([
    ['captureButton', 'capture'],
    ['offlineDataLauncher', 'offlineData'],
    ['webxrLauncher', 'webxr'],
    ['tourLaunchers', 'guidedTour'],
    ['tourLaunchers', 'tourPlayer'],
  ])('le lanceur %s importe ./%s dynamiquement', (launcher, target) => {
    const src = read(`src/ui/${launcher}.ts`);
    expect(src).toContain(`import('./${target}')`);
    expect(src).not.toMatch(
      new RegExp(`^import (?!type)[^;]*from '[.]/${target}';`, 'm')
    );
  });

  it('les lanceurs disent un échec de chargement au lieu de le taire', () => {
    for (const f of [
      'captureButton',
      'offlineDataLauncher',
      'webxrLauncher',
      'tourLaunchers',
    ])
      expect(read(`src/ui/${f}.ts`)).toContain("t('feature.loadFailed')");
  });

  it('WebXR : la session est demandée avant tout await, pour garder le geste utilisateur', () => {
    const src = read('src/ui/webxrLauncher.ts');
    const request = src.indexOf('requestSession(');
    const awaited = src.indexOf('await attach()');
    expect(request).toBeGreaterThan(0);
    expect(awaited).toBeGreaterThan(request);
  });
});
