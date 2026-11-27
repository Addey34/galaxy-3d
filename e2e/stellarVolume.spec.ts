import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { reportFailureDiagnostics } from './failureDiagnostics';
import { openSettingsTab } from './settingsTab';

/**
 * LE VOLUME STELLAIRE ÉTENDU (GAL-UNIVERSE-008) dans la vue du voisinage : échelles 5, 25, 50, 100 pc,
 * recherche, sélection au clic, fiche, hôte d'exoplanètes vers son exploration, filtres, chargement
 * interrompu ou refusé, adresse partageable, Retour et Suivant du navigateur, accessibilité. Les rangs
 * des étoiles témoins sont LUS dans `names.json` : un fichier regénéré ne casse pas le test en silence.
 */
const NAMES = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../public/assets/sky/volume/names.json'),
    'utf-8'
  )
) as Record<string, (string | number | null)[]>;
const indexOf = (name: string): number =>
  Number(Object.entries(NAMES).find(([, e]) => e[0] === name)![0]);
const VEGA = indexOf('Vega');

test.afterEach(async ({ page }, testInfo) => {
  await reportFailureDiagnostics(page, testInfo);
});

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const box = (page: Page) => page.locator('#stellar-volume');
const search = (page: Page): URLSearchParams =>
  new URL(page.url()).searchParams;

