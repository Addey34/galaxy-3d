import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * L'ÉCLAIRAGE DE LECTURE (GAL-IMMERSION-003) : éteint par défaut, un indicateur visible dès qu'il
 * agit, retour complet à l'état naturel, accessible, sans débordement à 390 px. Le rendu lui-même
 * (plancher de luminance, retour exact aux pixels) est mesuré par captures comparées hors suite.
 */
async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/?body=mars');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
}

for (const [label, viewport, hasTouch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    test('off by default, badge while active, back to natural when off', async ({
      page,
    }) => {
      await boot(page);
      await page.locator('#settings-trigger').dispatchEvent('click');
      await openSettingsTab(page, 'image');
      const toggle = page.locator('#reading-light-toggle');
      const badge = page.locator('#reading-light-badge');
      const range = page.locator('#reading-light-range');
      await expect(toggle).not.toBeChecked();
      await expect(badge).toBeHidden();
      await expect(range).toBeHidden();

      await toggle.check();
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('not natural lighting');
      await expect(range).toBeVisible();
      // La préférence n'est jamais mémorisée : aucune clé de stockage n'est écrite.
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((k) => /reading/i.test(k))
        )
      ).toEqual([]);

      const axe = await new AxeBuilder({ page })
        .include('#reading-light')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(axe.violations).toEqual([]);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await toggle.uncheck();
      await expect(badge).toBeHidden();
      await expect(range).toBeHidden();
    });
  });
}
