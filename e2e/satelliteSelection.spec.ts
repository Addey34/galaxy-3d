import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LA SÉLECTION D'UN SATELLITE (GAL-SATELLITE-SELECTION-001) : un clic sur un point de la couche, ou le nom
 * tapé au clavier, ouvre la fiche de l'objet (identité, orbite, validité des éléments SGP4, altitude et
 * vitesse du moment) ; l'ISS donne accès à son inspection 3D, les autres disent qu'ils n'ont pas de modèle.
 * Le fichier servi est la lecture RÉELLE de CelesTrak du 2026-11-03 (`satellites.fixture.json`), à la date
 * de son époque. `device-satelliteSelection.spec.ts` rejoue le parcours au toucher sur téléphone.
 */
const FIXTURE_TEXT = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
);
const NAMES = new Map(
  (
    JSON.parse(FIXTURE_TEXT) as { objects: { id: number; name: string }[] }
  ).objects.map((o) => [o.id, o.name])
);
const INSIDE = '2026-11-02T19:00:00Z';
const ISS = 25544;

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.route('**/satellites/elements.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_TEXT,
    })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto(`/?mode=explo&body=earth&date=${INSIDE}&debug-satellites`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#satellites-toggle')).toBeEnabled({
    timeout: 40_000,
  });
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#satellites-toggle').check();
  await expect
    .poll(
      async () =>
        Number(
          await page.locator('#satellite-overlay').getAttribute('data-markers')
        ),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);
}

/** Les points peints à la dernière image : [numéro, x, y]. */
async function points(page: Page): Promise<[number, number, number][]> {
  return JSON.parse(
    (await page.locator('#satellite-overlay').getAttribute('data-points')) ??
      '[]'
  ) as [number, number, number][];
}

test('clavier : le nom de l’ISS ouvre sa fiche, ses nombres tiennent, l’inspection 3D s’ouvre et se ferme', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page);
  const search = page.locator('#satellite-search');
  await expect(search).toBeVisible();
  await search.fill('ISS');
  await search.press('Enter');

  const card = page.locator('#satellite-card');
  await expect(card).toBeVisible();
  await expect(page.locator('#satellite-card-name')).toHaveText('ISS (ZARYA)');
  await expect(card).toContainText('25544');
  await expect(card).toContainText('1998-067A');
  await expect(card).toContainText('2026-10-26'); // début de la validité : époque moins 7 jours
  await expect(card).toContainText('2026-11-09'); // fin : époque plus 7 jours
  // Période de l'ISS : 92,96 min (jeu d'éléments du 2026-11-02).
  await expect(card).toContainText(/92[.,]9/);
  // Altitude du moment, calculée par SGP4 : une station à 400-430 km.
  const altitude = await card
    .locator('dt', { hasText: 'Altitude now' })
    .locator('xpath=following-sibling::dd[1]')
    .textContent();
  const km = Number((altitude ?? '').replace(/[^\d]/g, ''));
  expect(km).toBeGreaterThan(380);
  expect(km).toBeLessThan(450);
  await expect(card).toContainText('SGP4');
  await expect(card).toContainText('computed, not measured');

  // L'ISS est le seul objet avec un modèle 3D : le bouton ouvre l'inspection, qui se ferme au retour.
  const inspect = page.locator('#satellite-card-inspect');
  await expect(inspect).toBeVisible();
  await inspect.click();
  await expect(page.locator('#craft-view')).toHaveAttribute(
    'data-craft-model',
    'iss-b'
  );
  await expect(page.locator('#craft-view')).toHaveAttribute(
    'data-craft-state',
    'ready',
    { timeout: 90_000 }
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#craft-view')).toHaveCount(0);
  await expect(page.locator('#satellite-overlay')).toBeVisible();
});

test('clic : un point de la couche ouvre la fiche de CET objet, sans sélectionner la Terre derrière lui', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page);
  await expect.poll(async () => (await points(page)).length).toBeGreaterThan(3);
  const painted = await points(page);
  // Un objet qui n'est pas l'ISS, au pixel près distinct des autres : cliqué en son centre, c'est le plus proche.
  const target = painted.find(
    ([id, x, y]) =>
      id !== ISS &&
      painted.every(
        ([other, ox, oy]) => other === id || Math.hypot(ox - x, oy - y) > 2
      )
  );
  expect(target, 'un satellite isolé est peint').toBeDefined();
  const [id, x, y] = target!;
  const before = page.url();
  await page.mouse.click(x, y);
  const card = page.locator('#satellite-card');
  await expect(card).toBeVisible();
  await expect(page.locator('#satellite-card-name')).toHaveText(NAMES.get(id)!);
  // Pas de modèle inventé : la fiche le dit, et ne propose pas d'inspection.
  await expect(card).toContainText('No 3D model for this object');
  await expect(page.locator('#satellite-card-inspect')).toBeHidden();
  // La Terre n'a pas été sélectionnée par le même clic : l'adresse garde son corps.
  expect(new URL(page.url()).pathname).toBe(new URL(before).pathname);

  // Échap ferme la fiche.
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('la fiche passe axe et une seule surface contextuelle reste ouverte', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page);
  await page.locator('#satellite-search').fill('ISS');
  await page.locator('#satellite-search').press('Enter');
  const card = page.locator('#satellite-card');
  await expect(card).toBeVisible();
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .include('#satellite-card')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // Ouvrir une autre surface (l'aide) referme la fiche.
  await page.locator('#help-btn').dispatchEvent('click');
  await expect(card).toBeHidden();
});

test('éteindre la couche referme la fiche et masque la recherche', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page);
  await page.locator('#satellite-search').fill('ISS');
  await page.locator('#satellite-search').press('Enter');
  await expect(page.locator('#satellite-card')).toBeVisible();
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#satellites-toggle').uncheck();
  await expect(page.locator('#satellite-card')).toBeHidden();
  await expect(page.locator('#satellite-search-row')).toBeHidden();
});
