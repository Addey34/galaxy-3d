import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import { boot, prepareSurfacePage, TILE_JPEG } from './surfaceTiles';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * LES MOSAÏQUES RÉGIONALES À EMPRISE, DANS UN VRAI NAVIGATEUR (GAL-IMMERSION-003B).
 *
 * LROC NAC (Apollo 11, 60 x 60 km) et MRO CTX (Olympus Mons) de NASA Trek prennent la suite de la
 * base (WAC niveau 8 ; Viking niveau 7) dans leur emprise seulement. Les tuiles sont servies par
 * le test (aucun réseau). Le bandeau doit dire ce qui est PEINT :
 *  - base d'abord (titre WAC ou Viking), puis NAC ou CTX quand une tuile régionale est peinte ;
 *  - jamais NAC/CTX sur la seule foi d'une requête ou d'une emprise : 404, PNG à pixel transparent
 *    (VRAI PNG décodé par le navigateur) ou tuiles en attente laissent la base, et le plancher
 *    d'approche ne descend pas avec la sélection ;
 *  - toute tuile régionale demandée est ENTIÈREMENT dans l'emprise publiée.
 */
const NAC = 'A11_60x60km.eq';
const CTX = 'olympus_mons.eq';
// Emprises lues dans les capacités WMTS de Trek (fiches de jeux de tuiles), 2026-11-20.
const NAC_BBOX = [22.4806483, -0.3193414, 24.459338, 1.6593483] as const;
const CTX_BBOX = [-136, 12, -124, 24] as const;
const CORS = { 'access-control-allow-origin': '*' };

let opaquePng: Buffer;
let holedPng: Buffer;
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
  // Un PNG gris dont UN SEUL pixel est transparent : un trou de la mosaïque, décodé pour de vrai.
  const raw = Buffer.alloc(256 * 256 * 4, 255);
  raw.fill(120, 0, raw.length);
  for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
  raw[(10 * 256 + 10) * 4 + 3] = 0;
  holedPng = await sharp(raw, { raw: { width: 256, height: 256, channels: 4 } })
    .png()
    .toBuffer();
});

test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
});

const jpeg = (route: Route) =>
  route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    headers: CORS,
    body: TILE_JPEG,
  });
const png = (route: Route, body: Buffer) =>
  route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: CORS,
    body,
  });

/** Niveau, ligne et colonne lus à la fin d'une adresse de tuile WMTS. */
function indexOf(url: string): { level: number; row: number; col: number } {
  const m = /\/(\d+)\/(\d+)\/(\d+)\.(?:png|jpg)$/.exec(url);
  if (!m) throw new Error(`adresse de tuile inattendue : ${url}`);
  return { level: Number(m[1]), row: Number(m[2]), col: Number(m[3]) };
}

async function flyTo(page: Page, place: string, body: string): Promise<void> {
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').pressSequentially(place);
  const hit = page
    .locator('.palette-hit[data-kind="place"]')
    .filter({ hasText: body })
    .first();
  await expect(hit).toContainText(place, { timeout: 30_000 });
  await hit.click();
  await expect(page.locator('canvas').first()).toHaveAttribute(
    'data-search-focus',
    new RegExp(`^${place}\\|`),
    { timeout: 60_000 }
  );
}

async function descend(
  page: Page,
  steps: number,
  delta = -12_000
): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(1500);
  }
}

/** Descend d'un cran à la fois jusqu'à ce que le bandeau d'imagerie dise quelque chose. */
async function untilBadge(page: Page): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        await descend(page, 1, -2500);
        text = ((await headline(page).textContent()) ?? '').trim();
        return text;
      },
      { timeout: 120_000, intervals: [300] }
    )
    .not.toBe('');
  return text;
}

const headline = (page: Page) => page.locator('#surface-imagery .si-headline');
const credit = (page: Page) => page.locator('#surface-imagery .si-credit');
const badge = (page: Page) => page.locator('#surface-imagery');

