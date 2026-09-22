import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * SURFACES SUR TÉLÉPHONE : aucune ne recouvre un bouton. Vu sur un vrai téléphone le
 * 2026-09-22 : la fiche d'un corps, ancrée au bouton ⓘ tout en haut, recouvrait « Vue globale »
 * et la recherche ; la palette des corps, en pleine largeur, glissait sous la colonne d'outils
 * de droite. La garde démarre À la taille mobile (règle apprise au lot 9C : une page de bureau
 * redimensionnée ne place pas ses docks comme un téléphone).
 */
test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

type Box = { left: number; top: number; right: number; bottom: number };
const rect = (page: Page, selector: string): Promise<Box> =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('on a phone, the body card and the body list leave every dock uncovered', async ({
  page,
}) => {
  await page.goto('/?body=jupiter');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const card = page.locator('#body-info');
  await expect(card).toBeVisible();

  const docks = {
    'top-left': await rect(page, '.dock--top-left'),
    'top-right': await rect(page, '.dock--top-right'),
    bottom: await rect(page, '.dock--bottom'),
  };
  const cardBox = await rect(page, '#body-info');
  for (const [name, dock] of Object.entries(docks))
    expect(overlaps(cardBox, dock), `fiche sur le dock ${name}`).toBe(false);
  // Le corps suivi est centré à l'écran : la fiche qui le décrit ne doit pas le cacher.
  expect(cardBox.bottom, 'fiche sous le milieu de l’écran').toBeLessThanOrEqual(
    740 / 2
  );

  await page.locator('[aria-controls="body-palette"]').first().click();
  const palette = page.locator('#body-palette');
  await expect(palette).toBeVisible();
  const paletteBox = await rect(page, '#body-palette');
  for (const [name, dock] of Object.entries(docks))
    expect(overlaps(paletteBox, dock), `palette sur le dock ${name}`).toBe(
      false
    );
  // La liste déborde et défile d'elle-même, à l'intérieur de la feuille.
  const [client, scroll] = await page
    .locator('#palette-results')
    .evaluate((el) => [el.clientHeight, el.scrollHeight]);
  expect(scroll).toBeGreaterThan(client);
  expect(client).toBeGreaterThan(200);
});
