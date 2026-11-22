import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES ÉTOILES VOISINES (GAL-UNIVERSE-001) : la case « Nearby stars » ouvre la couche (repères et
 * noms avec leur distance) et la recherche ; un nom ouvre la fiche, qui dit la distance, ses
 * unités et sa provenance. Couche éteinte : aucune recherche, aucun nom. Une seule surface
 * contextuelle, fermée par Échap, et la scène reste celle du Système solaire (le corps suivi ne
 * change pas : on ne « voyage » pas vers une étoile).
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#neighbours-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

async function layerOn(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#neighbours-toggle').check();
  await expect(page.locator('#neighbour-search')).toBeVisible({
    timeout: 20_000,
  });
}

for (const [label, viewport, hasTouch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    test('layer off: no search, no card, no names', async ({ page }) => {
      await boot(page);
      await expect(page.locator('#neighbour-search')).toHaveCount(0);
      await expect(page.locator('#neighbour-card')).toHaveCount(0);
      await expect(page.locator('.neighbour-names')).toHaveCount(0);
    });

    test('searching Proxima opens its card with the Gaia distance, units and provenance, no axe violation', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      const search = page.locator('#neighbour-search');
      await search.fill('Proxima');
      await search.press('Enter');
      const card = page.locator('#neighbour-card');
      await expect(card).toBeVisible();
      await expect(card.locator('#neighbour-card-name')).toHaveText(
        'Proxima Centauri'
      );
      const facts = card.locator('.exo-facts');
      // Gaia DR3 : parallaxe 768,07 mas, soit 4,2465 al, avec son incertitude (±).
      await expect(facts).toContainText(/4\.246\d* ± 0\.000\d+ light-years/);
      await expect(facts).toContainText(/268,\d{3} AU/);
      await expect(facts).toContainText('2.69 km');
      await expect(card).toContainText('Gaia DR3, source 5853498713190525696');
      await expect(card).toContainText(
        'This work has made use of data from the European Space Agency'
      );
      // Une seule surface contextuelle, et le corps suivi n'a pas changé.
      await expect(page.locator('#orbit-options')).toBeHidden();
      await expect(page).toHaveURL(/\/neptune\//);

      const overflow = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')]
          .filter((c) => c.getBoundingClientRect().right > box.right + 1)
          .map((c) => c.className || c.tagName);
      });
      expect(overflow).toEqual([]);

      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .include('#neighbour-card')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.length}`)
      ).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
    });

    test('Alpha Centauri is a pair from HYG: both stars, no uncertainty claimed, no Gaia acknowledgement', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      const search = page.locator('#neighbour-search');
      await search.fill('Alpha Centauri');
      await search.press('Enter');
      const card = page.locator('#neighbour-card');
      await expect(card).toBeVisible();
      await expect(card.locator('.exo-facts')).toContainText('Toliman');
      await expect(card.locator('.exo-facts')).toContainText('Rigil Kentaurus');
      await expect(card.locator('.exo-facts')).toContainText(
        /4\.32\d? light-years/
      );
      await expect(card.locator('.exo-facts')).not.toContainText('±');
      await expect(card).toContainText('HYG v4.4');
      await expect(card).not.toContainText('has made use of data');
    });

    test('switching the layer off closes the card and hides the names', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      await page.locator('#neighbour-search').fill('Sirius');
      await page.locator('#neighbour-search').press('Enter');
      await expect(page.locator('#neighbour-card')).toBeVisible();
      await page.locator('#settings-trigger').dispatchEvent('click');
      await expect(page.locator('#orbit-options')).toBeVisible();
      await openSettingsTab(page, 'scene');
      await page.locator('#neighbours-toggle').uncheck();
      await expect(page.locator('#neighbour-card')).toBeHidden();
      await expect(page.locator('#neighbour-search-row')).toBeHidden();
      await expect(page.locator('.neighbour-names')).toBeHidden();
    });
  });
}