async function altitudeKm(page: Page): Promise<number> {
  const text = (await page.locator('#surface-probe').textContent()) ?? '';
  const match = /altitude\s+(-?[\d.]+) km/.exec(text);
  return match ? Number(match[1]) : Infinity;
}

const moonUrl = `?debug-surface&mode=explo&body=moon&date=${MOON_SCENE_DATE}`;
const marsUrl = `?debug-surface&mode=explo&body=mars&date=${MOON_SCENE_DATE}`;

test('Apollo 11 : WAC d’abord, NAC une fois une tuile NAC peinte, toutes ENTIÈREMENT dans l’emprise', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const nac: string[] = [];
  const wac: string[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    const url = route.request().url();
    if (url.includes(NAC)) {
      nac.push(url);
      return png(route, opaquePng);
    }
    wac.push(url);
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(page, moonUrl);
  await flyTo(page, 'Statio Tranquillitatis', 'Moon');
  // Avant toute descente : la base, nommée WAC, sans mention du NAC.
  expect(await untilBadge(page)).toContain('LRO WAC');
  await expect(credit(page)).not.toContainText(/LROC NAC/i);
  await expect
    .poll(
      async () => {
        await descend(page, 1);
        return (await headline(page).textContent()) ?? '';
      },
      { timeout: 240_000, intervals: [500] }
    )
    .toContain('LRO NAC');
  await expect(credit(page)).toContainText('LROC NAC images');
  await expect(headline(page)).not.toContainText('WAC');
  expect(nac.length).toBeGreaterThan(0);
  // Une tuile régionale n'est demandée que si elle est ENTIÈREMENT dans l'emprise publiée.
  for (const url of nac) {
    const { level, row, col } = indexOf(url);
    expect(level, url).toBeGreaterThan(8);
    const size = 360 / (2 * 2 ** level);
    const west = -180 + col * size;
    const north = 90 - row * size;
    const eps = 1e-9;
    expect(west, url).toBeGreaterThanOrEqual(NAC_BBOX[0] - eps);
    expect(west + size, url).toBeLessThanOrEqual(NAC_BBOX[2] + eps);
    expect(north - size, url).toBeGreaterThanOrEqual(NAC_BBOX[1] - eps);
    expect(north, url).toBeLessThanOrEqual(NAC_BBOX[3] + eps);
  }
  for (const url of wac) expect(indexOf(url).level, url).toBeLessThanOrEqual(8);
  await expect(badge(page)).toHaveAttribute('data-level', /^(9|1\d)$/);
});

test('la mer de la Tranquillité, hors emprise : WAC, aucune requête NAC', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const nac: string[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    if (route.request().url().includes(NAC)) nac.push(route.request().url());
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(page, moonUrl);
  await flyTo(page, 'Mare Tranquillitatis', 'Moon');
  await descend(page, 8);
  await expect(headline(page)).toContainText('LRO WAC');
  await expect(credit(page)).not.toContainText(/LROC NAC/i);
  await expect(badge(page)).toHaveAttribute('data-level', /^[1-8]$/);
  expect(nac).toEqual([]);
});

