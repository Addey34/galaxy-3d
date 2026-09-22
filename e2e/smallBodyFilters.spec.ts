import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

// Déterminisme : réseau externe coupé. Depuis le lot 8b cela ne vide plus l'overlay, qui lit un
// instantané livré avec l'application ; ces scénarios testent de toute façon la section, pas le
// rendu des marqueurs (`e2e/smallBodyDataset.spec.ts` s'en charge). Tour d'accueil neutralisé
// (son backdrop intercepterait les clics sur les boutons de mode).
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

/**
 * Le champ d'astéroïdes et de comètes se règle dans la surface Réglages d'affichage, dans les
 * DEUX modes. Il avait son propre bouton, qui n'apparaissait qu'en Exploration : la rangée de
 * boutons du haut changeait donc d'un mode à l'autre, et le réglage n'était pas là où vivent
 * tous les autres.
 */
test('the asteroid and comet field is a section of display settings, in both modes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Plus de bouton dédié, dans aucun mode.
  await expect(page.locator('#smallbody-filters-trigger')).toHaveCount(0);

  const section = page.locator('#orbit-options #smallbody-filters');
  await page.locator('#settings-trigger').click();
  await expect(section).toBeVisible();
  const rows = section.locator('.oo-row');
  await expect(rows).toHaveCount(4);
  // Les mêmes lignes que le tableau des corps : pastille, nom, case.
  await expect(rows.first().locator('.oo-dot')).toHaveCount(1);

  // Décocher une catégorie ("Comets") ne doit rien casser et laisser le panneau ouvert.
  const cometRow = section.locator('.oo-row', { hasText: 'Comets' });
  await cometRow.locator('.oo-checkbox').uncheck();
  await expect(section).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('.mode-btn[data-mode=explo]').click();
  await page.locator('#settings-trigger').click();
  await expect(section).toBeVisible();
  await expect(cometRow.locator('.oo-checkbox')).not.toBeChecked();

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
