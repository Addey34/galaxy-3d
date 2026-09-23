import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * UN CHARGEMENT PARTIEL D'ÉPHÉMÉRIDES SE GARDE, SE REPREND, ET SE DIT (lot 15).
 *
 * Le défaut, mesuré en production le 2026-09-22 sur un lien à 24 ko/s : 25 des 64 binaires
 * arrivaient, 39 mouraient en « TypeError: Failed to fetch », et comme le chargement était un
 * `Promise.all` tout-ou-rien, le service repartait VIDE. Mercure, dont le fichier était
 * pourtant arrivé, tombait de 7,3 km à 2 600 km, les sondes perdaient toute position, et rien
 * ne le disait à l'écran.
 *
 * Ce scénario coupe une PARTIE des `.bin`, comme le lien lent le faisait, et vérifie les trois
 * décisions du contrat : ce qui est arrivé sert (Mercure reste sur Horizons), ce qui manque est
 * ANNONCÉ avec ses comptes, et la reprise répare sans recharger la page.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/** Le seul corps dont le fichier passe : le reste du manifeste est coupé au transport. */
const KEPT = 'mercury';

/**
 * Coupe tous les binaires sauf `KEPT`, comme un lien saturé : `route.abort()` fait rejeter
 * `fetch`, exactement la « TypeError: Failed to fetch » mesurée. Renvoie un interrupteur qui
 * laisse ensuite tout passer, pour éprouver la reprise sans recharger la page.
 */
async function cutMostBinaries(page: Page): Promise<() => void> {
  let cutting = true;
  await page.route('**/assets/ephemerides/*.bin', (route: Route) => {
    const file = route.request().url().split('/').pop() ?? '';
    if (cutting && !file.startsWith(`${KEPT}.`)) return route.abort();
    return route.continue();
  });
  return () => {
    cutting = false;
  };
}

const openBody = async (page: Page, body: string): Promise<void> => {
  await page.goto(`/?body=${body}&date=2026-06-01T00%3A00%3A00Z`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
};

test('what arrived still serves, and what is missing is said on screen', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await cutMostBinaries(page);
  await openBody(page, KEPT);

  // (1) CE QUI EST ARRIVÉ SERT. C'est la moitié qui échouait avant le lot 15 : un seul rejet
  // vidait le service, et Mercure passait sur astronomy-engine sans que son fichier manque.
  const source = page.locator('.bi-position-source');
  await expect(source).toContainText('JPL Horizons', { timeout: 30_000 });

  // (2) CE QUI MANQUE EST DIT, sans ouvrir la moindre fiche.
  const notice = page.locator('#ephemeris-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-state', 'degraded');
  await expect(notice).toContainText('Reduced precision');
  // Les comptes sont ceux du manifeste servi, pas un nombre écrit à la main.
  const declared = await page.evaluate(async () => {
    const response = await fetch('/assets/ephemerides/manifest.json');
    const manifest = (await response.json()) as {
      bodies: Record<string, unknown>;
    };
    return Object.keys(manifest.bodies).length;
  });
  await expect(notice).toContainText(`1 of ${declared}`);
  await expect(notice).toHaveAttribute('data-missing', String(declared - 1));
  // Une sonde n'a aucun repli képlérien : son fichier manquant la laisse SANS position, ce
  // qui n'est pas la même chose qu'une position moins précise, et le bandeau le distingue.
  await expect(notice).toContainText('without any position');
});

test('a body whose file was cut falls back, and says which source places it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await cutMostBinaries(page);
  await openBody(page, 'ceres');

  const source = page.locator('.bi-position-source');
  await expect(source).toContainText('Keplerian', { timeout: 30_000 });
});

test('loading the missing files repairs the scene without reloading the page', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const letEverythingThrough = await cutMostBinaries(page);
  await openBody(page, 'ceres');

  const source = page.locator('.bi-position-source');
  await expect(source).toContainText('Keplerian', { timeout: 30_000 });

  letEverythingThrough();
  await page.locator('#ephemeris-notice .en-retry').click();

  const notice = page.locator('#ephemeris-notice');
  await expect(notice).toHaveAttribute('data-state', 'recovered', {
    timeout: 60_000,
  });
  await expect(notice).toContainText('All ephemerides are loaded');
  // Le corps a CHANGÉ de source en cours de session, ce qui est le gain attendu, et sa fiche
  // le dit d'elle-même : rien n'a été rechargé.
  await expect(source).toContainText('JPL Horizons', { timeout: 30_000 });
});

test('a complete load says nothing at all', async ({ page }) => {
  test.setTimeout(120_000);
  await openBody(page, KEPT);
  // Le silence est l'information : le bandeau n'est même pas dans le DOM.
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 30_000 }
  );
});

/**
 * La garde de mise en page démarre À la taille mobile : une page de bureau redimensionnée ne
 * place pas ses docks comme un téléphone (leçon payée au lot 9C, bandeau d'imagerie recouvert
 * par le sélecteur Éduc/Explo à 390 px, invisible pour axe).
 */
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the notice covers no dock, passes axe, and overflows nothing', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await cutMostBinaries(page);
    await openBody(page, KEPT);

    const notice = page.locator('#ephemeris-notice');
    await expect(notice).toBeVisible();

    for (const dock of ['.dock--top-left', '.dock--top-right', '.dock--bottom'])
      await expect
        .poll(
          async () => {
            const a = await notice.boundingBox();
            const b = await page.locator(dock).boundingBox();
            if (!a || !b) return 'rectangle absent';
            return a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height
              ? 'chevauchement'
              : 'libre';
          },
          { message: `bandeau sur ${dock}` }
        )
        .toBe('libre');

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual(
      []
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(0);
    expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
  });
});
