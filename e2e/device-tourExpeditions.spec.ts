import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import {
  EXPEDITIONS,
  boot,
  expectContextRestored,
  playToEnd,
  quietEnglish,
} from './tourExpeditionScenarios';

/**
 * Les grandes expéditions sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit) émulés
 * (GAL-TOUR-EXCELLENCE-002), avec le mouvement réduit de la configuration. Hors CI :
 * `pnpm test:mobile`. Ce que cela NE prouve PAS : le toucher réel, la mémoire d'un téléphone physique.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quietEnglish(page);
});

for (const id of EXPEDITIONS) {
  test(`${id} : jouée en entier, inspection fermée par Échap, contexte rendu`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await boot(page, id);
    const { captions, inspections } = await playToEnd(page);
    expect(captions).toBeGreaterThanOrEqual(5);
    expect(inspections).toBe(1);
    await expectContextRestored(page);
  });
}
