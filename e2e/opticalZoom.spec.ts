import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
  });
});

test('shows optical FOV zoom in both modes and updates its value', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#optical-zoom');
  const range = page.locator('#optical-zoom-range');
  await expect(panel).toBeVisible();

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(panel).toBeVisible();
  await expect(range).toHaveAttribute('min', '8');
  await expect(range).toHaveAttribute('max', '55');

  await range.fill('12');
  await expect(page.locator('.optical-zoom-value')).toHaveText('12°');

  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(panel).toBeVisible();
});

test.describe('mobile bottom control dock', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps mode, FOV and events controls inside the viewport', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

    const controls = await page
      .locator('#mode-controls, #optical-zoom, #events-toggle')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        })
      );

    expect(controls).toHaveLength(3);
    for (const rect of controls) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(390);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(844);
    }
    expect(controls[0].right).toBeLessThanOrEqual(controls[1].left);
    expect(controls[1].right).toBeLessThanOrEqual(controls[2].left);
  });
});
