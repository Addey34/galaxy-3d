import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES SATELLITES : une couche éteinte par défaut dont le fichier (servi par `galaxy-data`) n'est
 * demandé qu'à la première activation, qui ne peint rien hors de la validité des éléments, et qui
 * disparaît à l'extinction. Le fichier servi ici est une lecture RÉELLE de CelesTrak (2026-11-03,
 * 173 objets, `e2e/satellites.fixture.json`) ; la date de la scène est celle de son époque.
 */

const FIXTURE = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
);
const INSIDE = '2026-11-02T19:00:00Z';
const OUTSIDE = '2026-03-01T12:00:00Z';

async function boot(
  page: Page,
  requests: string[],
  date: string,
  serve: 'file' | 'down' = 'file'
): Promise<void> {
  await blockExternalNetwork(page);
  // Enregistrée APRÈS le blocage : la dernière route déclarée gagne.
  await page.route('**/satellites/elements.json', (route) =>
    serve === 'file'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: FIXTURE,
        })
      : route.abort()
  );
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto(`/?mode=explo&body=earth&date=${date}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#satellites-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

async function openToggle(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`${label} : les satellites se chargent à l'activation, se peignent et s'effacent à l'extinction`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const requests: string[] = [];
    await boot(page, requests, INSIDE);

    // Éteints par défaut : ni fichier demandé, ni canvas.
    expect(requests.some((u) => u.includes('/satellites/elements.json'))).toBe(
      false
    );
    await expect(page.locator('#satellite-overlay')).toHaveCount(0);

    await openToggle(page);
    await page.locator('#satellites-toggle').check();

    const overlay = page.locator('#satellite-overlay');
    await expect
      .poll(async () => Number(await overlay.getAttribute('data-markers')), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    expect(
      requests.filter((u) => u.includes('/satellites/elements.json'))
    ).toHaveLength(1);

    // Le texte d'état dit combien d'objets valent et d'où ils viennent.
    const status = page.locator('#satellites-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('CelesTrak');
    await expect(status).toContainText('2026-11-03');

    // Rien ne déborde de la fenêtre à cette largeur.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.locator('#satellites-toggle').uncheck();
    await expect(overlay).toBeHidden();
    await expect(overlay).toHaveAttribute('data-markers', '0');
    await expect(status).toBeHidden();
  });
}

test("hors de la validité des éléments, rien n'est peint et la couche le dit", async ({
  page,
}) => {
  const requests: string[] = [];
  await boot(page, requests, OUTSIDE);
  await openToggle(page);
  await page.locator('#satellites-toggle').check();
  await expect(page.locator('#satellites-status')).toContainText(
    'outside the validity',
    { timeout: 20_000 }
  );
  await expect(page.locator('#satellite-overlay')).toHaveAttribute(
    'data-markers',
    '0'
  );
});

test('un service muet décoche la case et le dit, sans rien promettre', async ({
  page,
}) => {
  const requests: string[] = [];
  await boot(page, requests, INSIDE, 'down');
  await openToggle(page);
  await page.locator('#satellites-toggle').check();
  await expect(page.locator('#satellites-status')).toContainText(
    'unavailable',
    { timeout: 20_000 }
  );
  await expect(page.locator('#satellites-toggle')).not.toBeChecked();
  await expect(page.locator('#satellite-overlay')).toHaveCount(0);
});
