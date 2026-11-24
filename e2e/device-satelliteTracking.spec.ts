import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * Le SUIVI d'un satellite au TOUCHER, sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit) émulés
 * (GAL-SATELLITE-TRACKING-001) : depuis la fiche de l'ISS, un tap sur « Suivre » lance le suivi, le bandeau
 * d'arrêt tient à l'écran sans masquer la barre du temps, la fiche fermée le suivi continue, un tap sur
 * « Arrêter le suivi » le termine. Hors CI : `pnpm test:mobile` (docs/TESTING.md). Ce que cela NE prouve PAS :
 * un vrai doigt sur un vrai écran, ni la fluidité sur un vrai GPU.
 */
const FIXTURE_TEXT = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
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

test('l’ISS : suivre au tap, le bandeau tient à l’écran, la fiche fermée le suivi continue, arrêter au tap', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await open(page);
  const search = page.locator('#satellite-search');
  await search.fill('ISS');
  await search.press('Enter');
  await expect(page.locator('#satellite-card-name')).toHaveText('ISS (ZARYA)');
  const canvas = page.locator('#satellite-overlay');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-path')), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  await page.locator('#satellite-card-follow').tap();
  await expect(canvas).toHaveAttribute('data-following', '25544');
  await page.locator('#satellite-card .surface-close').tap();
  await expect(page.locator('#satellite-card')).toBeHidden();

  // Le bandeau tient dans l'écran et ne recouvre pas la barre du temps.
  const chip = page.locator('#satellite-follow-chip');
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const time = await page.locator('#time-readout').boundingBox();
  if (time) {
    const apart =
      box.y + box.height <= time.y ||
      time.y + time.height <= box.y ||
      box.x + box.width <= time.x ||
      time.x + time.width <= box.x;
    expect(apart, 'le bandeau ne recouvre pas la barre du temps').toBe(true);
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('#satellite-follow-stop').tap();
  await expect(canvas).toHaveAttribute('data-following', '');
  await expect(chip).toBeHidden();
});
