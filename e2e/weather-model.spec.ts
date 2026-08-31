import { expect, test } from '@playwright/test';

test('cloud model fallback loads and activates without a WebGL shader error', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const shaderErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /WebGLProgram|Shader Error|GLSL|THREE\.WebGL/i.test(message.text())
    ) {
      shaderErrors.push(message.text());
    }
  });

  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**/api.open-meteo.com/**', async (route) => {
    const body = route.request().postDataJSON() as {
      latitude?: number[];
      hourly?: string[];
    };
    const variable = body.hourly?.[0] ?? 'cloud_cover';
    const points = (body.latitude ?? []).map(() => ({
      hourly: { [variable]: Array.from({ length: 48 }, () => 70) },
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(points),
    });
  });
  await page.route('**/archive-api.open-meteo.com/**', async (route) => {
    const body = route.request().postDataJSON() as {
      latitude?: number[];
      hourly?: string[];
    };
    const variable = body.hourly?.[0] ?? 'cloud_cover';
    const points = (body.latitude ?? []).map(() => ({
      hourly: { [variable]: Array.from({ length: 24 }, () => 70) },
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(points),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

  await page.goto('/?debug-meteo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const debug = page.locator('#meteo-debug');
  // Le modèle nuages est en activation MANUELLE : au boot il reste `idle OFF` (ne charge pas),
  // et ne passe `ready ON` qu'une fois coché dans le panneau.
  await expect(debug).toContainText('clouds-model [model] idle OFF', {
    timeout: 30_000,
  });

  await page.locator('#weather-trigger').click();
  const model = page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Clouds (Open-Meteo)' })
    .locator('input');
  await model.check();
  await expect(debug).toContainText('clouds-model [model] ready ON', {
    timeout: 15_000,
  });

  expect(pageErrors).toEqual([]);
  expect(shaderErrors).toEqual([]);
});
test('satellite cloud shader compiles with a local NASA image', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const shaderErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /WebGLProgram|Shader Error|GLSL|THREE\.WebGL/i.test(message.text())
    ) {
      shaderErrors.push(message.text());
    }
  });

  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**/api.open-meteo.com/**', (route) => route.abort());
  await page.route('**/archive-api.open-meteo.com/**', (route) =>
    route.abort()
  );
  await page.route('**/gibs.earthdata.nasa.gov/wms/**', (route) =>
    route.fulfill({ path: 'public/assets/textures/earth/earth_clouds_1k.jpg' })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

  await page.goto('/?debug-clouds');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#weather-trigger')).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(shaderErrors).toEqual([]);
});

test('raw cloud diagnostic uses True Color without supplemental maps', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const shaderErrors: string[] = [];
  const cloudDebug: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes('[cloud-debug]'))
      cloudDebug.push(message.text());
    if (
      message.type() === 'error' &&
      /WebGLProgram|Shader Error|GLSL|THREE\.WebGL/i.test(message.text())
    ) {
      shaderErrors.push(message.text());
    }
  });

  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**/api.open-meteo.com/**', (route) => route.abort());
  await page.route('**/archive-api.open-meteo.com/**', (route) =>
    route.abort()
  );
  await page.route('**/gibs.earthdata.nasa.gov/wms/**', (route) =>
    route.fulfill({ path: 'public/assets/textures/earth/earth_clouds_1k.jpg' })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

  await page.goto('/?debug-clouds-raw');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#weather-trigger')).toBeVisible();
  await expect
    .poll(() => cloudDebug.join('\n'))
    .toContain('True Color only (raw diagnostic)');

  expect(pageErrors).toEqual([]);
  expect(shaderErrors).toEqual([]);
});
