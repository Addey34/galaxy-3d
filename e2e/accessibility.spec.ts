import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
});

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
}

test('interactive overlays expose state and close with Escape', async ({
  page,
}) => {
  await boot(page);

  await expect(page.locator('.mode-btn[data-mode="educ"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('.mode-btn[data-mode="explo"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  const eventsToggle = page.locator('#events-toggle');
  await eventsToggle.click();
  const eventsPanel = page.locator('#astronomical-events');
  await expect(eventsPanel).toBeVisible();
  await expect(eventsPanel).toHaveAttribute(
    'aria-labelledby',
    'astronomical-events-title'
  );
  await expect(page.locator('.events-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(eventsPanel).toBeHidden();
  await expect(eventsToggle).toBeFocused();
});
