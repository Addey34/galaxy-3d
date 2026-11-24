import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { clickWhenCalm } from './mainThread';
import { openSettingsTab } from './settingsTab';

/**
 * LA SÉLECTION D'UN SATELLITE (GAL-SATELLITE-SELECTION-001) : un clic sur un point de la couche, ou le nom
 * tapé au clavier, ouvre la fiche de l'objet (identité, orbite, validité des éléments SGP4, altitude et
 * vitesse du moment) ; l'ISS donne accès à son inspection 3D, les autres disent qu'ils n'ont pas de modèle.
 * Le fichier servi est la lecture RÉELLE de CelesTrak du 2026-11-03 (`satellites.fixture.json`), à la date
 * de son époque. `device-satelliteSelection.spec.ts` rejoue le parcours au toucher sur téléphone.
 *
 * Trois scénarios et non six : chacun démarre l'application (plusieurs secondes en CI), donc les
 * vérifications qui partagent un état (la fiche ouverte) partagent un démarrage (GAL-ENGINE-HEADROOM-001).
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

/** La valeur de la ligne de la fiche dont le libellé commence ainsi, ou `null` si la ligne n'existe pas. */
async function row(page: Page, label: string): Promise<string | null> {
  const dt = page.locator('#satellite-card dt', { hasText: label });
  if ((await dt.count()) === 0) return null;
  return dt.locator('xpath=following-sibling::dd[1]').textContent();
}

/** Le champ de recherche vit dans les réglages (onglet scène) : une autre surface le masque, on le rouvre. */
async function searchFor(page: Page, name: string): Promise<void> {
  if (!(await page.locator('#satellite-search').isVisible())) {
    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
  }
  await page.locator('#satellite-search').fill(name);
  await page.locator('#satellite-search').press('Enter');
}

const kilometres = (text: string | null): number =>
  Number((text ?? '').replace(/[^\d]/g, ''));

test('clavier : le nom de l’ISS ouvre sa fiche, ses nombres tiennent, axe, une seule surface, puis l’inspection 3D', async ({
  page,
}) => {
  test.setTimeout(300_000);
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
  const km = kilometres(await row(page, 'Altitude now'));
  expect(km).toBeGreaterThan(380);
  expect(km).toBeLessThan(450);
  await expect(card).toContainText('SGP4');
  await expect(card).toContainText('computed, not measured');

  // Aucune violation d'accessibilité sur la fiche.
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .include('#satellite-card')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Une seule surface contextuelle : ouvrir l'aide referme la fiche.
  await page.locator('#help-btn').dispatchEvent('click');
  await expect(card).toBeHidden();
  await searchFor(page, 'ISS');
  await expect(card).toBeVisible();

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

test('clic : un point ouvre la fiche de CET objet (sans la Terre derrière lui), sans modèle inventé ; éteindre la couche referme tout', async ({
  page,
}) => {
  test.setTimeout(300_000);
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
  // La Terre n'a pas été sélectionnée par le même clic : l'adresse garde son chemin.
  expect(new URL(page.url()).pathname).toBe(new URL(before).pathname);

  // Échap ferme la fiche ; la rouvrir puis éteindre la couche la referme et masque la recherche.
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await searchFor(page, NAMES.get(id)!);
  await expect(card).toBeVisible();
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#satellites-toggle').uncheck();
  await expect(card).toBeHidden();
  await expect(page.locator('#satellite-search-row')).toBeHidden();
});

test('la fenêtre SGP4 : la fiche ouverte perd ses valeurs instantanées hors de la validité des éléments, et les retrouve au retour', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await boot(page);
  await page.locator('#satellite-search').fill('ISS');
  await page.locator('#satellite-search').press('Enter');
  const card = page.locator('#satellite-card');
  await expect(card).toBeVisible();

  // Dans la fenêtre (l'époque de l'ISS est le 2026-11-02, valable jusqu'au 11-09) : les valeurs vivantes sont là.
  const inside = kilometres(await row(page, 'Altitude now'));
  expect(inside).toBeGreaterThan(380);
  expect(inside).toBeLessThan(450);
  await expect(card.locator('.sat-status')).toBeHidden();
  await expect(card).toContainText('Speed now (SGP4)');
  await expect(card).toContainText('Over (SGP4)');

  // La date de la scène sort de la fenêtre : un mois et demi plus tard, SGP4 n'a plus de sens pour ces éléments.
  await clickWhenCalm(page, page.locator('#time-readout'));
  const date = page.locator('#date-input');
  await expect(date).toBeVisible({ timeout: 30_000 });
  await date.fill('2026-12-20');
  await date.blur();
  // La fiche reste ouverte, dit pourquoi, et n'affiche plus AUCUNE valeur instantanée.
  await expect(card).toBeVisible();
  await expect(card.locator('.sat-status')).toContainText('out of validity', {
    timeout: 15_000,
  });
  expect(await row(page, 'Altitude now')).toBeNull();
  expect(await row(page, 'Speed now')).toBeNull();
  expect(await row(page, 'Over')).toBeNull();
  // Ce qui ne dépend pas de la date reste : identité, orbite, fenêtre de validité.
  await expect(card).toContainText('25544');
  await expect(card).toContainText('2026-11-09');
  // Et l'objet n'est plus dessiné : hors validité, il n'est ni cerclé ni cliquable.
  await expect
    .poll(
      async () =>
        Number(
          await page.locator('#satellite-overlay').getAttribute('data-markers')
        ),
      { timeout: 15_000 }
    )
    .toBe(0);

  // Retour dans la fenêtre : les valeurs reviennent, sans rouvrir la fiche.
  await date.fill('2026-11-02');
  await date.blur();
  await expect(card.locator('.sat-status')).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => kilometres(await row(page, 'Altitude now')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(380);
  expect(kilometres(await row(page, 'Altitude now'))).toBeLessThan(450);
  await expect(card).toContainText('Speed now (SGP4)');
});
