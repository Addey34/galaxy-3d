import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
});

/**
 * Onboarding (première visite) : la carte apparaît après le chargement, se ferme au clic
 * et ne se ré-affiche plus (persistance localStorage `ssv-onboarding-v1`).
 */
test('shows on first visit and stays dismissed after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const card = page.locator('.ob-card');
  await expect(card).toBeVisible();
  // Au moins un tip est affiché.
  await expect(card.locator('.ob-list li').first()).not.toBeEmpty();

  // Fermeture : la carte disparaît et est retirée du DOM.
  await card.locator('.ob-dismiss').click();
  await expect(card).not.toBeAttached();

  // Rechargement dans le même contexte (localStorage conservé) : la carte ne doit plus apparaître.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.ob-card')).not.toBeAttached();
});
