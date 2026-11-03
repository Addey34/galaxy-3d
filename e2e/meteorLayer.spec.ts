import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES PLUIES DE MÉTÉORES : une couche éteinte par défaut dont le fichier n'est demandé qu'à la première
 * activation, qui n'écrit que les pluies ACTIVES à la date de la scène, et qui disparaît à l'extinction.
 * Le 14 décembre, les Géminides sont à leur pic ; le 3 janvier, ce sont les Quadrantides.
 */

async function boot(
  page: Page,
  requests: string[],
  date: string
): Promise<void> {
  await blockExternalNetwork(page);
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto(`/?mode=explo&body=neptune&date=${date}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#meteors-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

async function openToggle(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`${label} : les pluies se chargent à l'activation, se nomment et s'effacent à l'extinction`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const requests: string[] = [];
    await boot(page, requests, '2026-12-14T12:00:00Z');

    // Éteintes par défaut : ni fichier demandé, ni conteneur de noms.
    expect(requests.some((u) => u.includes('/sky/meteors.json'))).toBe(false);
    await expect(page.locator('.meteor-names')).toHaveCount(0);

    await openToggle(page);
    await page.locator('#meteors-toggle').check();

    const status = page.locator('#meteors-status');
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status).toContainText('IAU Meteor Data Center');
    expect(
      requests.filter((u) => u.includes('/sky/meteors.json'))
    ).toHaveLength(1);
    expect(
      Number((await status.textContent())?.match(/\d+/)?.[0])
    ).toBeGreaterThan(0);

    // Un nom au moins s'écrit à l'écran (la caméra regarde Neptune, des radiants sont dans le champ
    // à ce moment ou non : on ne l'impose qu'au conteneur, pas à sa position).
    await expect(page.locator('.meteor-names')).toHaveCount(1);

    // Rien ne déborde de la fenêtre à cette largeur.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.locator('#meteors-toggle').uncheck();
    await expect(status).toBeHidden();
    await expect(page.locator('.meteor-names')).toBeHidden();
  });
}

test('le nombre de pluies actives change avec la date de la scène', async ({
  page,
}) => {
  const requests: string[] = [];
  await boot(page, requests, '2026-12-14T12:00:00Z');
  await openToggle(page);
  await page.locator('#meteors-toggle').check();
  const status = page.locator('#meteors-status');
  await expect(status).toBeVisible({ timeout: 15_000 });
  const december = Number((await status.textContent())?.match(/\d+/)?.[0]);

  // Autre date de scène (page rechargée) : le calendrier des pluies suit la date de la scène.
  await page.goto('/?mode=explo&body=neptune&date=2026-07-20T12:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await openToggle(page);
  await page.locator('#meteors-toggle').check();
  await expect(status).toBeVisible({ timeout: 15_000 });
  const july = Number((await status.textContent())?.match(/\d+/)?.[0]);
  expect(december).toBeGreaterThan(0);
  expect(july).toBeGreaterThan(0);
  expect(july).not.toBe(december);
});
