import { expect, test } from '@playwright/test';
import { mockOpenMeteo } from './openMeteoMock';

/**
 * LA COUCHE DE VENT, RALLUMÉE (2026-10-12). Trois promesses, chacune un défaut du prototype :
 *   - éteinte, elle ne demande RIEN à Open-Meteo (elle lançait son chargeur au démarrage) ;
 *   - cochée, elle charge vitesse ET direction dans la même requête et devient prête ;
 *   - elle porte un badge de source et une légende, qu'elle n'avait pas.
 * La donnée est simulée (`mockOpenMeteo`) : ce qu'on teste est le câblage, pas le vent.
 */
test('wind layer: silent when off, then sourced and legended when on', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await mockOpenMeteo(page, 30);
  const windRequests: string[][] = [];
  page.on('request', (request) => {
    if (!/open-meteo\.com/.test(request.url())) return;
    const hourly = (request.postDataJSON() as { hourly?: string[] } | null)
      ?.hourly;
    if (hourly?.includes('wind_speed_10m')) windRequests.push(hourly);
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

  await page.goto('/?debug-meteo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const debug = page.locator('#meteo-debug');
  await expect(debug).toContainText('wind [vector] idle OFF', {
    timeout: 30_000,
  });
  expect(
    windRequests,
    'aucune requête de vent tant que la couche est éteinte'
  ).toEqual([]);

  await page.locator('#weather-trigger').click();
  const item = page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Wind (Open-Meteo)' });
  await item.locator('input').check();
  await expect(debug).toContainText('wind [vector] ready ON', {
    timeout: 15_000,
  });

  // Vitesse et direction, dans les mêmes requêtes.
  expect(windRequests.length).toBeGreaterThan(0);
  for (const hourly of windRequests)
    expect(hourly).toEqual(['wind_speed_10m', 'wind_direction_10m']);

  await expect(item.locator('.wl-source')).toContainText('Open-Meteo');
  await expect(item.locator('.wl-legend-labels')).toContainText('0 km/h');
  await expect(item.locator('.wl-legend-labels')).toContainText('90+ km/h');

  expect(pageErrors).toEqual([]);
});
