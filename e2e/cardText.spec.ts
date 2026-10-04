import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LE TEXTE LONG DE LA FICHE ARRIVE À SA PREMIÈRE OUVERTURE (2026-10-04).
 *
 * Descriptions, raisons, crédits et liens Wikipédia ne partent plus au démarrage : le navigateur
 * reçoit leur empreinte, et `config/cardText.ts` les repose quand une fiche s'ouvre. Cette voie
 * n'existe QUE dans le navigateur : Vitest et les pages générées lisent des fiches complètes. Ce
 * fichier est donc la seule garde qui la voit fonctionner.
 */
async function boot(page: Page, locale: string, url: string): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript((value) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', value);
  }, locale);
  await page.goto(url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
}

test('la fiche reçoit sa description, son lien et son crédit, sans « undefined »', async ({
  page,
}) => {
  await boot(page, 'en', '/?body=ryugu');
  const panel = page.locator('#body-info');
  await expect(panel.locator('.bi-desc')).toContainText(
    'A dark, carbon-rich spinning top'
  );
  await expect(panel.locator('.bi-more')).toHaveAttribute(
    'href',
    'https://en.wikipedia.org/wiki/162173_Ryugu'
  );
  await expect(panel.locator('.bi-credit')).toContainText('ISAS/JAXA');
  // Une raison de non-publication reposée, et nulle part le mot qu'un bloc vide écrirait.
  await expect(panel).not.toContainText('undefined');
});

test('le crédit du modèle suit l’espagnol, pas seulement le français et l’anglais', async ({
  page,
}) => {
  // Le code choisissait `fr` ou `en` : un visiteur hispanophone lisait l'anglais alors que la
  // fiche porte la traduction. Défaut vu en différant ce texte, corrigé dans `ui/bodyInfo.ts`.
  await boot(page, 'es', '/?body=ryugu');
  const panel = page.locator('#body-info');
  await expect(panel.locator('.bi-credit')).toContainText('datos modificados');
  await expect(panel.locator('.bi-desc')).toContainText('Una peonza oscura');
  await expect(panel.locator('.bi-more')).toHaveAttribute(
    'href',
    'https://es.wikipedia.org/wiki/(162173)_Ryugu'
  );
});

test('aucune carte de fiche ne part au démarrage, la première ouverture la demande', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => {
    // Deux formes : le module virtuel servi par Vite en dev, le morceau haché du build.
    const match =
      /(?:registry-text\/|\/assets\/)(card-(?:en|fr|es|pt-BR))(?=[-.]|$)/.exec(
        decodeURIComponent(request.url())
      );
    if (match) requested.push(match[1]!);
  });
  await boot(page, 'fr', '/');
  // LE TÉMOIN : la vue d'ensemble n'ouvre aucune fiche, donc rien ne doit avoir été demandé.
  expect(requested).toEqual([]);
  await page
    .locator('#orbit-mars')
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#body-info .bi-desc')).not.toBeEmpty();
  // L'anglais (repli de chaque bloc) et la langue active, rien d'autre.
  expect([...new Set(requested)].sort()).toEqual(['card-en', 'card-fr']);
});