test('NAC en 404 : la base reste annoncée à son niveau, sans redemande en boucle', async ({
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
  await boot(page, moonUrl);
  await flyTo(page, 'Statio Tranquillitatis', 'Moon');
  await descend(page, 8);
  await expect.poll(() => missed, { timeout: 120_000 }).toBeGreaterThan(0);
  expect(
    Number(await badge(page).getAttribute('data-painted'))
  ).toBeGreaterThan(0);
  await expect(headline(page)).toContainText('LRO WAC');
  await expect(credit(page)).not.toContainText(/LROC NAC/i);
  expect(
    Number(await badge(page).getAttribute('data-level'))
  ).toBeLessThanOrEqual(8);
  // Le plancher ne suit pas la sélection : un niveau au-delà de la base au plus (≈ 2 km au-dessus
  // du sol de la mare), pas les 62 m qu'un NAC servi autorise.
  expect(await altitudeKm(page)).toBeGreaterThan(0.5);
  const seen = missed;
  await page.waitForTimeout(5000);
  expect(missed - seen).toBeLessThanOrEqual(4);
});

test('NAC : un VRAI PNG à un pixel transparent est un trou, la base est montrée', async ({
  page,
}) => {
  test.setTimeout(300_000);
  let asked = 0;
  await page.route('**trek.nasa.gov/**', (route) => {
    if (route.request().url().includes(NAC)) {
      asked += 1;
      return png(route, holedPng);
    }
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(page, moonUrl);
  await flyTo(page, 'Statio Tranquillitatis', 'Moon');
  await descend(page, 8);
  await expect.poll(() => asked, { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(headline(page)).toContainText('LRO WAC');
  await expect(credit(page)).not.toContainText(/LROC NAC/i);
  expect(await altitudeKm(page)).toBeGreaterThan(0.5);
  const seen = asked;
  await page.waitForTimeout(5000);
  expect(asked - seen).toBeLessThanOrEqual(4);
});

test('NAC en attente : la base est annoncée, le plancher ne descend pas ; la réponse arrive, la NAC est nommée', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const held: Array<() => Promise<void>> = [];
  let release = false;
  await page.route('**trek.nasa.gov/**', (route) => {
    if (!route.request().url().includes(NAC)) return jpeg(route);
    if (release) return png(route, opaquePng);
    held.push(() => png(route, opaquePng));
    return Promise.resolve();
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(page, moonUrl);
  await flyTo(page, 'Statio Tranquillitatis', 'Moon');
  await descend(page, 8);
  await expect.poll(() => held.length, { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(headline(page)).toContainText('LRO WAC');
  await expect(credit(page)).not.toContainText(/LROC NAC/i);
  expect(await altitudeKm(page)).toBeGreaterThan(0.5);
  release = true;
  for (const answer of held.splice(0)) await answer().catch(() => undefined);
  await expect
    .poll(
      async () => {
        await descend(page, 1);
        return (await headline(page).textContent()) ?? '';
      },
      { timeout: 120_000, intervals: [500] }
    )
    .toContain('LRO NAC');
});

test('Olympus Mons : Viking d’abord, CTX une fois peinte, toutes les tuiles CTX dans l’emprise', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const ctx: string[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    const url = route.request().url();
    if (url.includes(CTX)) {
      ctx.push(url);
      return png(route, opaquePng);
    }
    return jpeg(route);
  });
  await page.route('**gibs.earthdata.nasa.gov/**', jpeg);
  await boot(page, marsUrl);
  await flyTo(page, 'Olympus Mons', 'Mars');
  expect(await untilBadge(page)).toContain('Viking');
  await expect(credit(page)).not.toContainText(/CTX/);
  await expect
    .poll(
      async () => {
        await descend(page, 1);
        return (await headline(page).textContent()) ?? '';
      },
      { timeout: 240_000, intervals: [500] }
    )
    .toContain('MRO CTX');
  await expect(credit(page)).toContainText('MRO CTX images');
  await expect(headline(page)).not.toContainText('Viking');
  for (const url of ctx) {
    const { level, row, col } = indexOf(url);
    expect(level, url).toBeGreaterThan(7);
    const size = 360 / (2 * 2 ** level);
    const west = -180 + col * size;
    const north = 90 - row * size;
    const eps = 1e-9;
    expect(west, url).toBeGreaterThanOrEqual(CTX_BBOX[0] - eps);
    expect(west + size, url).toBeLessThanOrEqual(CTX_BBOX[2] + eps);
    expect(north - size, url).toBeGreaterThanOrEqual(CTX_BBOX[1] - eps);
    expect(north, url).toBeLessThanOrEqual(CTX_BBOX[3] + eps);
  }
});
