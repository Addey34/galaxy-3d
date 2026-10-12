import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    .filter({ hasText: 'Wind (model)' });
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

/**
 * LE CHEMIN DU SERVICE DE DONNÉES (lot 46) : le manifeste et un champ réel (le fichier témoin que
 * l'encodeur Python écrit) servis par la route du service, Open-Meteo coupé. La couche doit lire
 * le service, ne jamais toucher Open-Meteo, et le DIRE dans son badge.
 */
test('wind layer reads the Galaxy data service first, and says so', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  const openMeteo: string[] = [];
  await page.route('**open-meteo.com/**', (route) => {
    openMeteo.push(route.request().url());
    return route.abort();
  });
  // Les instants du manifeste au pas de 3 h, de −12 h à +12 h, comme le vrai service. UN seul
  // instant « le plus proche de maintenant » rendait le scénario dépendant de l'heure : la couche
  // demande l'heure PLEINE de la scène, et à 04:34 elle cherchait 04:00 quand l'instant simulé
  // était 06:00, au-delà du demi-pas toléré (CI du 2026-10-12, vert en local).
  const step = 3 * 3_600_000;
  const base = Math.floor(Date.now() / step) * step;
  const times: Record<string, object> = {};
  for (let k = -4; k <= 4; k++) {
    const stamp = new Date(base + k * step)
      .toISOString()
      .slice(0, 13)
      .replace(/[-T]/g, '');
    times[stamp] = { cycle: stamp, kind: 'analysis', fields: ['wind10m'] };
  }
  const manifest = {
    format: 'GXF1',
    generated: new Date().toISOString(),
    source: { name: 'NOAA', url: '', licence: '' },
    stepHours: 3,
    path: 'gfs/{validTime}/{cycle}/{field}.bin',
    fields: { wind10m: { unit: 'm/s', bands: 2 } },
    times,
  };
  const fixture = readFileSync(
    resolve(import.meta.dirname, '../src/core/galaxyData.fixture.bin')
  );
  await page.route('**/galaxy-data.adrianguichard.dev/**', (route) =>
    route.request().url().endsWith('/manifest.json')
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(manifest),
        })
      : route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: fixture,
        })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

  await page.goto('/?debug-meteo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.locator('#weather-trigger').click();
  const item = page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Wind (model)' });
  await item.locator('input').check();
  await expect(page.locator('#meteo-debug')).toContainText(
    'wind [vector] ready ON',
    { timeout: 15_000 }
  );
  await expect(item.locator('.wl-source')).toContainText('NOAA GFS');
  expect(
    openMeteo,
    'Open-Meteo jamais interrogé quand le service répond'
  ).toEqual([]);
  expect(pageErrors).toEqual([]);
});
