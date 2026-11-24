import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { SOLAR, load, quiet } from './stellarAddressScenarios';

/**
 * La VISITE GUIDÉE du voisinage solaire au TOUCHER, sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit)
 * émulés (GAL-UNIVERSE-005) : un lien ouvre l'arrêt demandé, le panneau tient à 390 px sans rien déborder,
 * un tap avance, quitte, reprend. Hors CI : `pnpm test:mobile` (docs/TESTING.md). Ce que cela NE prouve
 * PAS : un vrai doigt sur un vrai écran, ni la fluidité du glissement de caméra sur un vrai GPU.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quiet(page);
});

test('un lien ouvre la visite, un tap avance, quitte et reprend, sans débordement', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await load(page, `${SOLAR}&view=neighbourhood&visit=neighbours&step=1`);
  const panel = page.locator('#stellar-visit');
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#stellar-visit-progress')).toHaveText(
    'Stop 2 of 7'
  );
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('#stellar-visit-next').tap();
  await expect(page.locator('#stellar-visit-progress')).toHaveText(
    'Stop 3 of 7'
  );
  await page.locator('#stellar-visit-leave').tap();
  await page.locator('#stellar-visit-resume').tap();
  await expect(page.locator('#stellar-visit-progress')).toHaveText(
    'Stop 3 of 7'
  );
  await page.locator('#stellar-back').tap();
  await expect(page.locator('#stellar-view')).toHaveCount(0);
  await expect(panel).toHaveCount(0);
});
