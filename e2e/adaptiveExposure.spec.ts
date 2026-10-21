import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * L'EXPOSITION S'ADAPTE AU CORPS SUIVI (lot 65) : la Lune et Mercure, plus sombres que l'albédo
 * de référence, montent ; Mars et la vue d'ensemble ne bougent pas ; le réglage de l'utilisateur
 * est MULTIPLIÉ, jamais remplacé.
 *
 * La valeur lue est celle du rendu lui-même (`renderer.toneMappingExposure`, par la sonde
 * `?debug-eclipse`), pas une luminance de capture : en rendu logiciel une luminance dépend de la
 * machine, une exposition non.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

async function exposureOf(page: Page, query: string, stored?: string) {
  await page.addInitScript((value) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
    if (value) localStorage.setItem('ssv-exposure', value);
  }, stored);
  await page.goto(`/?debug-eclipse&mode=explo${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  const read = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            eclipseProbe?: {
              state(body: string): { toneMappingExposure: number };
            };
          }
        ).eclipseProbe?.state('moon').toneMappingExposure ?? 0
    );
  // L'adaptation est exponentielle (0,6 s) : on attend qu'elle se stabilise.
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await read();
        const settled = Math.abs(now - last) < 1e-3;
        last = now;
        return settled ? now : -1;
      },
      { timeout: 30_000, intervals: [700] }
    )
    .toBeGreaterThan(0);
  return read();
}

test('raises the exposure for a dark followed body, to the capped ratio', async ({
  page,
}) => {
  // Lune : albédo publié 0,12, rapport 0,3 / 0,12 = 2,5, qui est aussi la borne.
  expect(
    await exposureOf(page, `&body=moon&date=${MOON_SCENE_DATE}`)
  ).toBeCloseTo(2.5, 1);
});

test('leaves a bright followed body at the user exposure', async ({ page }) => {
  expect(await exposureOf(page, '&body=mars')).toBeCloseTo(1, 2);
});

test('multiplies the user slider instead of replacing it', async ({ page }) => {
  expect(
    await exposureOf(page, `&body=moon&date=${MOON_SCENE_DATE}`, '1.2')
  ).toBeCloseTo(3.0, 1);
});
