import { expect, test, type Page, type Route } from '@playwright/test';
import { noisy } from './cloudComplementScenarios';

/**
 * LES NUAGES RÉGIONAUX (GAL-EARTH-CLOUD-REGIONAL-001) de bout en bout, sur un GIBS SIMULÉ : la couche mondiale
 * pose son image (WMS), puis, en approchant la Terre, la couche régionale demande les tuiles WMTS de la MÊME
 * couche et du MÊME jour, les peint (`data-cloud-shell`), et le sol reste la mosaïque fine (pas de fond du jour aux
 * nuages cuits). Éteindre les nuages retire tout. Le rendu sur les vraies données se mesure à part
 * (`scripts/measure-cloud-descent.mjs`, docs/ARCHITECTURE.md § « Les nuages régionaux »).
 */

const DAY = '2026-11-20';

async function serve(page: Page): Promise<{ wmts: string[] }> {
  const seen = { wmts: [] as string[] };
  const image = await noisy(null, 7);
  const jpeg = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: image,
    });
  await page.route('**gibs.earthdata.nasa.gov/**', (route) => {
    const url = new URL(route.request().url());
    const layers = url.searchParams.get('LAYERS');
    // La couche mondiale : l'image vraies couleurs du jour (les masques MODIS restent absents, comme un trou).
    if (layers === 'VIIRS_NOAA21_CorrectedReflectance_TrueColor')
      return jpeg(route);
    if (
      url.pathname.includes('/wmts/') &&
      !url.pathname.includes('/1.0.0/') &&
      url.pathname.includes('/VIIRS_NOAA21_CorrectedReflectance_TrueColor/')
    ) {
      seen.wmts.push(url.pathname);
      return jpeg(route);
    }
    return route.abort();
  });
  await page.route('**tiles.maps.eox.at/**', jpeg);
  return seen;
}

async function approach(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto(
    `/?debug-surface&debug-clouds&mode=explo&body=earth&date=${DAY}T07:20:00Z`
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 60_000,
  });
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Zoom par altitude depuis l'arrivée à 9 rayons : -3300 donne ~1,6 rayon, puis -800 ~1,3 (mesures de
  // `surfaceImageryEarth.spec.ts`), là où la couche mondiale s'efface et où la régionale sert.
  await page.mouse.wheel(0, -3300);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -800);
}

test('approcher la Terre peint les nuages régionaux de la même observation, sur le sol fin, et les éteindre les retire', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen = await serve(page);
  await approach(page);
  const canvas = page.locator('canvas').first();
  await expect
    .poll(
      async () => {
        const value = (await canvas.getAttribute('data-cloud-shell')) ?? '';
        const match = /^(\d{4}-\d{2}-\d{2}):(\d+):(\d+)\/(\d+)$/.exec(value);
        return match ? `${match[1]}:${Number(match[3]) > 0}` : value;
      },
      { timeout: 120_000, message: 'aucune tuile de nuages régionale peinte' }
    )
    .toBe(`${DAY}:true`);
  // La même couche ET le même jour que la couche mondiale : jamais une voisine.
  expect(seen.wmts.length).toBeGreaterThan(0);
  for (const path of seen.wmts) expect(path).toContain(`/${DAY}/`);
  // Le sol est la mosaïque fine : aucun fond du jour (ses nuages cuits doubleraient ceux de la coque).
  // Le fond du jour ne cède qu'une fois une tuile régionale PEINTE (`CloudShell.ready`) : on attend la bascule.
  await expect(page.locator('#surface-imagery')).not.toHaveAttribute(
    'data-day',
    /\d/,
    { timeout: 60_000 }
  );
  // Éteindre les nuages retire tout (un seul démarrage pour les deux constats : la CI est pleine).
  // Le panneau météo, comme un visiteur. Le clic est ENVOYÉ : la scène travaille encore sur un runner lent.
  await page.locator('#weather-trigger').dispatchEvent('click');
  // La case aussi : `uncheck` attend une action que la scène occupée ne rend pas sur un runner lent (run
  // 45524808645, 15 s dépassées trois fois). Un clic ENVOYÉ bascule la case et émet `change`.
  const clouds = page.locator('#weather-layers input[data-layer="clouds"]');
  await expect(clouds).toBeChecked();
  await clouds.dispatchEvent('click');
  await expect(clouds).not.toBeChecked();
  await expect(canvas).not.toHaveAttribute('data-cloud-shell', /.+/, {
    timeout: 60_000,
  });
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
