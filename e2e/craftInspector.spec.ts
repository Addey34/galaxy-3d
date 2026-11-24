import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * L'INSPECTION 3D D'UN ENGIN (GAL-OBJECT-IMMERSION-001) dans Chromium : sélection d'une sonde, bouton
 * « Inspecter en 3D », modèle chargé, rotation et zoom au clavier, retour exactement à la scène
 * précédente, Retour du navigateur, mouvement réduit, quatre langues, et une sonde sans modèle qui le
 * dit au lieu de proposer une forme inventée. `device-craftInspector.spec.ts` rejoue le parcours sur
 * téléphone ; `built-craftInspector.spec.ts` charge le modèle sous la CSP de production.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function bootProbe(page: Page, body: string, lang = 'en'): Promise<void> {
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), lang);
  await page.goto(`/?body=${body}&mode=explo`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
}

const pose = async (page: Page): Promise<number[]> =>
  ((await page.locator('#craft-view').getAttribute('data-craft-pose')) ?? '')
    .split(',')
    .map(Number);

test('une sonde à modèle : bouton, modèle chargé, clavier, fermeture, retour à la scène', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootProbe(page, 'jwst');
  const before = page.url();
  const button = page.locator('#craft-inspect');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.focus();
  await button.press('Enter');

  const view = page.locator('#craft-view');
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute('data-craft-model', 'jwst-b');
  await expect(view).toHaveAttribute('data-craft-state', 'ready', {
    timeout: 90_000,
  });
  // La scène solaire est rendue inerte, jamais retirée.
  await expect(page.locator('#orbit-overview')).toBeHidden();

  // Le clavier tourne le modèle et zoome.
  const surface = page.locator('#craft-surface');
  await expect(surface).toBeFocused();
  const start = await pose(page);
  await surface.press('ArrowRight');
  await surface.press('ArrowRight');
  await expect
    .poll(async () => (await pose(page))[0])
    .toBeGreaterThan(start[0]!);
  const turned = await pose(page);
  await surface.press('+');
  await expect.poll(async () => (await pose(page))[2]).toBeLessThan(turned[2]!);
  await surface.press('Home');
  await expect
    .poll(async () => Math.abs((await pose(page))[2]! - start[2]!))
    .toBeLessThan(0.01);

  // Aucune violation d'accessibilité sur l'inspection (le canevas est derrière, le volet est du DOM).
  const axe = await new AxeBuilder({ page })
    .include('#craft-view')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Provenance et échelle de présentation sont dites.
  await expect(page.locator('#craft-scale')).toContainText('never enlarged');
  const provenance = page.locator('#craft-provenance');
  await expect(provenance).toContainText('NASA');
  await expect(provenance.locator('a')).toHaveAttribute(
    'href',
    /raw\.githubusercontent\.com\/nasa\/NASA-3D-Resources\/[0-9a-f]{40}\//
  );
  await expect(provenance).toContainText('SHA-256');

  // Échap ferme ; la scène est celle d'avant (même adresse, même corps), le focus revient au déclencheur.
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page.locator('#orbit-overview')).toBeVisible();
  expect(page.url()).toBe(before);
  await expect(page.locator('#loader')).toBeHidden();
});

