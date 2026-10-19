import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { clickWhenCalm } from './mainThread';
import { en } from '../src/i18n/dict-en';

/**
 * LES PRÉRÉGLAGES D'AFFICHAGE (lot 59) : un préréglage règle le tableau d'un coup, `?preset=`
 * l'applique à l'ouverture, et toucher une case ensuite le ramène à « Personnalisé ».
 *
 * Observé sur les CASES du tableau, qui sont l'état que l'application applique à la scène : le
 * rendu WebGL n'apporterait ici que de la lenteur.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

async function openSettings(page: import('@playwright/test').Page) {
  await clickWhenCalm(page, page.locator('#settings-trigger'));
  await expect(page.locator('#orbit-options')).toBeVisible();
}

test('?preset= applique le préréglage, que l’adresse oublie aussitôt', async ({
  page,
}) => {
  await page.goto('/?preset=missions');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await openSettings(page);

  const select = page.locator('#oo-preset-select');
  await expect(select).toHaveValue('missions');
  // Les sondes sont nommées, dessinées et tracées : les trois cases du GROUPE sont cochées.
  for (const key of [
    'settings.group.name.aria',
    'settings.group.body.aria',
    'settings.group.orbit.aria',
  ] as const)
    await expect(
      page.getByRole('checkbox', {
        name: en[key].replace('{group}', en['nav.group.spacecraft']),
      })
    ).toBeChecked();
  // C'est une ouverture, pas un état : l'adresse ne la garde pas.
  expect(page.url()).not.toContain('preset=');
});

test('toucher une case ramène à « Personnalisé », et « Par défaut » rend la règle', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await openSettings(page);

  const select = page.locator('#oo-preset-select');
  await expect(select).toHaveValue('default');
  const moonOrbits = page.getByRole('checkbox', {
    name: en['settings.group.orbit.aria'].replace(
      '{group}',
      en['nav.group.moon']
    ),
  });
  await expect(moonOrbits).not.toBeChecked();

  await select.selectOption('moons');
  await expect(moonOrbits).toBeChecked();
  await expect(page.locator('#oo-preset-desc')).not.toBeEmpty();

  await moonOrbits.uncheck();
  await expect(select).toHaveValue('custom');
  await expect(page.locator('#oo-preset-desc')).toBeEmpty();

  await select.selectOption('default');
  await expect(moonOrbits).not.toBeChecked();
  await expect(select).toHaveValue('default');
});

test('un préréglage inconnu ne change rien', async ({ page }) => {
  await page.goto('/?preset=nothing-here');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await openSettings(page);
  await expect(page.locator('#oo-preset-select')).toHaveValue('default');
});

// ─── Pas 3 (lot 61) : la météo et le champ de petits corps ─────────────────────────────────

async function weatherChecked(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLInputElement>('[data-layer]')].map(
        (box) => [box.dataset.layer, box.checked]
      )
    )
  );
}

async function fieldChecked(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLInputElement>('[data-category]')].map(
        (box) => [box.dataset.category, box.checked]
      )
    )
  );
}

test('les couches et catégories que les fiches nomment sont celles du panneau', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  const { PRESET_WEATHER_LAYERS, PRESET_FIELD_CATEGORIES } =
    await import('../src/registry/schema/preset');
  expect(Object.keys(await weatherChecked(page)).sort()).toEqual(
    [...PRESET_WEATHER_LAYERS].sort()
  );
  expect(Object.keys(await fieldChecked(page)).sort()).toEqual(
    [...PRESET_FIELD_CATEGORIES].sort()
  );
});

test('Classe éteint le champ de petits corps, Par défaut le rend', async ({
  page,
}) => {
  await page.goto('/?preset=school');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  expect(Object.values(await fieldChecked(page)).some(Boolean)).toBe(false);
  await openSettings(page);
  await expect(page.locator('#oo-preset-select')).toHaveValue('school');

  await page.locator('#oo-preset-select').selectOption('default');
  expect(Object.values(await fieldChecked(page)).every(Boolean)).toBe(true);
});

test('Météo de la Terre allume ses couches, et le préréglage suivant les remet au démarrage', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  const start = await weatherChecked(page);
  await openSettings(page);
  const select = page.locator('#oo-preset-select');

  await select.selectOption('earth-weather');
  const lit = await weatherChecked(page);
  expect(lit.clouds && lit.precip && lit.thermal).toBe(true);
  // Appliquer un préréglage clique des cases : ce n'est pas une main qui les touche.
  await expect(select).toHaveValue('earth-weather');

  await select.selectOption('clean');
  expect(await weatherChecked(page)).toEqual(start);
});

test('toucher une couche météo ramène à « Personnalisé »', async ({ page }) => {
  await page.goto('/?preset=earth-weather');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await openSettings(page);
  const select = page.locator('#oo-preset-select');
  await expect(select).toHaveValue('earth-weather');

  await page.evaluate(() => {
    const box = document.querySelector<HTMLInputElement>(
      '[data-layer="wind"]'
    )!;
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
  });
  await expect(select).toHaveValue('custom');
});
