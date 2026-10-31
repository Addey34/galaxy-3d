import { expect, test } from '@playwright/test';
import { boot, prepareSurfacePage } from './surfaceTiles';

/**
 * Ouverte en entier, la fiche couvrait 43 % d'un écran de 390 x 844 et la moitié haute du corps
 * visé (mesuré en production le 2026-10-31). Sur téléphone, une sélection l'ouvre repliée
 * (en-tête et distance) ; un bouton la déplie. Sur grand écran elle reste entière.
 */
test('opens the body card folded on a phone, and unfolds it on demand', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareSurfacePage(page);
  await boot(page, '?mode=explo&body=mars');
  const panel = page.locator('#body-info');
  await expect(panel).toBeVisible();
  const toggle = panel.locator('.bi-toggle');
  const stats = panel.locator('.bi-stats');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(stats).toBeHidden();
  const folded = await panel.boundingBox();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(stats).toBeVisible();
  const open = await panel.boundingBox();
  expect(open!.height).toBeGreaterThan(folded!.height);

  await toggle.click();
  await expect(stats).toBeHidden();
});

test('keeps the body card whole on a desktop screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await prepareSurfacePage(page);
  await boot(page, '?mode=explo&body=mars');
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info .bi-toggle')).toBeHidden();
  await expect(page.locator('#body-info .bi-stats')).toBeVisible();
});
