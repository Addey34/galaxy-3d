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
 * La couche des sondes est désormais active dans les DEUX modes.
 *
 * Elle était réservée à l'Exploration tant qu'une sonde n'était qu'un point décoratif. Depuis
 * qu'on peut la CHERCHER et la CIBLER, la restreindre à un mode ouvrait une vue sur un point
 * que rien ne dessinait : sélectionner Juno en Éducatif montrait le vide. Les objets
 * interstellaires suivaient déjà cette règle, pour une raison voisine.
 */
test('spacecraft overlay is present and visible in both display modes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?date=2020-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const overlay = page.locator('#spacecraft-overlay');
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toHaveClass(/is-visible/);
  // Le canvas ne prend pas le pointeur : le clic est résolu sur le canvas WebGL, qui consulte
  // les marqueurs avant de lancer son rayon (cf. `ui/bodyPicker.ts`).
  await expect(overlay).toHaveCSS('pointer-events', 'none');

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(overlay).toHaveClass(/is-visible/);

  await page.locator('.mode-btn[data-mode=educ]').click();
  await expect(overlay).toHaveClass(/is-visible/);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * CE QUE MONTRE LA PREMIÈRE VUE : les sondes sont en OPTION (cf. `ui/defaultDisplay.ts`).
 *
 * Défaut mesuré au 2026-09-22 : BepiColombo, OSIRIS-REx, Parker Solar Probe et Juno nommés dès
 * le chargement, le nom d'OSIRIS-REx sur celui de Vénus. Mais l'objet SÉLECTIONNÉ est toujours
 * peint : choisir Juno ne doit pas ouvrir une vue sur un point que rien ne dessine.
 */
test('no probe is painted on first load, except the selected one', async ({
  page,
}) => {
  const overlay = page.locator('#spacecraft-overlay');
  await page.goto('/?date=2026-09-22T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(overlay).toHaveClass(/is-visible/);
  // Plusieurs sondes sont dans le champ de la vue d'ensemble à cette date : c'est le réglage,
  // et non leur position, qui les tait.
  await expect(overlay).toHaveAttribute('data-markers', '0');

  await page.locator('#settings-trigger').click();
  await page
    .locator(
      '.oo-group[data-group="nav.group.spacecraft"] .oo-group-row td:nth-child(3) .oo-checkbox'
    )
    .check();
  await expect
    .poll(async () => Number(await overlay.getAttribute('data-markers')))
    .toBeGreaterThanOrEqual(3);

  await page.goto('/?body=juno&date=2026-09-22T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#body-info .bi-name')).toHaveText('Juno');
  await expect(overlay).toHaveAttribute('data-markers', '1');
});

test('mounts without error at a date before every mission launch', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?mode=explo&date=1970-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('#spacecraft-overlay')).toHaveClass(/is-visible/);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * UNE SONDE SE CHERCHE, SE SÉLECTIONNE ET SE RÈGLE COMME N'IMPORTE QUEL CORPS.
 *
 * Défaut livré : onze sondes et trois objets interstellaires étaient nommés à l'écran et
 * n'existaient nulle part ailleurs. Le trajet complet est vérifié ici parce qu'il traverse
 * quatre modules qu'aucun test unitaire ne relie : la palette, la commande de navigation
 * partagée, l'ancre qui donne à la caméra un objet à suivre, et la fiche.
 */
test('a probe is searchable, selectable and listed in the settings table', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?date=2020-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill('Juno');
  const entry = page.locator('#orbit-juno');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('aria-disabled', 'false');

  await entry.click();
  await expect(page.locator('#orbit-juno')).toHaveClass(/is-active/);
  await expect(page.locator('#body-info .bi-name')).toHaveText('Juno');
  // Le chemin d'URL porte la sélection comme pour tout autre corps.
  await expect(page).toHaveURL(/body=juno/);

  // Et elle a une ligne de réglages : nom et marqueur, jamais d'orbite (elle n'en a pas).
  await page.keyboard.press('Escape');
  await page.locator('#settings-trigger').click();
  const row = page
    .locator('#settings-table .oo-tr')
    .filter({ hasText: 'Juno' })
    .first();
  await expect(row.locator('.oo-checkbox')).toHaveCount(2);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * Une sonde n'existe pas à toute date, et l'interface doit le dire plutôt que d'emmener la
 * caméra sur la dernière position connue. Cassini a fini sa mission dans Saturne en 2017 : en
 * 2020 son fichier Horizons ne répond plus, et l'entrée reste listée mais inerte.
 */
test('a probe outside its Horizons coverage is listed but not selectable', async ({
  page,
}) => {
  await page.goto('/?date=2020-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill('Cassini');
  const entry = page.locator('#orbit-cassini');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('aria-disabled', 'true');

  // Un clic réel, pas `locator.click()` : Playwright refuse de cliquer ce que l'ARIA déclare
  // désactivé, or c'est justement l'inertie du gestionnaire qu'on veut mesurer.
  await entry.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(entry).not.toHaveClass(/is-active/);
  await expect(page.locator('#body-info .bi-name')).not.toHaveText('Cassini');
});
