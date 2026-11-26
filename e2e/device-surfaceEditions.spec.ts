import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Les observations de l'atmosphère au TOUCHER (GAL-ATMOSPHERES-001), sur Pixel 7 (Chromium Android) et
 * iPhone 15 (WebKit) émulés : la fiche repliée se déplie, une observation se choisit au doigt, « Comparer
 * avec… » ramène l'autre, rien ne déborde, les cibles font au moins 40 px. Hors CI : `pnpm test:mobile`.
 * Ce que cela NE prouve PAS : un vrai téléphone.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('Jupiter : 2015 au doigt, puis comparer avec 2025, sans débordement', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/?body=jupiter');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
  if (!(await page.locator('#body-info').isVisible()))
    await page.locator('#info-trigger').tap();
  if (await page.locator('#body-info.is-compact').count())
    await page.locator('#body-info .bi-toggle').tap();
  const box = page.locator('#surface-editions');
  await expect(box).toBeVisible({ timeout: 60_000 });
  const option = box.locator('[role="radio"][data-edition="opal_2015a"]');
  await option.scrollIntoViewIfNeeded();
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await option.tap();
  await expect(box).toHaveAttribute('data-applied-edition', 'opal_2015a', {
    timeout: 60_000,
  });
  const compare = page.locator('#surface-editions-compare');
  await compare.scrollIntoViewIfNeeded();
  await compare.tap();
  await expect(box).toHaveAttribute('data-applied-edition', 'opal_2025a', {
    timeout: 60_000,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
