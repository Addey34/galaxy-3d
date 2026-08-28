import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
  });
});

test('capture button downloads a PNG, shows a toast, and restores the UI', async ({
  page,
}) => {
  await page.goto('/?mode=explo&body=mars');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  const dock = page.locator('.dock--top-right');
  await expect(dock).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#capture-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);

  await expect(page.locator('#capture-toast')).toBeVisible();
  await expect(page.locator('#capture-toast')).toHaveText('Image downloaded');

  // Le chrome UI est restauré après la capture (is-capturing retiré).
  await expect(dock).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/is-capturing/);
});