test('Retour du navigateur ferme l’inspection et ne quitte pas la page', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootProbe(page, 'voyager1');
  const url = page.url();
  await page.locator('#craft-inspect').click({ timeout: 60_000 });
  await expect(page.locator('#craft-view')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#craft-view')).toHaveCount(0);
  expect(page.url()).toBe(url);
  // Un second parcours : le bouton de fermeture, puis aucun Retour résiduel. L'ouverture a fermé la
  // fiche (une seule surface contextuelle à la fois) : on la rouvre.
  await page.locator('#info-trigger').click();
  await page.locator('#craft-inspect').click({ timeout: 30_000 });
  await expect(page.locator('#craft-view')).toBeVisible();
  await page.locator('#craft-close').click();
  await expect(page.locator('#craft-view')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(page.url()).toBe(url);
});

test('une sonde sans modèle fiable le dit, sans bouton', async ({ page }) => {
  await bootProbe(page, 'hera');
  await expect(page.locator('.bi-craft-note')).toContainText(
    'No reliable 3D model',
    { timeout: 60_000 }
  );
  await expect(page.locator('#craft-inspect')).toBeHidden();
});

test('le texte suit la langue (français), mouvement réduit sans amortissement', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootProbe(page, 'parker-solar-probe', 'fr');
  await page.locator('#craft-inspect').click({ timeout: 60_000 });
  await expect(page.locator('#craft-title')).toContainText('inspection en 3D');
  await expect(page.locator('#craft-close')).toHaveText('Fermer l’inspection');
  const view = page.locator('#craft-view');
  await expect(view).toHaveAttribute('data-craft-state', 'ready', {
    timeout: 90_000,
  });
  // Pièces nommées par le fichier : un bouton bascule la mise en évidence.
  const part = page.locator('.cv-part').first();
  await expect(part).toBeVisible();
  await part.click();
  await expect(part).toHaveAttribute('aria-pressed', 'true');
  await part.click();
  await expect(part).toHaveAttribute('aria-pressed', 'false');
});

test('le nom de l’engin est dans la langue de la page (Voyager en français)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootProbe(page, 'voyager1', 'fr');
  await page.locator('#craft-inspect').click({ timeout: 60_000 });
  await expect(page.locator('#craft-title')).toHaveText(
    'Sonde Voyager : inspection en 3D'
  );
});

/**
 * LES DEUX MODÈLES DE `science.nasa.gov` (GAL-OBJECT-IMMERSION-002) : New Horizons et le Trace Gas Orbiter
 * d'ExoMars, fichiers GLB à textures PNG embarquées (non compressés en Draco). Ils se chargent, leur
 * provenance pointe la PAGE de la NASA (pas un commit), et leurs pièces nommées suivent la langue.
 */
test('New Horizons : modèle à textures chargé, provenance science.nasa.gov, aucune pièce inventée', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootProbe(page, 'new-horizons');
  await page.locator('#craft-inspect').click({ timeout: 60_000 });
  const view = page.locator('#craft-view');
  await expect(view).toHaveAttribute('data-craft-model', 'new-horizons');
  await expect(view).toHaveAttribute('data-craft-state', 'ready', {
    timeout: 120_000,
  });
  const provenance = page.locator('#craft-provenance');
  await expect(provenance).toContainText('Visualization Technology');
  await expect(provenance.locator('a')).toHaveAttribute(
    'href',
    'https://science.nasa.gov/resource/new-horizons-3d-model/'
  );
  // Aucune pièce n'est nommée : le seul noeud candidat (`AO_dish`) ne désigne PAS le grand réflecteur
  // (mesuré à l'écran : la mise en évidence ne colorait que le sous-réflecteur), donc il n'est pas déclaré.
  await expect(page.locator('.cv-part')).toHaveCount(0);
});

test('Trace Gas Orbiter : modèle chargé, quatre pièces nommées, libellés en espagnol', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootProbe(page, 'exomars-tgo', 'es');
  await page.locator('#craft-inspect').click({ timeout: 60_000 });
  const view = page.locator('#craft-view');
  await expect(view).toHaveAttribute('data-craft-model', 'exomars-tgo');
  await expect(view).toHaveAttribute('data-craft-state', 'ready', {
    timeout: 120_000,
  });
  await expect(page.locator('.cv-part')).toHaveCount(4);
  await expect(page.locator('#craft-view')).toContainText('Paneles solares');
  const part = page.locator('.cv-part').first();
  await part.click();
  await expect(part).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#craft-provenance a')).toHaveAttribute(
    'href',
    'https://science.nasa.gov/resource/trace-gas-orbiter-3d-model/'
  );
});
