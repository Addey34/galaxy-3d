import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import { boot, prepareSurfacePage, TILE_JPEG } from './surfaceTiles';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * UNE MOSAÏQUE RÉGIONALE À EMPRISE, DANS UN VRAI NAVIGATEUR (GAL-IMMERSION-003B).
 *
 * La mosaïque LROC NAC du site d'Apollo 11 (60 x 60 km, NASA Trek) prend la suite de la base
 * lunaire (WAC, niveau 8) au-delà de son niveau, DANS son emprise seulement. Les tuiles sont
 * servies par le test (aucun réseau). Ce que le scénario prouve :
 *  - près du site, des tuiles de niveau > 8 partent vers la couche NAC, toutes dans l'emprise
 *    publiée, et le bandeau crédite l'LROC ;
 *  - à la mer de la Tranquillité (hors emprise), AUCUNE tuile NAC n'est demandée ;
 *  - une couche NAC qui répond 404 laisse la base à l'écran (pas de trou), sans boucle de requêtes.
 */
const NAC = 'A11_60x60km.eq';
// Emprise lue dans les capacités WMTS de Trek (fiche du jeu de tuiles), 2026-11-20.
const BBOX = [22.4806483, -0.3193414, 24.459338, 1.6593483] as const;

let opaquePng: Buffer;
test.beforeAll(async () => {
  opaquePng = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 120, g: 120, b: 120 },
    },
  })
    .png()
    .toBuffer();
});

test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
});

const CORS = { 'access-control-allow-origin': '*' };
const jpeg = (route: Route) =>
  route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    headers: CORS,
    body: TILE_JPEG,
  });

/** Niveau, ligne et colonne lus à la fin d'une adresse de tuile WMTS. */
function indexOf(url: string): { level: number; row: number; col: number } {
  const m = /\/(\d+)\/(\d+)\/(\d+)\.(?:png|jpg)$/.exec(url);
  if (!m) throw new Error(`adresse de tuile inattendue : ${url}`);
  return { level: Number(m[1]), row: Number(m[2]), col: Number(m[3]) };
}

async function flyTo(page: Page, place: string): Promise<void> {
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').pressSequentially(place);
  const hit = page
    .locator('.palette-hit[data-kind="place"]')
    .filter({ hasText: 'Moon' })
    .first();
  await expect(hit).toContainText(place, { timeout: 30_000 });
  await hit.click();
  await expect(page.locator('canvas').first()).toHaveAttribute(
    'data-search-focus',
    new RegExp(`^${place}\\|`),
    { timeout: 60_000 }
  );
}

async function descend(page: Page, steps: number): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, -12_000);
    await page.waitForTimeout(1500);
  }
}

test('Apollo 11 : la NAC sert au-delà du niveau 8, dans son emprise, et le bandeau la crédite', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const nac: string[] = [];
  const wac: string[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    const url = route.request().url();
    if (url.includes(NAC)) {
      nac.push(url);
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: CORS,
        body: opaquePng,
      });
    }
    wac.push(url);
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(
    page,
    `?debug-surface&mode=explo&body=moon&date=${MOON_SCENE_DATE}`
  );
  await flyTo(page, 'Statio Tranquillitatis');
  const credit = page.locator('#surface-imagery .si-credit');
  await expect
    .poll(
      async () => {
        await descend(page, 1);
        return (await credit.textContent()) ?? '';
      },
      { timeout: 240_000, intervals: [500] }
    )
    .toMatch(/LROC NAC|Lunar Reconnaissance/i);
  expect(nac.length).toBeGreaterThan(0);
  // Toute tuile NAC demandée est au-delà de la base et DANS l'emprise publiée.
  for (const url of nac) {
    const { level, row, col } = indexOf(url);
    expect(level, url).toBeGreaterThan(8);
    const size = 360 / (2 * 2 ** level);
    const west = -180 + col * size;
    const north = 90 - row * size;
    expect(west + size, url).toBeGreaterThan(BBOX[0]);
    expect(west, url).toBeLessThan(BBOX[2]);
    expect(north, url).toBeGreaterThan(BBOX[1]);
    expect(north - size, url).toBeLessThan(BBOX[3]);
  }
  // La base ne sert jamais au-delà de son propre niveau.
  for (const url of wac) expect(indexOf(url).level, url).toBeLessThanOrEqual(8);
  await expect(page.locator('#surface-imagery')).toHaveAttribute(
    'data-level',
    /^(9|1\d)$/
  );
});

test('la mer de la Tranquillité, hors emprise, ne demande aucune tuile NAC', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const nac: string[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    if (route.request().url().includes(NAC)) nac.push(route.request().url());
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(
    page,
    `?debug-surface&mode=explo&body=moon&date=${MOON_SCENE_DATE}`
  );
  await flyTo(page, 'Mare Tranquillitatis');
  await descend(page, 8);
  await expect(page.locator('#surface-imagery')).toHaveAttribute(
    'data-level',
    /^\d+$/
  );
  expect(nac).toEqual([]);
  await expect(page.locator('#surface-imagery .si-credit')).not.toContainText(
    /LROC NAC/i
  );
});

test('une couche NAC absente (404) laisse la base à l’écran, sans redemande en boucle', async ({
  page,
}) => {
  test.setTimeout(300_000);
  let missed = 0;
  await page.route('**trek.nasa.gov/**', (route) => {
    if (route.request().url().includes(NAC)) {
      missed += 1;
      return route.fulfill({ status: 404, headers: CORS, body: '' });
    }
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(
    page,
    `?debug-surface&mode=explo&body=moon&date=${MOON_SCENE_DATE}`
  );
  await flyTo(page, 'Statio Tranquillitatis');
  await descend(page, 8);
  await expect.poll(() => missed, { timeout: 120_000 }).toBeGreaterThan(0);
  const painted = await page
    .locator('#surface-imagery')
    .getAttribute('data-painted');
  expect(Number(painted)).toBeGreaterThan(0);
  await expect(page.locator('#surface-imagery .si-credit')).not.toContainText(
    /LROC NAC/i
  );
  const seen = missed;
  await page.waitForTimeout(5000);
  // Un manque se retient : pas une nouvelle vague de requêtes à chaque image.
  expect(missed - seen).toBeLessThanOrEqual(4);
});
