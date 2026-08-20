import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.describe('first visit', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternalNetwork(page);
  });

  test('walks through every step then closes on the first visit', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

    const dialog = page.locator('.tour-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-step', '1');
    await expect(page.locator('.tour-progress')).toContainText('1');

    // Le nombre d'étapes est dérivé du fil d'Ariane (« 1 / N ») plutôt que codé en dur,
    // pour que l'ajout d'une étape ne casse pas ce test.
    const progressText = await page.locator('.tour-progress').textContent();
    const total = Number(progressText?.match(/(\d+)\s*$/)?.[1] ?? '0');
    expect(total).toBeGreaterThan(1);

    for (let step = 2; step <= total; step++) {
      await page.locator('.tour-next').click();
      await expect(dialog).toHaveAttribute('data-step', String(step));
    }

    await page.locator('.tour-next').click();
    await expect(dialog).toBeHidden();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(dialog).toBeHidden();
  });

  test.describe('mobile guided tour', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps each step inside a phone viewport', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

      const dialog = page.locator('.tour-dialog');
      await expect(dialog).toBeVisible();

      const progressText = await page.locator('.tour-progress').textContent();
      const total = Number(progressText?.match(/(\d+)\s*$/)?.[1] ?? '0');
      expect(total).toBeGreaterThan(1);

      for (let step = 1; step <= total; step++) {
        await expect(dialog).toHaveAttribute('data-step', String(step));
        const box = await dialog.boundingBox();
        if (!box)
          throw new Error(`Tour dialog is not measurable at step ${step}`);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        if (step !== total) await page.locator('.tour-next').click();
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  });
});

test.describe('relaunch', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternalNetwork(page);
    await page.addInitScript(() => {
      localStorage.setItem('ssv-guided-tour-v1', '1');
    });
  });

  test('can relaunch the tour from the help panel and close with Escape', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

    await page.locator('#help-btn').click();
    await page.locator('.tour-start').click();

    const dialog = page.locator('.tour-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-step', '1');
    await expect(page.locator('.tour-next')).toBeFocused();

    await page.locator('.tour-next').click();
    await expect(dialog).toHaveAttribute('data-step', '2');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
