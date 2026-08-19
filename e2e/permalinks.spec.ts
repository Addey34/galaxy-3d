import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

test('restores mode, selected body and simulation date from a permalink', async ({
  page,
}) => {
  await page.goto('/?mode=explo&body=mars&date=2026-11-20T18%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Mars');
  await expect(page.locator('.explo-label.is-target')).toHaveAttribute(
    'aria-label',
    'Mars'
  );
  await expect(page.locator('#date-input')).toHaveValue('2026-11-20');
  await expect(page.locator('#time-input')).toHaveValue(/^18:00:\d{2}$/);

  const url = new URL(page.url());
  expect(url.searchParams.get('mode')).toBe('explo');
  expect(url.searchParams.get('body')).toBe('mars');
  expect(url.searchParams.get('date')).toBe('2026-11-20T18:00:00Z');
});
