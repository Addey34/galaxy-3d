import { expect, test } from '@playwright/test';

/**
 * LA TEMPÉRATURE DE LA MER DU JOUR DE LA SCÈNE (lot 53, pas 2).
 *
 * GHRSST MUR est une analyse de niveau 4 : ni une mesure brute, ni un modèle. Ce scénario prouve
 * dans un vrai navigateur que la couche demande le BON jour à GIBS, que son badge le dit
 * « analysé » et non « observé », et que sa légende porte les bornes LUES dans le barème de la
 * NASA. Une vraie image locale sert de réponse : le badge n'existe qu'avec une tuile appliquée.
 */
test('la température de la mer demande le jour de la scène, et se dit analysée', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**open-meteo.com/**', (route) => route.abort());
  await page.route('**galaxy-data.adrianguichard.dev/**', (route) =>
    route.abort()
  );
  const asked: string[] = [];
  await page.route('**gibs.earthdata.nasa.gov/wms/**', (route) => {
    asked.push(decodeURIComponent(route.request().url()));
    return route.fulfill({
      path: 'public/assets/textures/earth/earth_clouds_1k.jpg',
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?date=2010-03-05T15%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.locator('#weather-trigger').click({ timeout: 30_000 });

  const row = page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Sea surface temperature (GHRSST)' });
  await row.locator('input').check({ timeout: 30_000 });

  const badge = row.locator('.wl-source');
  await expect(badge).toContainText('GHRSST MUR', { timeout: 30_000 });
  await expect(badge).toContainText('analysed');
  await expect(badge).not.toContainText('observed');
  expect(
    asked.some(
      (url) =>
        url.includes('LAYERS=GHRSST_L4_MUR_Sea_Surface_Temperature') &&
        url.includes('TIME=2010-03-05')
    )
  ).toBe(true);
  // Bornes du barème de la NASA, en °C : 0 et 32 (lues par `pnpm gibs:colormap`).
  await expect(row.locator('.wl-legend-labels')).toContainText('+0 °C');
  await expect(row.locator('.wl-legend-labels')).toContainText('+32 °C');
});
