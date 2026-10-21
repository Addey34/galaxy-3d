import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  encodeBuildingTile,
  HEIGHT_ORIGIN,
  quantizeToTile,
  tileOfLonLat,
} from '@/core/buildingTile';
import { boot, prepareSurfacePage, TILE_JPEG, zoomIn } from './surfaceTiles';

/**
 * LES BÂTIMENTS 3D DE PARIS (lot 63, C.3b et C.4) : ce que l'application demande et quand, ce
 * qu'elle pose, et surtout ce que l'ÉCRAN dit : la légende des origines de hauteur et l'attribution
 * de la licence du jeu, sans quoi on afficherait des données de l'IGN sans les nommer.
 *
 * L'index et le manifeste sont les VRAIS fichiers livrés (`public/assets/buildings/`). Les tuiles,
 * elles, sont SERVIES PAR LE TEST (une tuile `GXBD` d'un bâtiment, au centre de l'indice demandé) :
 * la mesure ne dépend ni du service de données ni de fichiers absents de git.
 */

test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
});

test('draws the buildings of Paris, says where their heights come from, and asks for nothing from afar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
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
  const tileUrls: string[] = [];
  await page.route(
    '**galaxy-data.adrianguichard.dev/assets/buildings/**',
    (route) => {
      const url = route.request().url();
      tileUrls.push(url);
      const m = /\/(\d+)\/(\d+)\/(\d+)\.bin$/.exec(url);
      if (!m) return route.fulfill({ status: 404, body: 'x' });
      const [zoom, column, row] = m.slice(1).map(Number) as [
        number,
        number,
        number,
      ];
      // Un bâtiment au centre de la tuile demandée, mesuré à 30 m ; le décodeur refuse une
      // tuile dont l'en-tête ne nomme pas l'indice demandé.
      const [x, y] = [32768, 32768];
      const body = Buffer.from(
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
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
        body,
      });
    }
  );

  await boot(page, '?debug-surface&mode=educ&body=earth');
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  // De loin, ni tuile ni légende.
  expect(tileUrls, 'tuiles demandées avant toute approche').toEqual([]);
  await expect(page.locator('.si-buildings')).toBeHidden();

  // Viser Paris par la recherche, comme le ferait un visiteur.
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill('Paris');
  await page.locator('#palette-hit-0').click();

  const canvas = page.locator('canvas').first();
  await expect
    .poll(
      async () => {
        await zoomIn(page);
        return canvas.evaluate(
          (c) => (c as HTMLCanvasElement).dataset['buildings'] ?? ''
        );
      },
      { timeout: 120_000, intervals: [2_000] }
    )
    .toMatch(/^paris-bdtopo:\d+:[1-9]\d*$/);

  // L'écran dit d'où viennent les hauteurs et à qui appartiennent les données.
  const line = page.locator('.si-buildings');
  await expect(line).toBeVisible();
  await expect(line).toContainText('3D buildings');
  await expect(line).toContainText('measured');
  await expect(line).toContainText('IGN');
  await expect(line).toContainText('Licence Ouverte 2.0');
  // Une pastille ne porte jamais seule l'information : un libellé la suit.
  expect(await line.locator('.si-swatch').count()).toBeGreaterThan(0);

  // Chaque tuile demandée existe dans le manifeste livré, au zoom du jeu.
  const id = tileOfLonLat(2.353, 48.8581, 14);
  expect(
    tileUrls.some((u) => u.endsWith(`/14/${id.column}/${id.row}.bin`)),
    'la tuile sous la visée'
  ).toBe(true);
  expect(quantizeToTile(2.353, 48.8581, id)).toHaveLength(2);

  const axe = await new AxeBuilder({ page })
    .include('#surface-imagery')
    .analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
