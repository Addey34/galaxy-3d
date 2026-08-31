import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

// Le zoom optique (FOV) est un contrôle occasionnel, propre au mode Exploration : il vit
// dans la surface Réglages, pas dans l'overlay permanent. Masqué en Éducatif, visible en Explo.
test('optical FOV lives in settings, is exploration-only and updates its value', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#optical-zoom');
  const range = page.locator('#optical-zoom-range');

  // Éducatif : ouvrir les réglages ; le contrôle FOV est masqué.
  await page.locator('#settings-trigger').click();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await expect(panel).toBeHidden();
  // Refermer les réglages avant de changer de mode (la surface reste ouverte sinon).
  await page.locator('#settings-trigger').click();
  await expect(page.locator('#orbit-options')).toBeHidden();

  // Exploration : le FOV apparaît dans la surface Réglages.
  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await page.locator('#settings-trigger').click();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(range).toHaveAttribute('min', '8');
  await expect(range).toHaveAttribute('max', '55');

  await range.fill('12');
  await expect(page.locator('.optical-zoom-value')).toHaveText('12°');

  // Retour Éducatif (réglages toujours ouverts) : le contrôle redevient masqué.
  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(panel).toBeHidden();
});

test.describe('mobile bottom dock', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mode segment and fullscreen stay inside the viewport and clear of the time bar', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

    // Les contrôles persistants du dock bas : modes + plein écran + barre temps.
    for (const selector of [
      '#mode-controls',
      '#fullscreen-btn',
      '#time-panel',
    ]) {
      const rect = await page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(390);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(844);
    }
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return {
        mode: rect('#mode-controls'),
        time: rect('#time-panel'),
        fullscreen: rect('#fullscreen-btn'),
        topLeft: rect('.dock--top-left'),
        topRight: rect('.dock--top-right'),
        modeDirection: getComputedStyle(document.querySelector('.mode-seg')!)
          .flexDirection,
        toolsDirection: getComputedStyle(
          document.querySelector('.dock--top-right')!
        ).flexDirection,
      };
    });
    expect(layout.modeDirection).toBe('column');
    expect(layout.toolsDirection).toBe('column');
    expect(layout.mode.left).toBeLessThan(layout.time.left);
    expect(layout.time.right).toBeLessThan(layout.fullscreen.left);
    expect((layout.time.left + layout.time.right) / 2).toBeCloseTo(195, 0);
    expect(layout.topRight.top).toBeCloseTo(layout.topLeft.top, 0);
    expect(layout.topRight.left).toBeGreaterThan(layout.topLeft.right);
  });

  // Invariant : aucune taille ne saute pendant l'usage d'un curseur.
  test('dragging the FOV slider never resizes the settings surface', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    await page.locator('.mode-btn[data-mode="explo"]').click();
    await page.locator('#settings-trigger').click();
    await expect(page.locator('#optical-zoom')).toBeVisible();

    const dims = await page.locator('#orbit-options').evaluate((surface) => {
      const before = surface.getBoundingClientRect().width;
      const range = document.querySelector<HTMLInputElement>(
        '#optical-zoom-range'
      )!;
      range.value = '8';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      const after = surface.getBoundingClientRect().width;
      return { before, after };
    });
    expect(dims.after).toBeCloseTo(dims.before, 5);
  });
});
