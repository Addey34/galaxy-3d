import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES NOMS DES CONSTELLATIONS : une couche 2D qui n'existe pas tant que les figures sont éteintes,
 * s'écrit avec elles, reste dans l'écran sans chevauchement, et disparaît à l'extinction.
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#constellations-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`${label} : les noms suivent la couche des figures`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await boot(page);

    // Éteinte par défaut : rien dans le DOM, pas même le conteneur.
    await expect(page.locator('.constellation-names')).toHaveCount(0);

    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    await page.locator('#constellations-toggle').check();

    const visible = page.locator('.constellation-names-item:visible');
    await expect
      .poll(() => visible.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // Chaque nom visible tient dans l'écran et ne recouvre aucun autre.
    const boxes = await visible.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return {
          t: e.textContent,
          l: r.left,
          r: r.right,
          tp: r.top,
          b: r.bottom,
        };
      })
    );
    for (const b of boxes) {
      expect(b.l, b.t ?? '').toBeGreaterThanOrEqual(-1);
      expect(b.r, b.t ?? '').toBeLessThanOrEqual(viewport.width + 1);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const c = boxes[j]!;
        const overlap = a.l < c.r && c.l < a.r && a.tp < c.b && c.tp < a.b;
        expect(overlap, `${a.t} / ${c.t}`).toBe(false);
      }

    // Ils sont décoratifs pour le lecteur d'écran (la figure l'est aussi) et laissent passer les clics.
    await expect(page.locator('.constellation-names')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    await page.locator('#constellations-toggle').uncheck();
    await expect(page.locator('.constellation-names')).toBeHidden();
    await page.screenshot({
      path: `test-results/constellation-names-${label}-off.png`,
    });
  });
}
