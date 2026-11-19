import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { diveByTapping } from './placeDiveFlow';
import { blockExternalNetwork } from './netBlock';

/**
 * LE REPÈRE D'UNE PLONGÉE (GAL-IMMERSION-002) : une plongée sur un lieu nommé pose un repère sur
 * le lieu VISÉ (anneau et nom), qui suit la pose du corps, et disparaît au premier geste, sans
 * rien laisser dans le DOM. Réutilise `ui/formationMarker` (couche d'instrument, pas un mesh).
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('la plongée pose le repère du lieu visé, un geste de la molette le retire', async ({
  page,
}) => {
  const name = await diveByTapping(page, (x, y) => page.mouse.click(x, y));
  const marker = page.locator('#formation-marker');
  await expect(marker).toHaveCount(1, { timeout: 15_000 });
  await expect(marker.locator('.formation-marker-name')).toContainText(name);
  // Une plongée est déjà près du lieu : pas de phrase « approchez-vous ».
  await expect(marker.locator('.formation-marker-hint')).toHaveCount(0);
  // Un repère visuel, masqué aux technologies d'assistance (la plongée a sa propre annonce) :
  // axe n'y trouve rien.
  const axe = await new AxeBuilder({ page })
    .include('#formation-marker')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  // Un seul repère, même quand la plongée est rejouée à mesure que les carreaux arrivent.
  await page.waitForTimeout(2_500);
  await expect(page.locator('#formation-marker')).toHaveCount(1);

  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect(page.locator('#formation-marker')).toHaveCount(0);
  // Rien ne le ramène : la plongée rejouée est arrêtée par le même geste.
  await page.waitForTimeout(2_000);
  await expect(page.locator('#formation-marker')).toHaveCount(0);
});

test('le retour à la vue globale retire le repère de la plongée', async ({
  page,
}) => {
  await diveByTapping(page, (x, y) => page.mouse.click(x, y));
  await expect(page.locator('#formation-marker')).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.locator('#orbit-overview').click();
  await expect(page.locator('#formation-marker')).toHaveCount(0);
});
