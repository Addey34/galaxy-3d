import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { clickWhenCalm } from './mainThread';
import { en } from '../src/i18n/dict-en';

/**
 * UN LIEN PARTAGÉ REDONNE LA MÊME IMAGE (lot 60) : le tableau « Dans la scène » (en écarts à la
 * règle de départ) et les couches météo actives voyagent avec le corps, la date et la caméra.
 * Observé sur les CASES, qui sont l'état appliqué à la scène.
 */

test.beforeEach(async ({ page, context }) => {
  await blockExternalNetwork(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const ioOrbit = en['settings.row.orbit.aria'].replace('{name}', 'Io');

async function expandMoons(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Moons \d+$/ }).click();
}

test('le bouton Partager écrit les écarts du tableau et les couches actives', async ({
  page,
}) => {
  await page.goto('/?body=jupiter&date=2026-09-23T00:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });

  // Rien n'a changé dans le tableau : le lien ne porte pas `scene`.
  await page.locator('#share-btn').click();
  let shared = new URL(
    await page.evaluate(() => navigator.clipboard.readText())
  );
  expect(shared.searchParams.has('scene')).toBe(false);

  await clickWhenCalm(page, page.locator('#settings-trigger'));
  await expandMoons(page);
  await page.getByRole('checkbox', { name: ioOrbit }).check();
  await page.locator('#orbit-options .surface-close').click();
  await clickWhenCalm(page, page.locator('#weather-trigger'));
  // Quel que soit le démarrage de l'appareil, on part de nuages éteints puis on les allume.
  const clouds = page.getByRole('checkbox', { name: en['weather.clouds'] });
  await clouds.uncheck();
  await clouds.check();
  await page.locator('#weather-layers .surface-close').click();

  await page.locator('#share-btn').click();
  shared = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(shared.searchParams.get('scene')).toBe('o+io');
  // L'état de chaque couche est écrit, allumé ou éteint : le démarrage n'est pas le même sur
  // ordinateur et sur mobile.
  const layers = (shared.searchParams.get('layers') ?? '').split(',');
  expect(layers).toContain('+clouds');
  expect(layers).toContain('-precip');
});

test('ouvrir ce lien rallume les mêmes cases, et l’adresse les oublie', async ({
  page,
}) => {
  await page.goto(
    '/jupiter/?date=2026-09-23T00:00:00Z&scene=o%2Bio&layers=%2Bclouds,-precip'
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });

  await clickWhenCalm(page, page.locator('#settings-trigger'));
  await expandMoons(page);
  await expect(page.getByRole('checkbox', { name: ioOrbit })).toBeChecked();
  // Une seule case change : les autres lunes gardent la règle de départ.
  await expect(
    page.getByRole('checkbox', {
      name: en['settings.row.orbit.aria'].replace('{name}', 'Europa'),
    })
  ).not.toBeChecked();
  await expect(page.locator('#oo-preset-select')).toHaveValue('custom');
  await page.locator('#orbit-options .surface-close').click();

  await clickWhenCalm(page, page.locator('#weather-trigger'));
  await expect(
    page.getByRole('checkbox', { name: en['weather.clouds'] })
  ).toBeChecked();

  expect(page.url()).not.toContain('scene=');
  expect(page.url()).not.toContain('layers=');
});

test('un écart ou une couche inconnus ne cassent rien', async ({ page }) => {
  await page.goto('/?scene=o%2Bnobody,zz,l-%3Cb%3E&layers=nothing-here');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await clickWhenCalm(page, page.locator('#settings-trigger'));
  await expect(page.locator('#orbit-options')).toBeVisible();
});

test('le champ de petits corps éteint voyage dans le lien, et rien quand il est entier', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.locator('#share-btn').click();
  let shared = new URL(
    await page.evaluate(() => navigator.clipboard.readText())
  );
  expect(shared.searchParams.has('field')).toBe(false);

  await page.evaluate(() => {
    for (const id of ['neo', 'comet']) {
      const box = document.querySelector<HTMLInputElement>(
        `[data-category="${id}"]`
      )!;
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    }
  });
  await page.locator('#share-btn').click();
  shared = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(shared.searchParams.get('field')).toBe('-comet,-neo');

  const fresh = await page.context().newPage();
  await blockExternalNetwork(fresh);
  await fresh.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await fresh.goto(shared.pathname + shared.search);
  await expect(fresh.locator('#loader')).toBeHidden({ timeout: 60_000 });
  const state = await fresh.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLInputElement>('[data-category]')].map(
        (box) => [box.dataset.category, box.checked]
      )
    )
  );
  expect(state).toEqual({
    'main-belt': true,
    neo: false,
    comet: false,
    tno: true,
  });
  expect(fresh.url()).not.toContain('field=');
});
