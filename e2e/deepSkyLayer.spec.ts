import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LE CIEL PROFOND : une couche éteinte par défaut dont le fichier n'est demandé qu'à la première
 * activation, dont les noms restent dans l'écran sans se chevaucher, et qui disparaît à l'extinction.
 */

async function boot(page: Page, requests: string[]): Promise<void> {
  await blockExternalNetwork(page);
  page.on('request', (r) => requests.push(r.url()));
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

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`${label} : le ciel profond se charge à l'activation et s'efface à l'extinction`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const requests: string[] = [];
    await boot(page, requests);

    // Éteint par défaut : ni fichier demandé, ni conteneur de noms.
    expect(requests.some((u) => u.includes('/sky/deepsky.json'))).toBe(false);
    await expect(page.locator('.deepsky-names')).toHaveCount(0);

    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    await page.locator('#deepsky-toggle').check();

    const visible = page.locator('.deepsky-names-item:visible');
    await expect
      .poll(() => visible.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(
      requests.filter((u) => u.includes('/sky/deepsky.json'))
    ).toHaveLength(1);

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
    await expect(page.locator('.deepsky-names')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    await page.locator('#deepsky-toggle').uncheck();
    await expect(page.locator('.deepsky-names')).toBeHidden();

    // Rallumée : pas de second téléchargement.
    await page.locator('#deepsky-toggle').check();
    await expect(page.locator('.deepsky-names')).toBeVisible();
    expect(
      requests.filter((u) => u.includes('/sky/deepsky.json'))
    ).toHaveLength(1);
  });
}
