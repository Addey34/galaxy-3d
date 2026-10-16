import { expect, test } from '@playwright/test';
import { boot, prepareSurfacePage, TILE_JPEG, zoomIn } from './surfaceTiles';

/**
 * L'ORTHOPHOTO DE L'IGN SOUS LES 10 M (lot 53, pas 4), dans un vrai navigateur.
 *
 * Ce que ce scénario prouve : on CHERCHE « Paris » (les noms de la Terre sont dans la recherche),
 * la caméra se tourne vers Paris, on descend, et les tuiles AU-DELÀ du niveau le plus fin de la
 * base partent vers le WMS de l'IGN, sur des emprises en France, demandées en EPSG:4326 sur la
 * grille de la base ; le bandeau crédite alors l'IGN. Les tuiles sont SERVIES par le test.
 */
test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
});

test('approaching Paris, the tiles beyond the base come from the IGN', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const tile = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  const ign: string[] = [];
  await page.route('**data.geopf.fr/**', (route) => {
    ign.push(decodeURIComponent(route.request().url()));
    return tile(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', tile);
  await page.route('**tiles.maps.eox.at/**', tile);

  await boot(page, '?debug-surface&mode=explo&date=2024-07-01T12:00:00Z');
  await page.locator('#body-search-trigger').click();
  const input = page.locator('#palette-input');
  await input.pressSequentially('Paris');
  const hit = page
    .locator('.palette-hit[data-kind="place"]')
    .filter({ hasText: 'Earth' })
    .first();
  await expect(hit).toContainText('Paris', { timeout: 30_000 });
  await hit.click();
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Paris\|/, {
    timeout: 60_000,
  });

  // On descend par crans jusqu'à ce que l'IGN serve : le plancher ne baisse qu'à mesure que des
  // niveaux plus fins se peignent (`e2e/surfaceImageryEarth.spec.ts`, même méthode).
  await expect
    .poll(
      async () => {
        await zoomIn(page);
        return ign.length;
      },
      { timeout: 150_000, intervals: [1500] }
    )
    .toBeGreaterThan(0);

  for (const url of ign) {
    expect(url).toContain('SERVICE=WMS');
    expect(url).toContain('CRS=EPSG:4326');
    const [south, west, north, east] = /BBOX=([^&]+)/
      .exec(url)![1]!
      .split(',')
      .map(Number) as [number, number, number, number];
    // Autour de Paris, et STRICTEMENT plus fine que la base : la mosaïque Blue Marble de GIBS,
    // base par défaut, s'arrête au niveau 7 de sa grille, dont les tuiles mesurent 2,25° ; l'IGN
    // prend la main au niveau 8 (1,125°), puis 0,5625°, 0,28125°… (mesuré le 2026-10-17).
    expect(south, url).toBeGreaterThan(47.5);
    expect(north, url).toBeLessThan(50.5);
    expect(west, url).toBeGreaterThan(0.5);
    expect(east, url).toBeLessThan(4.5);
    expect(east - west, url).toBeLessThanOrEqual(1.125);
  }
  await expect(page.locator('#surface-imagery .si-credit')).toContainText(
    'IGN, BD ORTHO®',
    { timeout: 60_000 }
  );
});
