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

/** Ouvre les Réglages et coche une colonne pour tout le groupe des objets interstellaires. */
async function checkInterstellarGroup(
  page: import('@playwright/test').Page,
  column: 1 | 2 | 3
): Promise<void> {
  await page.locator('#settings-trigger').click();
  await page
    .locator(
      `.oo-group[data-group="nav.group.interstellar"] .oo-group-row td:nth-child(${column + 1}) .oo-checkbox`
    )
    .check();
  await page.keyboard.press('Escape');
}

/**
 * `data-markers` / `data-tracks` : marqueurs peints dans le champ / objets dans leur fenêtre à
 * la dernière frame — la seule trace DOM de ce que la couche a dessiné (cf. interstellarOverlay).
 *
 * Les objets interstellaires sont en OPTION au premier chargement, comme les sondes (cf.
 * `ui/defaultDisplay.ts`) : la couche est active, les trois objets sont dans leur fenêtre, mais
 * rien n'est peint tant que la colonne « Objet » ne les montre pas.
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
  await expect(overlay).toHaveAttribute('data-tracks', '3');
  await expect(overlay).toHaveAttribute('data-markers', '0');

  await checkInterstellarGroup(page, 2);
  await expect
    .poll(async () => Number(await overlay.getAttribute('data-markers')))
    .toBeGreaterThanOrEqual(1);
  // Les trois objets sont dans leur fenêtre (1I : +40 j, 2I : −2 ans, 3I : −8 ans du périhélie).
  await expect(overlay).toHaveAttribute('data-tracks', '3');
  // …mais leurs trajectoires ne sont PAS tracées par défaut : trois hyperboles ouvertes
  // traversant la vue d'ensemble se lisaient comme des orbites cassées. Opt-in (Réglages).
  await expect(overlay).toHaveAttribute('data-paths', '0');

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

/**
 * La trajectoire est la colonne « Orbite » de la ligne de l'objet : une hyperbole tient la
 * place d'une orbite, avec les mêmes mots et les mêmes cases. Elle se règle objet par objet,
 * et, comme tout le contenu de la scène, elle ne se conserve pas d'une visite à l'autre (seules
 * les préférences de rendu et de lecture le sont) ; l'ancienne clé de stockage est effacée.
 */
test('trajectories are the Orbit column of the interstellar rows, one object at a time', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.addInitScript(() =>
    localStorage.setItem('ssv-interstellar-paths', '1')
  );
  await page.goto('/?date=2017-10-19T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const overlay = page.locator('#interstellar-overlay');
  // L'ancien réglage conservé ne rallume rien, et il est effacé du navigateur.
  await expect(overlay).toHaveAttribute('data-paths', '0');
  expect(
    await page.evaluate(() => localStorage.getItem('ssv-interstellar-paths'))
  ).toBeNull();

  await page.locator('#settings-trigger').click();
  await page
    .locator('.oo-group[data-group="nav.group.interstellar"] .oo-group-toggle')
    .click();
  const row = page.locator('#settings-table .oo-tr', { hasText: 'Borisov' });
  const trajectory = row.locator('td:nth-child(4) .oo-checkbox');
  await expect(trajectory).toHaveAttribute('aria-label', /trajectory/);
  await expect(trajectory).not.toBeChecked();
  await trajectory.check();
  await expect(overlay).toHaveAttribute('data-paths', '1');
  // Tracée sans que le marqueur soit montré, comme l'orbite d'un corps masqué.
  await expect(overlay).toHaveAttribute('data-markers', '0');

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
