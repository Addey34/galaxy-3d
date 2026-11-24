import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * L'inspection 3D d'un engin sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit) émulés
 * (GAL-OBJECT-IMMERSION-001) : la sonde s'ouvre, le modèle Draco est décodé (Worker JavaScript), rien ne
 * déborde à 390 px, la fermeture rend la scène. Hors CI : `pnpm test:mobile` (docs/TESTING.md). Ce que cela
 * NE prouve PAS : un vrai téléphone (mémoire GPU, chaleur, images par seconde).
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('Parker Solar Probe : ouverture, modèle décodé, aucun débordement, fermeture', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/?body=parker-solar-probe&mode=explo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
  const button = page.locator('#craft-inspect');
  // Sur téléphone la fiche s'ouvre RÉDUITE : le bouton doit y être, sans « Afficher tous les détails ».
  if (!(await page.locator('#body-info').isVisible()))
    await page.locator('#info-trigger').tap();
  await expect(page.locator('#body-info.is-compact')).toBeVisible();
  await button.tap({ timeout: 60_000 });
  const view = page.locator('#craft-view');
  await expect(view).toHaveAttribute('data-craft-state', 'ready', {
    timeout: 150_000,
  });
  // Rien ne dépasse de l'écran, ni la page ni le volet d'informations.
  const overflow = await page.evaluate(() => {
    const side = document.querySelector('.cv-side')!.getBoundingClientRect();
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      sideRight: side.right - window.innerWidth,
      sideLeft: side.left,
    };
  });
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.sideRight).toBeLessThanOrEqual(0);
  expect(overflow.sideLeft).toBeGreaterThanOrEqual(0);
  // Une pièce nommée se met en évidence au toucher.
  const part = page.locator('.cv-part').first();
  await part.tap();
  await expect(part).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#craft-close').tap();
  await expect(view).toHaveCount(0);
  await expect(page.locator('#loader')).toBeHidden();
});
