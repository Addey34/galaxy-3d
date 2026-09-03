import { describe, expect, it } from 'vitest';
import { fragmentShader as atmosphereFragment } from './AtmosphereShader';
import { fragmentShader as nightLightsFragment } from './NightLightsShader';

/**
 * Un shader qui APPELLE une fonction partagée sans en INCLURE la définition ne casse pas au
 * build : il casse à la compilation GLSL, à l'exécution, dans la console — la couche
 * disparaît simplement. C'est exactement ce qui est arrivé à AtmosphereShader pendant cette
 * migration (l'import existait, la concaténation non), et seul le warning ESLint
 * « imported but never used » l'avait signalé, par chance.
 *
 * Ces tests rendent la règle explicite : appeler `terminatorX` oblige à embarquer
 * TERMINATOR_GLSL. Ils couvrent les shaders écrits à la main ; les matériaux patchés via
 * `onBeforeCompile` sont couverts par `config/layerConfig.test.ts`.
 */
describe('hand-written shaders using the shared terminator', () => {
  const shaders: Array<[string, string]> = [
    ['AtmosphereShader', atmosphereFragment],
    ['NightLightsShader', nightLightsFragment],
  ];

  for (const [name, source] of shaders) {
    it(`${name} defines every terminator function it calls`, () => {
      const called = new Set(
        [...source.matchAll(/\bterminator(Light|Day|Night)\s*\(/g)].map(
          (match) => `terminator${match[1]}`
        )
      );
      // Le shader doit réellement en utiliser une, sinon le test ne prouve rien.
      expect(called.size).toBeGreaterThan(0);
      for (const fn of called)
        expect(source).toContain(`float ${fn}( float raw`);
    });
  }
});
