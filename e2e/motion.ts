import { test } from '@playwright/test';

/**
 * Un scénario qui a BESOIN de mouvement (vol de caméra, glissement d'échelle, zoom amorti) :
 * à appeler dans un `test.describe`, avant ses tests.
 *
 * `playwright.config.ts` demande `reducedMotion: 'reduce'`. Mesuré le 2026-10-23 : sous
 * Playwright 1.61.1 l'option n'est pas reconnue et la page voit `no-preference` ; sous 1.64.1
 * (Chromium 156) elle s'applique, vols et morph deviennent instantanés, et deux scénarios
 * rougissent (le drapeau `data-scene-moving` ne monte jamais, le plancher de Mars reste à
 * 1,0121 R). Il faut les DEUX formes :
 *   - `reducedMotion` au niveau de `use` est la seule que la 1.64 honore ici (`contextOptions`
 *     seul y échoue, 4 fois sur 4), mais elle n'existe pas dans les types de la 1.61 ;
 *   - `contextOptions` est celle que connaît la 1.61.
 * D'où le transtypage : il disparaît quand le pin de Playwright (`playwrightPin.test.ts`)
 * passe à une version qui type l'option.
 */
export function useAnimatedMotion(): void {
  test.use({
    reducedMotion: 'no-preference',
    contextOptions: { reducedMotion: 'no-preference' },
  } as Parameters<typeof test.use>[0]);
}