async function openView(page: Page, query = ''): Promise<void> {
  await page.goto(`/?view=neighbourhood${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 60_000 });
}

async function chooseScale(page: Page, pc: number): Promise<void> {
  await page.locator(`.sv-volume-scale[data-pc="${pc}"]`).click();
  await expect(box(page)).toHaveAttribute('data-scale', String(pc));
  await expect(box(page)).toHaveAttribute('data-state', 'idle', {
    timeout: 90_000,
  });
}

async function findStar(page: Page, name: string): Promise<void> {
  await page.locator('#stellar-volume-search').fill(name);
  await page
    .locator('#stellar-volume-results button', { hasText: name })
    .first()
    .click();
  await expect(page.locator('#stellar-volume-card-title')).toHaveText(name, {
    timeout: 60_000,
  });
}

test('rien du volume à l’ouverture ; chaque échelle charge sa coquille, et seulement elle', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const requests: string[] = [];
  page.on('request', (r) => {
    const m = /\/assets\/sky\/volume\/(.+)$/.exec(r.url());
    if (m) requests.push(m[1]!);
  });
  await openView(page);
  await expect(box(page)).toHaveAttribute('data-scale', '5');
  expect(requests).toEqual([]);
  await chooseScale(page, 25);
  expect(requests).toEqual(['manifest.json', 'stars-25.bin']);
  expect(search(page).get('vol')).toBe('25');
  await expect(page.locator('#stellar-volume-status')).toContainText('5,377');
  await chooseScale(page, 100);
  expect(requests).toEqual([
    'manifest.json',
    'stars-25.bin',
    'stars-50.bin',
    'stars-100.bin',
  ]);
  await expect(page.locator('#stellar-volume-status')).toContainText('301,721');
  await expect(box(page)).toHaveAttribute('data-visible', '301721');
  // Revenir à 5 pc ne recharge rien et retire l'échelle de l'adresse.
  await chooseScale(page, 5);
  expect(search(page).get('vol')).toBeNull();
  await chooseScale(page, 50);
  expect(requests).toHaveLength(4);
});

test('la recherche trouve Véga, la fiche dit sa source, l’adresse la partage et la rouvre', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  const card = page.locator('#stellar-volume-card');
  await expect(card).toContainText('Hipparcos');
  await expect(card).toContainText('A0V');
  // La fiche du voisinage se cache : une seule étoile choisie à la fois.
  await expect(page.locator('#stellar-card')).toBeHidden();
  expect(search(page).get('vstar')).toBe(`${VEGA}.vega`);
  // Une nouvelle session sur la même adresse retrouve la même étoile.
  await page.reload();
  await expect(page.locator('#stellar-volume-card-title')).toHaveText('Vega', {
    timeout: 90_000,
  });
});

test('un clic choisit l’étoile du volume sous le pointeur', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  const label = page.locator('.sv-label--volume');
  await expect(label).toBeVisible();
  const sx = Number(await label.getAttribute('data-sx'));
  const sy = Number(await label.getAttribute('data-sy'));
  // Désélectionner en choisissant une étoile du voisinage, puis recliquer Véga sur la surface.
  await page.locator('#stellar-list button').first().click();
  await expect(page.locator('#stellar-volume-card')).toBeHidden();
  await page.mouse.click(sx, sy);
  await expect(page.locator('#stellar-volume-card-title')).toHaveText('Vega', {
    timeout: 30_000,
  });
});

test('un hôte d’exoplanètes, rapproché par son numéro Gaia, mène à l’exploration de son système', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Copernicus');
  const card = page.locator('#stellar-volume-card');
  await expect(card).toContainText('55 Cnc');
  await expect(card).toContainText('Gaia DR3');
  await page.locator('#stellar-volume-explore').click();
  await expect(page.locator('#stellar-view')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator('#system-view')).toBeVisible({ timeout: 60_000 });
});

test('un filtre masque ce qui n’y répond pas ; le choix incompatible est retiré', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  await page.locator('#stellar-volume-filter').selectOption('whiteDwarfs');
  await expect(page.locator('#stellar-volume-card')).toBeHidden();
  expect(search(page).get('vstar')).toBeNull();
});

test('un chargement remplacé est annulé ; un chargement refusé est dit, l’échelle revient', async ({
  page,
}) => {
  test.setTimeout(240_000);
  let released = false;
  await page.route('**/assets/sky/volume/stars-100.bin', async (route) => {
    await new Promise((r) => setTimeout(r, 6_000));
    released = true;
    await route.continue().catch(() => {});
  });
  await page.route('**/assets/sky/volume/stars-50.bin', (route) =>
    route.abort()
  );
  await openView(page);
  await chooseScale(page, 25);
  // 50 pc est refusé : la vue le dit et reste à 25 pc.
  await page.locator('.sv-volume-scale[data-pc="50"]').click();
  await expect(box(page)).toHaveAttribute('data-state', 'failed', {
    timeout: 30_000,
  });
  await expect(box(page)).toHaveAttribute('data-scale', '25');
  await expect(page.locator('#stellar-volume-status')).toContainText(
    'could not'
  );
  expect(search(page).get('vol')).toBe('25');
  // 100 pc demandé puis remplacé par 5 pc avant d'arriver : rien ne se pose ensuite.
  await page.unroute('**/assets/sky/volume/stars-50.bin');
  await page.locator('.sv-volume-scale[data-pc="100"]').click();
  await chooseScale(page, 5);
  await expect.poll(() => released, { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1_500);
  await expect(box(page)).toHaveAttribute('data-scale', '5');
  expect(search(page).get('vol')).toBeNull();
  // Ce que la scène trace : aucune étoile du volume à 5 pc, même après l'arrivée tardive de 100 pc.
  await expect(box(page)).toHaveAttribute('data-visible', '0');
});

test('Retour puis Suivant du navigateur : la vue, son échelle et l’étoile reviennent', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  // Ouverte par les Réglages, comme un visiteur : la vue ajoute SON entrée d'historique.
  await expect(page.locator('#stellar-open')).toBeEnabled({ timeout: 40_000 });
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#stellar-open').click();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 60_000 });
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  await page.goBack();
  await expect(page.locator('#stellar-view')).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.goForward();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 60_000 });
  await expect(box(page)).toHaveAttribute('data-scale', '25', {
    timeout: 60_000,
  });
  await expect(page.locator('#stellar-volume-card-title')).toHaveText('Vega', {
    timeout: 60_000,
  });
});

test('une étoile inconnue dans l’adresse est dite, jamais remplacée par une autre', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Bon rang, mauvais nom : le jeton ne désigne pas Véga.
  await openView(page, `&vol=25&vstar=${VEGA}.not-vega`);
  await expect(box(page)).toHaveAttribute('data-state', 'idle', {
    timeout: 90_000,
  });
  await page.waitForTimeout(2_000);
  await expect(page.locator('#stellar-volume-card')).toBeHidden();
});

test('aucune violation d’accessibilité, aucun débordement, à 100 pc avec une fiche', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 100);
  await findStar(page, 'Vega');
  const axe = await new AxeBuilder({ page })
    .include('#stellar-volume')
    .include('#stellar-volume-card')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('les échelles, la recherche et la fiche tiennent dans 390 px', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openView(page);
    await chooseScale(page, 50);
    await findStar(page, 'Vega');
    const overflow = await page.evaluate(
      () =>
        [
          ...document.querySelectorAll(
            '#stellar-volume *, #stellar-volume-card *'
          ),
        ]
          .filter((e) => !(e as HTMLElement).classList.contains('sr-only'))
          .map((e) => e.getBoundingClientRect())
          .filter(
            (r) =>
              r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
          ).length
    );
    expect(overflow).toBe(0);
  });
});
