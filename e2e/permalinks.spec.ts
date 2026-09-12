import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  // Le tour guidé s'ouvre à la première visite et couvre le dock : sans ces drapeaux, tout
  // clic sur `#body-search-trigger` échoue en attendant qu'il devienne atteignable.
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('restores mode, selected body and simulation date from a permalink', async ({
  page,
}) => {
  await page.goto('/?mode=explo&body=mars&date=2026-11-20T18%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Mars');
  await expect(page.locator('.explo-label.is-target')).toHaveAttribute(
    'aria-label',
    'Mars'
  );
  await expect(page.locator('#date-input')).toHaveValue('2026-11-20');
  await expect(page.locator('#time-input')).toHaveValue(/^18:00:\d{2}$/);

  // Le lien reçu utilise `?body=mars` et continue de fonctionner — un permalien déjà partagé
  // ne doit jamais cesser d'ouvrir ce qu'il décrit. Mais l'adresse est REMONTÉE à sa forme
  // canonique `/mars/`, celle du sitemap et de la page indexable du corps, sans rechargement.
  // Le corps n'est alors plus répété dans la query : le chemin le dit déjà.
  const url = new URL(page.url());
  expect(url.pathname).toBe('/mars/');
  expect(url.searchParams.get('body')).toBeNull();
  expect(url.searchParams.get('mode')).toBe('explo');
  expect(url.searchParams.get('date')).toBe('2026-11-20T18:00:00Z');
});

test('le chemin suit la sélection, sans recharger la page', async ({
  page,
}) => {
  // Ce que l'adresse doit raconter pendant qu'on navigue : chaque corps a déjà sa page
  // indexable, et la parcourir sans rechargement la lui rend. Avant, le chemin d'arrivée
  // restait figé et seul `?body=` changeait — depuis `/jupiter/`, regarder Titan laissait une
  // adresse qui nommait encore Jupiter.
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Marqueur détruit par tout rechargement du document : c'est lui qui prouve « à la volée ».
  await page.evaluate(() => {
    (window as unknown as { __navMarker?: string }).__navMarker = 'alive';
  });

  for (const [id, name, path] of [
    ['jupiter', 'Jupiter', '/jupiter/'],
    ['titan', 'Titan', '/titan/'],
  ] as const) {
    // Même choréographie que `titan.spec.ts` : ouvrir la palette, filtrer, attendre que le
    // bouton soit visible. Cliquer le bouton sans filtrer échoue dès la deuxième itération,
    // la liste n'ayant plus le même contenu.
    await page.locator('#body-search-trigger').click();
    await page.locator('#palette-input').fill(name);
    const button = page.locator(`#orbit-${id}`);
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator('#body-info .bi-name')).toHaveText(name);
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe(path);
    expect(new URL(page.url()).searchParams.get('body')).toBeNull();
  }

  // Retour à la vue d'ensemble : la racine EST le global, elle ne le répète pas en query.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
    .toBe('/');
  expect(new URL(page.url()).searchParams.get('body')).toBeNull();

  // Rien n'a été rechargé : le contexte JavaScript est le même qu'au départ.
  expect(
    await page.evaluate(
      () => (window as unknown as { __navMarker?: string }).__navMarker
    )
  ).toBe('alive');
});
