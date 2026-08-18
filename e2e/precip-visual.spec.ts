import { expect, test } from '@playwright/test';
import sharp from 'sharp';

async function createImergFixture(): Promise<Buffer> {
  const width = 1024;
  const height = 512;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const latitude = 90 - ((y + 0.5) / height) * 180;
    const nativeLatitude = Math.abs(latitude) <= 60;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const raining = nativeLatitude && (x * 3 + y * 5) % 11 < 5;
      pixels[offset] = (x + y) % 256;
      pixels[offset + 1] = (x * 7 + y) % 256;
      pixels[offset + 2] = 220;
      pixels[offset + 3] = raining ? 220 : 0;
    }
  }

  return sharp(pixels, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

test('IMERG keeps its native alpha mask and compiles the observed rain layer', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const shaderErrors: string[] = [];
  const imergFixture = await createImergFixture();

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
  await page.route('**/gibs.earthdata.nasa.gov/wms/**', async (route) => {
    if (!route.request().url().includes('IMERG_Precipitation')) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: imergFixture,
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

  await page.goto('/?debug-meteo&body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const debug = page.locator('#meteo-debug');
  await expect(debug).toContainText('precip [observed] ready ON', {
    timeout: 30_000,
  });
  await expect(debug).toContainText(
    'coverage: native-alpha-no-extrapolation lat=-90..90'
  );
  await expect(page.locator('canvas[data-engine]')).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(shaderErrors).toEqual([]);
});
