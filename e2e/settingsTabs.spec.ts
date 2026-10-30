import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES RÉGLAGES SE RANGENT EN QUATRE ONGLETS, ET CHAQUE RÉGLAGE VIT OÙ IL AGIT (audit C5).
 *
 * Un seul groupe de sections est visible à la fois ; les deux réglages qui n'agissaient pas sur
 * l'affichage (nuages gardés de près, libellés d'événements) vivent dans les panneaux Météo et
 * Événements de la Terre. Mesuré sur les deux géométries : aucun débordement horizontal.
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
}

for (const [label, viewport, hasTouch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    test('one group of settings at a time, no horizontal overflow', async ({
      page,
    }) => {
      await boot(page);
      await page.locator('#settings-trigger').dispatchEvent('click');
      await expect(page.locator('#orbit-options')).toBeVisible();

      const groups = {
        scene: '#settings-section-scene',
        image: '#settings-section-rendering',
        reading: '#settings-section-reading',
        data: '#settings-section-offline',
      } as const;
      for (const [tab, section] of Object.entries(groups)) {
        await openSettingsTab(page, tab as keyof typeof groups);
        await expect(page.locator(`#settings-tab-${tab}`)).toHaveAttribute(
          'aria-selected',
          'true'
        );
        await expect(page.locator(section)).toBeVisible();
        for (const [other, otherSection] of Object.entries(groups))
          if (other !== tab)
            await expect(page.locator(otherSection)).toBeHidden();
        const overflow = await page
          .locator('#orbit-options')
          .evaluate((panel) => panel.scrollWidth - panel.clientWidth);
        expect(overflow, `onglet ${tab}`).toBeLessThanOrEqual(0);
      }
    });

    test('arrow keys move between tabs', async ({ page }) => {
      test.skip(hasTouch, 'geste clavier');
      await boot(page);
      await page.locator('#settings-trigger').dispatchEvent('click');
      await page.locator('#settings-tab-scene').focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#settings-tab-image')).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await page.keyboard.press('End');
      await expect(page.locator('#settings-tab-data')).toBeFocused();
    });

    test('clouds and event labels live in the panel they affect', async ({
      page,
    }) => {
      await boot(page);
      await page.locator('#settings-trigger').dispatchEvent('click');
      await expect(page.locator('#orbit-options')).toBeVisible();
      await expect(
        page.locator('#orbit-options #keep-appearance-toggle')
      ).toHaveCount(0);
      await expect(
        page.locator('#orbit-options #event-labels-toggle')
      ).toHaveCount(0);

      await page.locator('#weather-trigger').dispatchEvent('click');
      await expect(page.locator('#weather-layers')).toBeVisible();
      await expect(
        page.locator('#weather-layers #keep-appearance-toggle')
      ).toBeVisible();

      await page.locator('#earth-events-trigger').dispatchEvent('click');
      await expect(page.locator('#earth-events')).toBeVisible();
      await expect(
        page.locator('#earth-events #event-labels-toggle')
      ).toBeVisible();
    });
  });
}
