import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { blockExternalNetwork } from './netBlock';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * LA MATRICE MOBILE (`pnpm test:mobile`, `playwright.mobile.config.ts`) : les mêmes parcours sur un
 * Pixel 7 (Chromium) et un iPhone 15 (WebKit). Chaque scénario mesure ce qu'un téléphone montre :
 * pas de débordement horizontal, un canvas qui n'est PAS noir (luminance mesurée sur la capture),
 * aucune erreur de console. Les captures vont dans `reports/mobile/<appareil>/`, à regarder.
 *
 * Les seuils de luminance sont des PLANCHERS contre l'écran noir, pas des cibles de beauté : la
 * visite du Nil rendait 3 à 6 sur 255 (côté nuit) quand elle était cassée.
 */

const OUT = 'reports/mobile';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    } catch {
      /* stockage refusé : le scénario tourne sans */
    }
  });
});

/** Luminance (0 à 255) au 90e centile des pixels du canvas, lue sur une capture de la page. */
async function canvasLuminance(page: Page, label: string): Promise<number> {
  const device = test.info().project.name;
  mkdirSync(`${OUT}/${device}`, { recursive: true });
  const png = await page.screenshot({ path: `${OUT}/${device}/${label}.png` });
  const { data } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ys: number[] = [];
  for (let i = 0; i < data.length; i += 3) {
    ys.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  ys.sort((a, b) => a - b);
  return ys[Math.floor(0.9 * (ys.length - 1))];
}

/** Le pire débordement horizontal de la page, en pixels, rogné ou non. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - window.innerWidth);
  });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

for (const [body, floor] of [
  ['earth', 25],
  ['moon', 25],
  ['mercury', 25],
] as const) {
  test(`${body} : démarre, ne déborde pas, n'est pas noir`, async ({
    page,
  }) => {
    await blockExternalNetwork(page);
    const errors = trackConsoleErrors(page);
    await page.goto(`/fr/${body}/?date=${MOON_SCENE_DATE}`);
    await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
    // Le temps que les textures du palier de départ arrivent et se déposent.
    await page.waitForTimeout(8_000);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    expect(await canvasLuminance(page, body)).toBeGreaterThan(floor);
    // Les refus réseau volontaires (services coupés) ne sont pas des défauts du produit.
    const own = errors.filter(
      (e) => !/ERR_FAILED|Failed to load resource|net::|aborted/i.test(e)
    );
    expect(own).toEqual([]);
  });
}

test('la palette et les réglages tiennent dans la largeur', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.goto(`/fr/earth/?date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(5_000);

  for (const trigger of ['#body-search-trigger', '#settings-trigger']) {
    const button = page.locator(trigger);
    if ((await button.count()) === 0) continue;
    await button.first().tap();
    await page.waitForTimeout(800);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await canvasLuminance(page, `surface-${trigger.replace(/\W/g, '')}`);
    await page.keyboard.press('Escape');
  }
});

test('la visite du delta du Nil plonge sur le delta et le montre éclairé', async ({
  page,
}) => {
  test.skip(
    test.info().project.name === 'iphone',
    "WebKit émulé : la plongée sur imagerie réelle n'est mesurée que sur Chromium"
  );
  await page.goto('/fr/earth/?tour=nile-delta');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });

  // La plongée a atteint son nom : c'est le fait publié sur le canvas, pas une durée.
  await expect(page.locator('canvas').first()).toHaveAttribute(
    'data-place-dive',
    /^Nile Delta\|/,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(6_000);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  // Le défaut corrigé par #279 : visée sur la face nocturne, 3 à 6 sur 255.
  expect(await canvasLuminance(page, 'nile-delta')).toBeGreaterThan(20);
});
