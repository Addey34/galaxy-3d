import { expect, test } from '@playwright/test';
import { boot, prepareSurfacePage, TILE_JPEG } from './surfaceTiles';

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
  test.setTimeout(300_000);
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

  // On descend par crans jusqu'à ce que le BANDEAU crédite l'IGN : il décrit la tuile SOUS la
  // caméra, donc les premières tuiles régionales (vers le bord du champ) ne suffisent pas. La
  // position du canevas est lue UNE fois : la relire à chaque cran attendait le fil principal,
  // saturé sur le coureur par l'arrivée des tuiles (`boundingBox` dépassé, run 38981348969).
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const credit = page.locator('#surface-imagery .si-credit');
  try {
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, -12_000);
          return (await credit.textContent()) ?? '';
        },
        { timeout: 180_000, intervals: [2000] }
      )
      .toContain('IGN, BD ORTHO®');
  } catch (error) {
    // Ce qu'il faut pour comprendre un échec du coureur sans le rejouer : où est la caméra,
    // quel niveau est servi sous elle, combien de requêtes sont parties vers l'IGN.
    const probe = (await page.locator('#surface-probe').textContent()) ?? '';
    const badge = page.locator('#surface-imagery');
    console.log(
      `[regional] ${ign.length} requêtes IGN ; niveau du bandeau ${await badge.getAttribute('data-level')} ; ` +
        probe.replace(/\s+/g, ' ').slice(0, 900)
    );
    throw error;
  }
  expect(ign.length).toBeGreaterThan(0);
  // LE PLANCHER SUIT LA SOURCE RÉGIONALE : calculé pour la base (Blue Marble), il arrêtait la
  // caméra à 46,9 km au-dessus de Paris, où la tuile du centre restait celle de la base, et
  // l'IGN n'était jamais servie sous la visée (run 38985771615, sur trois tentatives).
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, -12_000);
        const text = (await page.locator('#surface-probe').textContent()) ?? '';
        const match = /altitude\s+(-?[\d.]+) km/.exec(text);
        return match ? Number(match[1]) : Infinity;
      },
      { timeout: 90_000, intervals: [2000] }
    )
    .toBeLessThan(30);

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
});
