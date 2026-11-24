import { expect, test, type Page } from '@playwright/test';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * LE PANNEAU D'IMAGERIE DE SURFACE VIT À LA DEMANDE (GAL-SATELLITE-TRACKING-001, budget du démarrage) : il
 * n'est ni chargé ni monté à l'ouverture de l'application, il l'est à l'ouverture des réglages et quand la
 * caméra s'approche d'un corps. Les parcours qui s'en servent (imagerie de la Terre, visites) sont couverts par
 * leurs propres fichiers ; celui-ci tient la promesse de ne rien payer avant.
 */
const PANEL_MODULE = /\/surfacePanel(\.ts|-[A-Za-z0-9_-]+\.js)(\?|$)/;

async function boot(page: Page, requests: string[]): Promise<void> {
  page.on('request', (request) => {
    if (PANEL_MODULE.test(request.url())) requests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?mode=educ');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
}

test('ni chargé ni monté au démarrage, monté à l’ouverture des réglages', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const requests: string[] = [];
  await boot(page, requests);
  await page.waitForTimeout(4000);
  expect(requests).toEqual([]);
  await expect(page.locator('#surface-imagery-toggle')).toHaveCount(0);

  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#surface-imagery-toggle')).toHaveCount(1, {
    timeout: 30_000,
  });
  expect(requests).toHaveLength(1);
});

test('monté quand la caméra s’approche d’un corps', async ({ page }) => {
  test.setTimeout(180_000);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (PANEL_MODULE.test(request.url())) requests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  // Une adresse de corps en Explo : la caméra arrive à 9 rayons de la Lune, seuil de 8 (`SURFACE_PANEL_LOAD_RADII`).
  await page.goto(`/?mode=explo&body=moon&date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(3000);
  expect(requests).toEqual([]);
  // L'adresse amène la caméra à 9 rayons : un cran de molette la fait passer sous le seuil.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => requests.length, { timeout: 60_000 }).toBe(1);
  await expect(page.locator('#surface-imagery-toggle')).toHaveCount(1, {
    timeout: 30_000,
  });
});
