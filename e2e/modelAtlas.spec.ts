import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * UN CORPS À ATLAS (67P, 2026-10-06) : sa texture est l'atlas de son modèle, pas une carte.
 *
 * Deux choses que seul le navigateur montre. La texture est bien DEMANDÉE (le modèle en a
 * besoin, la sphère de repli n'en lit que la pastille). Et la fiche ne la pose PAS en fond
 * d'en-tête, comme elle le fait pour toute carte : un atlas, ce sont des îles dépliées côte à
 * côte, qui ne montrent rien du corps. Lutetia, drapée d'une carte, sert de témoin : son en-tête
 * garde sa texture, donc le test ne passe pas parce que la règle aurait disparu pour tous.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('67P demande son atlas, et sa fiche ne le montre pas en en-tête', async ({
  page,
}) => {
  const textures: string[] = [];
  page.on('request', (request) => {
    const file = request.url().split('/').pop() ?? '';
    if (file.startsWith('churyumov-gerasimenko_surface_')) textures.push(file);
  });
  await page.goto('/?body=churyumov-gerasimenko');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info')).not.toHaveClass(/has-hero/);
  await expect
    .poll(() => textures.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
});

test('témoin : Lutetia, drapée d’une carte, garde la sienne en en-tête', async ({
  page,
}) => {
  await page.goto('/?body=lutetia');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await expect(page.locator('#body-info')).toHaveClass(/has-hero/);
});
