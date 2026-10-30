import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Une unité écrite après un nombre, jamais comme début d'un mot. Le numéro de source de la fiche
 * suit directement l'unité (« 71 492 km1 »), d'où l'absence de `\b` à droite.
 */
const unit = (name: string): RegExp =>
  new RegExp(`[ \u00a0]${name}(?![A-Za-z/²³])`);

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/**
 * LE BOUTON D'UNITÉS CONVERTIT LA FICHE ENTIÈRE (audit des panneaux, lot 1).
 *
 * Avant : il ne touchait que les kilomètres et les degrés Celsius. Jupiter, avec ses 71 492 km,
 * son 1,9 × 10²⁷ kg, ses 25,9 m/s², ses 150 m/s de vent et ses 0,16 kg/m³, restait métrique à
 * moitié. Le test bascule le réglage EN DIRECT et lit les statistiques de la fiche, pas la
 * description (un texte du catalogue, écrit une fois par langue).
 */
test('Jupiter’s card follows the unit switch, live', async ({ page }) => {
  await page.goto('/?body=jupiter');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  const stats = page.locator('#body-info .bi-stats');
  await expect(stats).toContainText('1 bar', { timeout: 30_000 });

  // Métrique par défaut : tout est en unités SI.
  await expect(stats).toContainText(unit('km'));
  await expect(stats).toContainText(unit('kg'));
  await expect(stats).toContainText('m/s²');
  await expect(stats).toContainText(/\d\s*m\/s\b/);
  await expect(stats).toContainText('°C');

  await page.locator('#settings-trigger').click();
  await page.locator('#units-toggle').check();

  // Impérial : plus une seule unité SI dans les statistiques, et les équivalents sont là.
  await expect(stats).toContainText(unit('mi'));
  await expect(stats).toContainText(unit('lb'));
  await expect(stats).toContainText('ft/s²');
  await expect(stats).toContainText(unit('mph'));
  await expect(stats).toContainText('°F');
  const text = (await stats.innerText()).replace(/\u00a0/g, ' ');
  expect(text).not.toMatch(unit('km'));
  expect(text).not.toMatch(unit('kg'));
  expect(text).not.toMatch(/m\/s/);
  expect(text).not.toContain('°C');

  // Et retour : la bascule est réversible sans recharger.
  await page.locator('#units-toggle').uncheck();
  await expect(stats).toContainText(unit('km'));
  await expect(stats).toContainText('m/s²');
});

/**
 * Les légendes de la météo suivent le même bouton : la barre des températures de modèle passe de
 * « −40 °C … +45 °C » à « −40 °F … +113 °F », celle du vent de km/h à mph. Le texte des bornes
 * est lu dans le DOM (le détail d'une couche inactive est replié, donc non visible).
 */
test('weather legends follow the unit switch, live', async ({ page }) => {
  await page.goto('/?body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.locator('#weather-trigger').click();
  const legends = page.locator('#weather-layers .wl-legend-labels');
  await expect(legends.first()).toBeAttached({ timeout: 30_000 });
  const read = async (): Promise<string> =>
    (await legends.allTextContents())
      .join(' | ')
      .split(String.fromCharCode(160))
      .join(' ');

  const metric = await read();
  expect(metric).toContain('km/h');
  expect(metric).toContain('hPa');
  expect(metric).toContain('mm/h');
  expect(metric).toContain('°C');

  await page.locator('#settings-trigger').click();
  await page.locator('#units-toggle').check();
  await expect.poll(read).toContain('mph');
  const imperial = await read();
  expect(imperial).toContain('inHg');
  expect(imperial).toContain('in/h');
  expect(imperial).toContain('°F');
  expect(imperial).not.toMatch(/km\/h|hPa|mm\/h|°C/);
});
