import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

// Déterminisme : réseau JPL SBDB bloqué (l'overlay dégrade proprement en champ vide, suffisant
// pour ces scénarios — on teste le panneau, pas le rendu des marqueurs). Tour d'accueil neutralisé
// (son backdrop intercepterait les clics sur les boutons de mode).
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('trigger is hidden in educ, appears in explo, and the filter panel toggles categories', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const trigger = page.locator('#smallbody-filters-trigger');
  const panel = page.locator('#smallbody-filters');
  await expect(trigger).toBeHidden();

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(trigger).toBeVisible();
  await expect(panel).toBeHidden();

  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const rows = panel.locator('.oo-row');
  await expect(rows).toHaveCount(4);

  // Décocher une catégorie ("Comets") ne doit rien casser et laisser le panneau ouvert.
  const cometRow = panel.locator('.oo-row', { hasText: 'Comets' });
  await cometRow.locator('.oo-checkbox').uncheck();
  await expect(panel).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await page.locator('.mode-btn[data-mode=educ]').click();
  await expect(trigger).toBeHidden();

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
