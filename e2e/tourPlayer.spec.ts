import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  // Évite que le tour d'accueil première-visite (`ui/guidedTour.ts`) ne s'affiche par-dessus
  // et n'intercepte les clics — sans rapport avec les tours scénarisés testés ici.
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function openPicker(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await expect(page.locator('.stour-picker')).toBeVisible();
}

/**
 * Clique « Suivant » tant qu'il est actif (légende sans durée), attend sinon (étape
 * flyTo/jumpToDate en cours — instantanée sous `reducedMotion: 'reduce'`, cf. playwright.config.ts).
 */
async function advanceToEnd(page: Page): Promise<void> {
  const card = page.locator('.stour-card');
  const next = page.locator('.stour-next');
  for (let i = 0; i < 20; i++) {
    if (!(await card.isVisible())) return;
    if (!(await next.isDisabled())) {
      await next.click();
    } else {
      await page.waitForTimeout(200);
    }
  }
  await expect(card).toBeHidden({ timeout: 20_000 });
}

test.describe('scripted tour picker', () => {
  test('lists the three tours from the help panel', async ({ page }) => {
    await openPicker(page);
    await expect(page.locator('.stour-picker-item')).toHaveCount(3);
  });
});

test.describe('eclipse tour', () => {
  test('runs to completion and returns to overview', async ({ page }) => {
    await openPicker(page);
    const bodyInfo = page.locator('#body-info');

    await page.locator('.stour-picker-item').nth(0).click();
    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    // Les étapes `jumpToDate`/`flyTo` sont instantanées sous reducedMotion : pas d'assertion
    // sur le numéro d'étape ici, la course jusqu'à la 1re légende serait sujette aux courses.
    await expect(bodyInfo).toBeVisible(); // vol vers la Terre effectué

    await advanceToEnd(page);
    await expect(card).toBeHidden();
    // Fin de tour : `navigation.selectBody('overview')` referme la fiche d'info.
    await expect(bodyInfo).toBeHidden();
  });

  test('can be closed early with the Close button', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(0).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await page.locator('.stour-close').click();
    await expect(card).toBeHidden();
    await expect(page.locator('#body-info')).toBeHidden();
  });

  test('can be closed early with Escape', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(0).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
  });
});

test.describe('other scripted tours', () => {
  test('galileans tour starts and can be closed', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(1).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await expect(page.locator('.stour-progress')).toContainText('1');

    await page.locator('.stour-close').click();
    await expect(card).toBeHidden();
    await expect(page.locator('#body-info')).toBeHidden();
  });

  test('kuiper tour starts and can be closed', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(2).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await expect(page.locator('.stour-progress')).toContainText('1');

    await page.locator('.stour-close').click();
    await expect(card).toBeHidden();
    await expect(page.locator('#body-info')).toBeHidden();
  });
});

test.describe('mobile scripted tour', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the caption card inside a phone viewport', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(0).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    if (!box) throw new Error('Tour card is not measurable');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });
});
