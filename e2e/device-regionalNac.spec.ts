import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import { TILE_JPEG } from './surfaceTiles';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * LA MOSAÏQUE NAC D'APOLLO 11 SUR TÉLÉPHONE ÉMULÉ (GAL-IMMERSION-003B) : Pixel 7 (Chromium) et
 * iPhone 15 (WebKit). On plonge vers la Statio Tranquillitatis, on descend (des `WheelEvent`
 * envoyés au canevas : WebKit mobile n'a pas de `mouse.wheel`), et les tuiles AU-DELÀ du niveau 8
 * partent vers la couche NAC, servies par le test. La page ne plante pas, ne déborde pas à 390 px.
 * Ne prouve PAS les performances ni la mémoire d'un téléphone physique.
 */
const NAC = 'A11_60x60km.eq';
const CORS = { 'access-control-allow-origin': '*' };

test('Apollo 11 : la NAC est demandée au-delà du niveau 8, sans débordement ni erreur', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const png = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 120, g: 120, b: 120 },
    },
  })
    .png()
    .toBuffer();
  const nac: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const jpeg = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: CORS,
      body: TILE_JPEG,
    });
  await page.route('**trek.nasa.gov/**', (route) => {
    const url = route.request().url();
    if (!url.includes(NAC)) return jpeg(route);
    nac.push(url);
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: CORS,
      body: png,
    });
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto(
    `/?debug-surface&mode=explo&body=moon&place=Statio%20Tranquillitatis&date=${MOON_SCENE_DATE}`
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('canvas').first())
    .toHaveAttribute('data-search-focus', /^Statio Tranquillitatis\|/, {
      timeout: 90_000,
    })
    .catch(() => undefined);
  await expect
    .poll(
      async () => {
        await wheel(page);
        return nac.length;
      },
      { timeout: 240_000, intervals: [1500] }
    )
    .toBeGreaterThan(0);
  for (const url of nac) {
    const level = Number(/\/(\d+)\/\d+\/\d+\.png$/.exec(url)![1]);
    expect(level, url).toBeGreaterThan(8);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

async function wheel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -12_000,
        clientX: innerWidth / 2,
        clientY: innerHeight / 2,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}
