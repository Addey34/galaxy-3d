import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LA FICHE D'UN SYSTÈME D'EXOPLANÈTES : ouverte par un clic (ou un tap) sur un repère du ciel ET par
 * la recherche au clavier, rendue en une seule surface contextuelle, fermée par Échap.
 *
 * Le clic est prouvé de bout en bout, sans accès aux entrailles de la scène : on balaie une grille de
 * clics sur le ciel jusqu'à ce qu'un repère réponde (les anneaux sont assez denses pour qu'il y en ait
 * un en moins de quelques dizaines d'essais). La couche éteinte, aucun clic ne doit ouvrir quoi que ce
 * soit : c'est la moitié de la preuve, et la plus facile à rater.
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#exoplanets-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

async function layerOn(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#exoplanets-toggle').check();
  await expect(page.locator('#exoplanets-search')).toBeVisible();
}

/** Balaie une grille de clics dans `area` jusqu'à ce que la fiche s'ouvre ; rend vrai si elle l'a fait. */
async function clickUntilCard(
  page: Page,
  area: { x0: number; y0: number; x1: number; y1: number },
  tap: boolean,
  maxClicks: number
): Promise<boolean> {
  const card = page.locator('#exoplanet-card');
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
      expect(await clickUntilCard(page, area, hasTouch, 60)).toBe(false);
      await expect(page.locator('#exoplanet-card')).toHaveCount(0);
    });

    test('a click on a ring opens the card, Escape closes it', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      // La surface Réglages se referme d'elle-même quand la fiche s'ouvre : on la ferme d'abord
      // pour que la grille ne tombe pas dessus.
      await page.locator('#settings-trigger').dispatchEvent('click');
      await expect(page.locator('#orbit-options')).toBeHidden();

      expect(await clickUntilCard(page, area, hasTouch, 400)).toBe(true);
      const card = page.locator('#exoplanet-card');
      await expect(card.locator('#exo-card-name')).not.toBeEmpty();
      expect(await card.locator('.exo-planet').count()).toBeGreaterThan(0);
      await expect(card.locator('.bi-subtitle')).toContainText(/\d/);
      // Le focus entre dans la surface, et Échap la ferme.
      await expect(card.locator('.surface-close')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
    });

    test('keyboard: searching a name opens its card, one surface at a time, no axe violation', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      const search = page.locator('#exoplanets-search');
      await search.fill('TRAPPIST');
      await search.press('Enter');
      const card = page.locator('#exoplanet-card');
      await expect(card).toBeVisible();
      await expect(card.locator('#exo-card-name')).toHaveText('TRAPPIST-1');
      await expect(card.locator('.exo-planet')).toHaveCount(7);
      // Une seule surface contextuelle : la fiche a refermé les Réglages.
      await expect(page.locator('#orbit-options')).toBeHidden();

      // Aucun élément de la fiche ne dépasse de sa boîte.
      const overflow = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')]
          .filter((c) => c.getBoundingClientRect().right > box.right + 1)
          .map((c) => c.className || c.tagName);
      });
      expect(overflow).toEqual([]);

      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .include('#exoplanet-card')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.length}`)
      ).toEqual([]);

      // Ouvrir l'aide referme la fiche.
      await page.locator('#help-btn').dispatchEvent('click');
      await expect(card).toBeHidden();
    });

    test('opening a card brings the system to the centre of the free area', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await boot(page);
      await layerOn(page);
      const search = page.locator('#exoplanets-search');
      await search.fill('TRAPPIST');
      await search.press('Enter');
      const card = page.locator('#exoplanet-card');
      await expect(card).toBeVisible();
      await expect(card.locator('#exo-card-name')).toHaveText('TRAPPIST-1');

      // Au bureau la fiche est un coin : le centre est libre. Sur téléphone elle couvre la largeur
      // en haut : on vise le milieu entre son bord bas et la barre de temps (core/skyCentering).
      const size = page.viewportSize()!;
      const box = (await card.boundingBox())!;
      const wide = box.width >= 0.6 * size.width;
      const wantedY = wide
        ? (box.y + box.height + size.height * 0.88) / 2
        : size.height / 2;
      // `data-sky-centered` (canvas) vaut 1 quand l'objet est arrivé : le centrage attend la fin d'un
      // vol en cours et se charge à la première ouverture, aucune durée fixe n'est juste.
      await expect(page.locator('canvas[data-sky-centered="1"]')).toBeAttached({
        timeout: 60_000,
      });

      // Les systèmes n'ont pas de nom 2D : on ferme la fiche, puis on clique EXACTEMENT là où le
      // système doit être. Centré, le clic rouvre sa fiche ; sans centrage il tombe sur Neptune
      // (au centre de la vue) ou dans le vide, et la fiche reste fermée.
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
      if (hasTouch) await page.touchscreen.tap(size.width / 2, wantedY);
      else await page.mouse.click(size.width / 2, wantedY);
      await expect(card).toBeVisible({ timeout: 5_000 });
      await expect(card.locator('#exo-card-name')).toHaveText('TRAPPIST-1');
    });
  });
}
