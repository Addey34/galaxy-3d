import { test } from '@playwright/test';
import { diveByTapping } from './placeDiveFlow';
import { blockExternalNetwork } from './netBlock';

/**
 * LA PLONGÉE SUR UN LIEU NOMMÉ (lot 63, pas A), dans un vrai navigateur : cliquer un nom écrit sur
 * la surface fait voler la caméra jusqu'à la formation. Ce que le test unitaire de
 * `core/placeDive.ts` ne prouve pas : que le clic atteint le nom (et non le corps derrière lui,
 * dont la sélection relancerait son propre vol d'approche), et que la distance BAISSE vraiment.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('un clic sur un nom plonge sur la formation visée', async ({ page }) => {
  await diveByTapping(page, (x, y) => page.mouse.click(x, y));
});
