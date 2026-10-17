import { describe, expect, it } from 'vitest';
import { qualityProfile } from '@/core/qualityTier';
import { SOFTWARE_MAX_TILES, surfaceTileBudget } from './surfacePanel';

/**
 * LE BUDGET DE CARREAUX (lot 54) : 256 en rendu matériel au palier « haut » (le plancher au-dessus
 * de Paris passe de 733 à 183 m), borné à 64 en rendu LOGICIEL, où le processeur rastérise lui-même
 * et où la suite e2e de la CI tourne. Un palier déjà plus bas reste ce qu'il est.
 */
describe('budget de carreaux du moteur de surface', () => {
  const high = qualityProfile('high').surfaceTiles;
  const medium = qualityProfile('medium').surfaceTiles;

  it('le palier haut garde ses 256 carreaux en rendu matériel', () => {
    expect(surfaceTileBudget(high, false).maxTiles).toBe(256);
  });

  it('le rendu logiciel est borné, sans toucher aux chargements simultanés', () => {
    const budget = surfaceTileBudget(high, true);
    expect(budget.maxTiles).toBe(SOFTWARE_MAX_TILES);
    expect(budget.maxConcurrentLoads).toBe(high.maxConcurrentLoads);
  });

  it('un palier plus bas ne monte jamais', () => {
    expect(surfaceTileBudget(medium, true).maxTiles).toBe(medium.maxTiles);
    expect(surfaceTileBudget(medium, false).maxTiles).toBe(medium.maxTiles);
  });
});
