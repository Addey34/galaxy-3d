import { expect, test } from '@playwright/test';

// Déterminisme : pas de dépendance à l'API JPL SBDB live pendant les tests.
test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
});

/**
 * Internationalisation (FR/EN) : le sélecteur de langue (ui/langSwitch, dans le popover
 * d'aide) bascule à chaud les chaînes statiques (data-i18n) ET les libellés dynamiques
 * (barre de navigation, fiche d'info) via les abonnements onLocaleChange. Le choix est
 * persisté dans localStorage.
 */
test('switches UI language live and persists the choice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Contexte navigateur en anglais par défaut → l'UI démarre en anglais.
  const overview = page.locator('#orbit-overview');
  await expect(overview).toHaveText('Overview');

  // Fiche d'info d'un corps : nom + sous-titre en anglais.
  await page.locator('#orbit-earth').click();
  const panel = page.locator('#body-info');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.bi-name')).toHaveText('Earth');

  // Ouvrir le popover d'aide puis basculer en français.
  await page.locator('#help-btn').click();
  await page.locator('#lang-switch .lang-btn[data-locale="fr"]').click();

  // Chaînes statiques (data-i18n) retraduites.
  await expect(overview).toHaveText('Vue globale');
  // Libellés dynamiques (catalogue) retraduits sans re-sélection.
  await expect(panel.locator('.bi-name')).toHaveText('Terre');
  // <html lang> suit la langue (fr).
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  // Persistance : après rechargement, l'app redémarre en français.
  // `domcontentloaded` plutôt que `load` : la boucle rAF + le streaming de textures
  // gardent des requêtes en vol, l'événement `load` peut tarder au-delà du timeout.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#orbit-overview')).toHaveText('Vue globale');
});
