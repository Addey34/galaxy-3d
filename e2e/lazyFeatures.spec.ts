import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * GAL-PERF-001A : capture, hors ligne, visites guidées et VR ne sont PAS chargés au démarrage, et
 * chacun marche au PREMIER clic. Le serveur de développement sert les modules sous `/src/ui/<nom>.ts`.
 */
const LAZY = /\/src\/ui\/(capture|offlineData|webxr|guidedTour|tourPlayer)\.ts/;

const track = (page: Page): string[] => {
  const seen: string[] = [];
  page.on('request', (r) => {
    const m = r.url().match(LAZY);
    if (m) seen.push(m[1]);
  });
  return seen;
};

const open = async (page: Page, firstVisit = false): Promise<void> => {
  await blockExternalNetwork(page);
  await page.addInitScript((first) => {
    if (!first) localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  }, firstVisit);
  await page.goto('/earth/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
};

test('aucun des quatre groupes n’est chargé au démarrage normal', async ({
  page,
}) => {
  const seen = track(page);
  await open(page);
  await page.waitForTimeout(2000);
  expect(seen).toEqual([]);
});

test('la capture marche au premier clic', async ({ page }) => {
  const seen = track(page);
  await open(page);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#capture-btn').click();
  expect((await download).suggestedFilename()).toMatch(/^galaxy-earth-/);
  expect(seen).toContain('capture');
});

test('un échec de chargement de la capture est annoncé, puis le clic suivant réessaie', async ({
  page,
}) => {
  await open(page);
  await page.route(/\/src\/ui\/capture\.ts/, (route) => route.abort());
  await page.locator('#capture-btn').click();
  await expect(page.locator('[role="status"].sr-only').first()).toContainText(
    'could not be loaded',
    { timeout: 10_000 }
  );
  await page.unroute(/\/src\/ui\/capture\.ts/);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#capture-btn').click();
  await download;
});

test('la section hors ligne apparaît à la première ouverture des réglages', async ({
  page,
}) => {
  const seen = track(page);
  await open(page);
  expect(seen).not.toContain('offlineData');
  await page.locator('#settings-trigger').click();
  await openSettingsTab(page, 'data');
  await page.locator('#settings-section-offline').scrollIntoViewIfNeeded();
  await expect(page.locator('#offline-prepare')).toBeAttached({
    timeout: 20_000,
  });
  expect(seen).toContain('offlineData');
});

test('l’aide charge les visites au premier clic, et la visite démarre', async ({
  page,
}) => {
  const seen = track(page);
  await open(page);
  expect(seen).not.toContain('tourPlayer');
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await expect(page.locator('.stour-picker-item').first()).toBeVisible();
  expect(seen).toContain('tourPlayer');
  expect(seen).toContain('guidedTour');
});

test('un premier passage lance la découverte sans cliquer sur l’aide', async ({
  page,
}) => {
  const seen = track(page);
  await open(page, true);
  await expect(page.locator('.tour-dialog')).toBeVisible({ timeout: 20_000 });
  expect(seen).toContain('guidedTour');
});
