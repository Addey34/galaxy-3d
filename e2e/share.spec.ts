import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page, context }) => {
  await blockExternalNetwork(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
  });
});

test('share button copies the current permalink and confirms with a toast', async ({
  page,
}) => {
  await page.goto('/?mode=explo&body=mars');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // navigator.share absent en Chromium desktop headless : le bouton retombe sur la
  // copie presse-papier, exactement le chemin qu'on veut couvrir ici.
  await page.locator('#share-btn').click();

  await expect(page.locator('#share-toast')).toBeVisible();

  const clipboardText = await page.evaluate(() =>
    navigator.clipboard.readText()
  );
  expect(clipboardText).toContain('mode=explo');
  expect(clipboardText).toContain('body=mars');
});
