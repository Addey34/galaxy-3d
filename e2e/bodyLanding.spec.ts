import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LE CHEMIN COMME ÉTAT — ce que les pages d'atterrissage par corps exigent de l'application.
 *
 * Les pages elles-mêmes (`dist/jupiter/index.html`) ne naissent qu'au build : leur contenu est
 * couvert par `src/seo/bodyLandingPage.test.ts`, qui ne demande pas de navigateur. Ce qu'aucun
 * test unitaire ne peut voir, c'est le comportement de l'APPLICATION quand on l'ouvre sur un
 * tel chemin — et c'est là que la promesse se tient ou non : un visiteur arrivé de Google sur
 * `/jupiter/` doit trouver Jupiter, pas la vue d'ensemble.
 *
 * Ces scénarios tournent sur le serveur de DÉVELOPPEMENT, qui sert le shell SPA pour tout
 * chemin inconnu. C'est exactement la situation à tester : seul le chemin porte l'information,
 * sans page générée pour aider.
 */

const openApp = async (
  page: import('@playwright/test').Page,
  path: string
): Promise<void> => {
  await page.goto(path);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await page.waitForTimeout(1500);
};

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('a body path opens the app on that body', async ({ page }) => {
  await openApp(page, '/jupiter/');
  await expect(page.locator('#body-info .bi-name')).toHaveText('Jupiter');

  // Et l'URL ne se réécrit PAS en `/jupiter/?body=jupiter` : le chemin le dit déjà, deux URL
  // pour un même contenu est précisément ce que le canonique existe pour éviter.
  expect(new URL(page.url()).searchParams.get('body')).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/jupiter/');
});

test('the same path works without its trailing slash', async ({ page }) => {
  // Firebase redirige `/jupiter` vers `/jupiter/`, mais rien ne garantit qu'un lien partagé,
  // un aperçu de réseau social ou un futur hébergeur fasse de même.
  await openApp(page, '/titan');
  await expect(page.locator('#body-info .bi-name')).toHaveText('Titan');
});

test('an explicit body in the query wins over the path', async ({ page }) => {
  // Depuis `/jupiter/`, partager la vue de Titan doit rouvrir Titan. Si le chemin primait,
  // tout permalien émis depuis une page de corps ramènerait à ce corps-là.
  await openApp(page, '/jupiter/?body=titan');
  await expect(page.locator('#body-info .bi-name')).toHaveText('Titan');
});

test('navigating away from a landing page writes the new body', async ({
  page,
}) => {
  await openApp(page, '/jupiter/');
  // La navigation vit dans la palette (ouverte depuis le dock), entrées `#orbit-{nom}`.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-saturn').click();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Saturn');
  // Le chemin reste celui de la page d'atterrissage, mais la query dit désormais la vérité :
  // c'est elle qui rend le lien partageable.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('body'))
    .toBe('saturn');
});

test('an unknown path is ignored, not treated as a body', async ({ page }) => {
  // `bodyFromPathname` valide contre le catalogue : une faute de frappe ou une URL inventée
  // ne doit ni sélectionner un corps au hasard ni casser le démarrage.
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openApp(page, '/jupitre/');
  await expect(page.locator('#body-info')).toBeHidden();
  expect(pageErrors).toEqual([]);
});
