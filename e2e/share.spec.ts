import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page, context }) => {
  await blockExternalNetwork(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
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
  // Le corps voyage désormais dans le CHEMIN et non plus dans la query : le lien copié est
  // l'adresse canonique de Mars, celle que le sitemap annonce et qu'un aperçu de partage sait
  // décorer avec la bonne vignette. `?body=mars` y serait une redite.
  expect(clipboardText).toContain('/mars/');
  expect(clipboardText).not.toContain('body=mars');
});

test('share captures the exact camera angle, and reopening the link restores it', async ({
  page,
}) => {
  await page.goto('/?mode=explo&body=mars');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  // Laisse le vol caméra vers Mars se terminer avant de tourner autour.
  await page.waitForTimeout(1_500);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Fait tourner la caméra autour de Mars vers un angle distinctif (drag un doigt = rotation).
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy - 60, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.locator('#share-btn').click();
  await expect(page.locator('#share-toast')).toBeVisible();

  const shared = new URL(
    await page.evaluate(() => navigator.clipboard.readText())
  );
  const az = shared.searchParams.get('az');
  const pol = shared.searchParams.get('pol');
  const dist = shared.searchParams.get('dist');
  expect(az).not.toBeNull();
  expect(pol).not.toBeNull();
  expect(dist).not.toBeNull();

  // Rouvre le lien partagé dans une page fraîche et laisse le vol + la restauration du
  // cadrage se terminer, puis vérifie que l'URL retombe sur le MÊME angle (round-trip).
  await page.goto(shared.toString());
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const restoredUrl = new URL(page.url());
  expect(Number(restoredUrl.searchParams.get('az'))).toBeCloseTo(Number(az), 0);
  expect(Number(restoredUrl.searchParams.get('pol'))).toBeCloseTo(
    Number(pol),
    0
  );
  expect(Number(restoredUrl.searchParams.get('dist'))).toBeCloseTo(
    Number(dist),
    1
  );
});
