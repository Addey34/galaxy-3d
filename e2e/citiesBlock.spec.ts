import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { encodeBuildingTile, HEIGHT_ORIGIN } from '@/core/buildingTile';
import { unfoldBodyCard } from './bodyCard';
import { cardEn } from '../src/i18n/dict-card-en';
import { boot, HERE, prepareSurfacePage, TILE_JPEG } from './surfaceTiles';

/** Les villes livrées, lues dans l'index publié, par nom anglais. */
const index = JSON.parse(
  readFileSync(join(HERE, '../public/assets/buildings/index.json'), 'utf8')
) as { sets: { id: string }[] };
const CITIES = index.sets
  .map(
    (set) => cardEn[`bi.cities.name.${set.id}` as keyof typeof cardEn] as string
  )
  .sort((a, b) => a.localeCompare(b, 'en'));

/**
 * LE BLOC « VILLES EN 3D » DE LA FICHE DE LA TERRE : la liste vient de l'index PUBLIÉ, chaque ville
 * est un bouton, et un clic plonge jusqu'à l'altitude où les bâtiments se posent. Avant lui, rien
 * ne disait qu'une ville existait en 3D : on ne la trouvait qu'en y étant déjà.
 * Les tuiles de bâtiments sont servies par le test (un bâtiment par tuile demandée).
 */
test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
  await page.route(
    '**gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/**',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        headers: { 'access-control-allow-origin': '*' },
        body: TILE_JPEG,
      })
  );
  await page.route(
    '**galaxy-data.adrianguichard.dev/assets/buildings/**',
    (route) => {
      const m = /\/(\d+)\/(\d+)\/(\d+)\.bin$/.exec(route.request().url());
      if (!m) return route.fulfill({ status: 404, body: 'x' });
      const [zoom, column, row] = m.slice(1).map(Number) as [
        number,
        number,
        number,
      ];
      const [x, y] = [32768, 32768];
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
        body: Buffer.from(
          encodeBuildingTile({
            zoom,
            column,
            row,
            buildings: [
              {
                ring: Uint16Array.from([
                  x,
                  y,
                  x + 900,
                  y,
                  x + 900,
                  y + 900,
                  x,
                  y + 900,
                ]),
                heightDecimetres: 300,
                origin: HEIGHT_ORIGIN.measured,
              },
            ],
          })
        ),
      });
    }
  );
});

test('lists the delivered cities on the Earth card, and nowhere else', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, '?mode=educ&body=earth');
  const block = page.locator('#body-info .bi-cities');
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(block.locator('.bi-cities-label')).toHaveText(
    `3D cities (${CITIES.length})`
  );
  await expect(block.locator('.bi-city')).toHaveText(CITIES);

  // Les autres corps n'en ont pas.
  await boot(page, '?mode=educ&body=mars');
  await expect(page.locator('#body-info .bi-name')).toContainText('Mars');
  await expect(page.locator('#body-info .bi-cities')).toBeHidden();
});

test('flies down to a city from its button, until its buildings are drawn', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, '?debug-surface&mode=educ&body=earth');
  const block = page.locator('#body-info .bi-cities');
  await expect(block).toBeVisible({ timeout: 30_000 });
  await block.getByRole('button', { name: 'Fly down to Berlin' }).click();

  const canvas = page.locator('canvas').first();
  await expect
    .poll(
      async () =>
        canvas.evaluate(
          (c) => (c as HTMLCanvasElement).dataset['buildings'] ?? ''
        ),
      { timeout: 180_000, intervals: [2_000] }
    )
    .toMatch(/^berlin-lod2:\d+:[1-9]\d*$/);
});

test('is reachable and unfolded on a phone, with a touch target of 40 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, '?mode=educ&body=earth');
  await unfoldBodyCard(page);
  const block = page.locator('#body-info .bi-cities');
  await expect(block).toBeVisible({ timeout: 30_000 });
  const box = await block.locator('.bi-city').first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('#body-info .bi-cities')
    .analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
