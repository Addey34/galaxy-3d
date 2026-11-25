import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { SOLAR, load, quiet } from './stellarAddressScenarios';

/**
 * L'EXPLORATION D'UN SYSTÈME au TOUCHER, sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit) émulés
 * (GAL-UNIVERSE-007, depuis le CIEL) : un lien ouvre le système, le volet tient sans rien déborder, un tap sur une ORBITE
 * (au point où la vue en pose le nom) choisit la planète, le retour rend le ciel. Hors CI :
 * `pnpm test:mobile` (docs/TESTING.md). Ce que cela NE prouve PAS : un vrai doigt sur un vrai écran, ni la
 * fluidité sur un vrai GPU de téléphone.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quiet(page);
});

test('un lien ouvre le système, un tap sur une orbite la choisit, sans débordement, et retour', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await load(page, `${SOLAR}&view=system&host=trappist-1`);
  const explorer = page.locator('#system-explorer');
  await expect(explorer).toBeVisible({ timeout: 90_000 });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const side = (await page.locator('#system-explorer .sv-side').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(side.x).toBeGreaterThanOrEqual(0);
  expect(side.x + side.width).toBeLessThanOrEqual(viewport.width + 1);

  // Le nom d'une orbite est posé SUR elle : un tap à ce point choisit la planète.
  const label = page
    .locator('#system-explorer [data-label^="planet-"]')
    .first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  const x = Number(await label.getAttribute('data-sx'));
  const y = Number(await label.getAttribute('data-sy'));
  const name = (await label.textContent()) ?? '';
  await page.touchscreen.tap(x, y);
  await expect(page.locator('#system-card-title')).toHaveText(name);

  await page.locator('#system-back').tap();
  await expect(explorer).toHaveCount(0);
  // Retour au ciel : la vue est retirée et l'adresse ne la porte plus.
  await expect(page.locator('#system-view')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('view')).toBeNull();
});
