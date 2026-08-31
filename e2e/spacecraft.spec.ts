import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  // Évite que le tour d'accueil première-visite n'intercepte les clics sur les boutons de mode.
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('spacecraft overlay is present, hidden in educ, shown in explo within mission coverage', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?date=2020-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const overlay = page.locator('#spacecraft-overlay');
  await expect(overlay).toHaveCount(1);
  await expect(overlay).not.toHaveClass(/is-visible/);

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(overlay).toHaveClass(/is-visible/);
  await expect(overlay).toHaveCSS('pointer-events', 'none');

  await page.locator('.mode-btn[data-mode=educ]').click();
  await expect(overlay).not.toHaveClass(/is-visible/);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('mounts without error at a date before every mission launch', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?mode=explo&date=1970-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('#spacecraft-overlay')).toHaveClass(/is-visible/);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
