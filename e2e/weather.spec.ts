import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**/api.open-meteo.com/**', (route) => route.abort());
  await page.route('**/archive-api.open-meteo.com/**', (route) =>
    route.abort()
  );
  await page.route('**/gibs.earthdata.nasa.gov/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

async function openWeatherPanel(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();
}

function weatherRow(page: Page, label: string): Locator {
  return page.locator('#weather-layers .wl-item').filter({ hasText: label });
}

/**
 * Ce que montre la Terre AVANT que personne n'ait rien coché.
 *
 * Une seule couche d'emblée, les nuages : ce sont eux qui font ressembler la Terre à la Terre.
 * La pluie s'y empilait au démarrage et noyait la surface — d'où le signalement « pour moi
 * surcharger » ; elle est à un clic depuis `bd06d0c`. Le vent aussi, mais lui pour une raison
 * de règle et non de goût : c'est une couche d'INSTRUMENT au sens de CONTRIBUTING.md.
 *
 * **Ne pas justifier ces défauts par la règle des couches.** Elle range explicitement les
 * précipitations AVEC les nuages, en apparence physique, et elle décide de la largeur du
 * TERMINATEUR, pas de la visibilité au démarrage. `bd06d0c` l'a citée à tort, et ce commentaire
 * a d'abord repris l'erreur. Le défaut ci-dessous est un choix de sobriété, assumé comme tel et
 * réversible en une ligne (`initial:` dans `src/ui/precipLayer.ts`).
 *
 * Ce test a échoué trois runs de suite en CI avant d'être remis d'accord avec le code, parce que
 * le job e2e ne bloque pas le déploiement. C'est le vrai enseignement : un test rouge est parti
 * en production sans que rien ne s'y oppose.
 */
test('desktop weather defaults are explicit and satellite-first', async ({
  page,
}) => {
  await openWeatherPanel(page);

  await expect(page.locator('#weather-layers .wl-item')).toHaveCount(8);
  await expect(
    weatherRow(page, 'Clouds (NASA)').locator('input')
  ).toBeChecked();
  await expect(
    weatherRow(page, 'Clouds (Open-Meteo)').locator('input')
  ).not.toBeChecked();
  await expect(
    weatherRow(page, 'Rain (NASA IMERG)').locator('input')
  ).not.toBeChecked();
  await expect(
    weatherRow(page, 'Rain (Open-Meteo)').locator('input')
  ).not.toBeChecked();
  await expect(
    weatherRow(page, 'Air temperature (MERRA-2)').locator('input')
  ).not.toBeChecked();
  await expect(
    weatherRow(page, 'Air temperature (Open-Meteo)').locator('input')
  ).not.toBeChecked();
  await expect(
    weatherRow(page, 'Sea-level pressure (Open-Meteo)').locator('input')
  ).not.toBeChecked();
  await expect(
    weatherRow(page, 'Relative humidity (Open-Meteo)').locator('input')
  ).not.toBeChecked();
});

test('satellite and model layers are mutually exclusive', async ({ page }) => {
  await openWeatherPanel(page);

  const satellite = weatherRow(page, 'Clouds (NASA)').locator('input');
  const model = weatherRow(page, 'Clouds (Open-Meteo)').locator('input');
  await model.check();
  await expect(model).toBeChecked();
  await expect(satellite).not.toBeChecked();

  await satellite.check();
  await expect(satellite).toBeChecked();
  await expect(model).not.toBeChecked();
});

test('weather debug exposes the render contract', async ({ page }) => {
  await page.goto('/?debug-meteo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const debug = page.locator('#meteo-debug');
  await expect(debug).toBeVisible();
  await expect(debug).toContainText('clouds [realtime]');
  await expect(debug).toContainText('clouds-model [model] idle OFF');
  await expect(debug).toContainText('precip [observed]');
  await expect(debug).toContainText('thermal-model [model]');
  await expect(debug).toContainText('pressure-model [model]');
  await expect(debug).toContainText('humidity-model [model]');
  await expect(debug).toContainText('geometry: SphereGeometry');

  const initialDebugText = await debug.innerText();
  const cloudsStart = initialDebugText.indexOf('clouds [realtime]');
  const cloudsEnd = initialDebugText.indexOf(
    String.fromCharCode(10) + String.fromCharCode(10),
    cloudsStart
  );
  const cloudsSnapshot = initialDebugText.slice(cloudsStart, cloudsEnd);
  expect(cloudsSnapshot).toContain('render: hidden');
  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();
  await weatherRow(page, 'Relative humidity (Open-Meteo)')
    .locator('input')
    .check();
  await expect
    .poll(() => debug.innerText())
    .toMatch(/humidity-model \[model\] (idle|loading|ready|error) ON/);
  const debugText = await debug.innerText();
  const humidityStart = debugText.indexOf('humidity-model [model]');
  const humidityEnd = debugText.indexOf(
    String.fromCharCode(10) + String.fromCharCode(10),
    humidityStart
  );
  const humiditySnapshot = debugText.slice(humidityStart, humidityEnd);
  expect(humiditySnapshot).toContain('render: hidden');
});
test('pressure and humidity models stay optional and mutually exclusive', async ({
  page,
}) => {
  await openWeatherPanel(page);

  const thermal = weatherRow(page, 'Air temperature (Open-Meteo)').locator(
    'input'
  );
  const pressure = weatherRow(page, 'Sea-level pressure (Open-Meteo)').locator(
    'input'
  );
  const humidity = weatherRow(page, 'Relative humidity (Open-Meteo)').locator(
    'input'
  );

  await expect(thermal).not.toBeChecked();
  await expect(pressure).not.toBeChecked();
  await expect(humidity).not.toBeChecked();

  await pressure.check();
  await expect(pressure).toBeChecked();
  await expect(thermal).not.toBeChecked();
  await expect(humidity).not.toBeChecked();

  await humidity.check();
  await expect(humidity).toBeChecked();
  await expect(pressure).not.toBeChecked();

  await thermal.check();
  await expect(thermal).toBeChecked();
  await expect(humidity).not.toBeChecked();
});
test.describe('mobile weather defaults', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('mobile weather layers stay available but disabled by default', async ({
    page,
  }) => {
    await openWeatherPanel(page);

    await expect(page.locator('#weather-layers .wl-item')).toHaveCount(8);
    await expect(
      weatherRow(page, 'Clouds (NASA)').locator('input')
    ).not.toBeChecked();
    await expect(
      weatherRow(page, 'Rain (NASA IMERG)').locator('input')
    ).not.toBeChecked();
    await expect(
      weatherRow(page, 'Rain (Open-Meteo)').locator('input')
    ).not.toBeChecked();
    await expect(
      weatherRow(page, 'Sea-level pressure (Open-Meteo)')
    ).toHaveCount(1);
    await expect(
      weatherRow(page, 'Relative humidity (Open-Meteo)')
    ).toHaveCount(1);
  });

  test('mobile weather layer activates with one click', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('gibs.earthdata.nasa.gov')) {
        requests.push(request.url());
      }
    });

    await openWeatherPanel(page);
    const clouds = weatherRow(page, 'Clouds (NASA)').locator('input');
    await clouds.check();

    await expect(clouds).toBeChecked();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
  });
});
