import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * La sélection d'un satellite au TOUCHER, sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit) émulés
 * (GAL-SATELLITE-SELECTION-001) : un tap sur un point ouvre la fiche, rien ne déborde à 390 px, la recherche
 * par le nom marche aussi, la fiche se ferme. Hors CI : `pnpm test:mobile` (docs/TESTING.md). Ce que cela NE
 * prouve PAS : un vrai doigt sur un vrai écran (la précision du tap sur un point de 4 px).
 */
const FIXTURE_TEXT = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
);
const NAMES = new Map(
  (
    JSON.parse(FIXTURE_TEXT) as { objects: { id: number; name: string }[] }
  ).objects.map((o) => [o.id, o.name])
);
const INSIDE = '2026-11-02T19:00:00Z';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.route('**/satellites/elements.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_TEXT,
    })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function open(page: Page): Promise<void> {
  await page.goto(`/?mode=explo&body=earth&date=${INSIDE}&debug-satellites`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#satellites-toggle')).toBeEnabled({
    timeout: 60_000,
  });
  await page.locator('#settings-trigger').tap();
  await openSettingsTab(page, 'scene');
  await page.locator('#satellites-toggle').check();
  await expect
    .poll(
      async () =>
        Number(
          await page.locator('#satellite-overlay').getAttribute('data-markers')
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
}

test('un tap sur un point ouvre la fiche, lisible à 390 px, puis se ferme', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await open(page);
  // Le panneau des réglages couvre l'écran : on le referme, la couche reste allumée.
  await page.locator('#settings-trigger').tap();
  await expect
    .poll(
      async () =>
        (await page
          .locator('#satellite-overlay')
          .getAttribute('data-points')) !== null
    )
    .toBe(true);
  const painted = JSON.parse(
    (await page.locator('#satellite-overlay').getAttribute('data-points')) ??
      '[]'
  ) as [number, number, number][];
  const target = painted.find(
    ([id, x, y]) =>
      x > 20 &&
      y > 20 &&
      painted.every(
        ([other, ox, oy]) => other === id || Math.hypot(ox - x, oy - y) > 2
      )
  );
  expect(target, 'un satellite est peint').toBeDefined();
  const [id, x, y] = target!;
  await page.touchscreen.tap(x, y);
  const card = page.locator('#satellite-card');
  await expect(card).toBeVisible();
  await expect(page.locator('#satellite-card-name')).toHaveText(NAMES.get(id)!);
  // Lisible : ni la page ni la fiche ne dépassent de l'écran.
  const box = await card.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('#satellite-card .surface-close').tap();
  await expect(card).toBeHidden();
});

test('l’ISS : sa fiche, puis son inspection 3D, au toucher', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await open(page);
  const search = page.locator('#satellite-search');
  await search.fill('ISS');
  await search.press('Enter');
  await expect(page.locator('#satellite-card-name')).toHaveText('ISS (ZARYA)');
  await page.locator('#satellite-card-inspect').tap();
  await expect(page.locator('#craft-view')).toHaveAttribute(
    'data-craft-state',
    'ready',
    { timeout: 150_000 }
  );
  await page.locator('#craft-close').tap();
  await expect(page.locator('#craft-view')).toHaveCount(0);
});
