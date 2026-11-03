import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LA FICHE D'UN OBJET DU CIEL PROFOND : ouverte par un clic (ou un tap) sur un losange ET par la
 * recherche au clavier, une seule surface contextuelle, fermée par Échap. Couche éteinte : aucun
 * clic n'ouvre rien (la moitié de la preuve, et la plus facile à rater).
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#deepsky-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

async function layerOn(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#deepsky-toggle').check();
  await expect(page.locator('#deepsky-search')).toBeVisible({
    timeout: 20_000,
  });
}

async function clickUntilCard(
  page: Page,
  area: { x0: number; y0: number; x1: number; y1: number },
  tap: boolean,
  maxClicks: number
): Promise<boolean> {
  const card = page.locator('#deepsky-card');
  let clicks = 0;
  for (let y = area.y0; y < area.y1; y += 17) {
    for (let x = area.x0; x < area.x1; x += 17) {
      if (clicks++ >= maxClicks) return false;
      if (tap) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      if (await card.isVisible()) return true;
    }
  }
  return false;
}

for (const [label, viewport, hasTouch, area] of [
  [
    'desktop',
    { width: 1280, height: 800 },
    false,
    { x0: 160, y0: 110, x1: 880, y1: 640 },
  ],
  [
    'phone',
    { width: 390, height: 844 },
    true,
    { x0: 14, y0: 130, x1: 330, y1: 690 },
  ],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    test('layer off: a click on the sky opens nothing', async ({ page }) => {
      await boot(page);
      expect(await clickUntilCard(page, area, hasTouch, 80)).toBe(false);
      await expect(page.locator('#deepsky-card')).toHaveCount(0);
    });

    test('keyboard: searching M 31 opens its card, one surface at a time, no axe violation', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      const search = page.locator('#deepsky-search');
      await search.fill('M 31');
      await search.press('Enter');
      const card = page.locator('#deepsky-card');
      await expect(card).toBeVisible();
      await expect(card.locator('#deepsky-card-name')).toHaveText(
        'Andromeda Galaxy'
      );
      await expect(card.locator('.exo-facts')).toContainText('NGC 224');
      await expect(card.locator('.exo-facts')).toContainText('M 31');
      // Une seule surface contextuelle : la fiche a refermé les Réglages.
      await expect(page.locator('#orbit-options')).toBeHidden();

      const overflow = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')]
          .filter((c) => c.getBoundingClientRect().right > box.right + 1)
          .map((c) => c.className || c.tagName);
      });
      expect(overflow).toEqual([]);

      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .include('#deepsky-card')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.length}`)
      ).toEqual([]);

      await page.locator('#help-btn').dispatchEvent('click');
      await expect(card).toBeHidden();
    });

    test('a click on a marker opens a card, Escape closes it', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await boot(page);
      await layerOn(page);
      await page.locator('#settings-trigger').dispatchEvent('click');
      await expect(page.locator('#orbit-options')).toBeHidden();

      expect(await clickUntilCard(page, area, hasTouch, 1500)).toBe(true);
      const card = page.locator('#deepsky-card');
      await expect(card.locator('#deepsky-card-name')).not.toBeEmpty();
      await expect(card.locator('.exo-facts')).toContainText(/NGC|IC/);
      await expect(card.locator('.surface-close')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
    });
  });
}
