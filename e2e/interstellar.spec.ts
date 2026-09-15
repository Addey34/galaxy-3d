import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  // Évite que le tour d'accueil première-visite n'intercepte les clics sur les boutons de mode.
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

/**
 * `data-markers` / `data-tracks` : marqueurs peints dans le champ / objets dans leur fenêtre à
 * la dernière frame — la seule trace DOM de ce que la couche a dessiné (cf. interstellarOverlay).
 */
test('interstellar overlay is active in educ AND explo, and draws 1I near Earth at its discovery', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 2017-10-19 : découverte de 1I/ʻOumuamua, à 0,2 UA de la Terre — dans le cadre de la vue
  // d'ensemble, dans les deux modes.
  await page.goto('/?date=2017-10-19T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const overlay = page.locator('#interstellar-overlay');
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toHaveClass(/is-visible/);
  await expect(overlay).toHaveCSS('pointer-events', 'none');
  await expect
    .poll(async () => Number(await overlay.getAttribute('data-markers')))
    .toBeGreaterThanOrEqual(1);
  // Les trois objets sont dans leur fenêtre (1I : +40 j, 2I : −2 ans, 3I : −8 ans du périhélie).
  await expect(overlay).toHaveAttribute('data-tracks', '3');

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(overlay).toHaveClass(/is-visible/);
  await expect
    .poll(async () => Number(await overlay.getAttribute('data-markers')))
    .toBeGreaterThanOrEqual(1);

  await page.locator('.mode-btn[data-mode=educ]').click();
  await expect(overlay).toHaveClass(/is-visible/);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('draws nothing outside the verified window around perihelion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 1950 : plus de 20 ans avant chacun des trois périhélies — hors de la plage vérifiée
  // contre Horizons, donc ni marqueur ni trajectoire. `data-tracks` porte la preuve :
  // `data-markers` vaudrait 0 même sans borne, ces objets étant alors hors champ.
  await page.goto('/?date=1950-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const overlay = page.locator('#interstellar-overlay');
  await expect(overlay).toHaveClass(/is-visible/);
  await expect(overlay).toHaveAttribute('data-tracks', '0');
  await expect(overlay).toHaveAttribute('data-markers', '0');
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
