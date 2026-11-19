import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-TOUR-SCALE-001 : les visites sont des morceaux À LA DEMANDE, sur le BUILD de production.
 *
 * Quatre contrats, chacun sur ce que le navigateur reçoit vraiment (`/assets/tour-<id>-<hash>.js`,
 * pas les modules du serveur de développement) :
 *   - le démarrage ne télécharge aucune fiche, le choix d'une visite télécharge la sienne et rien
 *     d'autre, et un identifiant inconnu n'en télécharge aucune ;
 *   - un téléchargement refusé est annoncé, ne démarre rien, et le clic suivant réessaie ;
 *   - changer de langue pendant une visite ne télécharge rien (les quatre langues sont dans la
 *     fiche) ;
 *   - le précache du service worker contient TOUTES les fiches, et une visite s'ouvre HORS LIGNE.
 * Les trois premiers bloquent le service worker : son précache masquerait ce qu'on contrôle.
 */
// Le service worker adresse lui-même ses requêtes `galaxy-data` au réseau, hors de portée de
// `page.route` : on rend les hôtes externes introuvables au niveau du navigateur, pour que ces
// tests ne touchent JAMAIS la production. (`launchOptions` ne peut pas être posé dans un groupe.)
test.use({
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP static.cloudflareinsights.com ~NOTFOUND, MAP galaxy-data.adrianguichard.dev ~NOTFOUND, MAP galaxy-static.galaxy-3d.workers.dev ~NOTFOUND',
    ],
  },
});

const DIST = join(import.meta.dirname, '..', 'dist');
const ORDER: string[] = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'src', 'registry', 'tours', 'order.json'),
    'utf-8'
  )
).order;
const TOUR_CHUNK = /\/assets\/tour-([a-z0-9-]+?)-[A-Za-z0-9_-]{8}\.js(\?.*)?$/;
const chunkRoute = (id: string): RegExp =>
  new RegExp(`/assets/tour-${id}-[A-Za-z0-9_-]{8}\\.js(\\?.*)?$`);

async function boot(page: Page, url = '/'): Promise<void> {
  await blockExternalNetwork(page);
  // Une build dotée de `VITE_ASSET_ORIGIN` demande les éphémérides à `galaxy-data`, coupé par
  // `blockExternalNetwork` : on les sert depuis le build (comme `built-lazyLaunchers.spec.ts`).
  const origin = test.info().project.use.baseURL;
  await page.route(
    '**galaxy-data.adrianguichard.dev/assets/ephemerides/**',
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const response = await route.fetch({ url: new URL(path, origin).href });
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'access-control-allow-origin': '*',
          'access-control-expose-headers': '*',
        },
      });
    }
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto(url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
}

/** Les fiches de visites que la PAGE demande, par identifiant. */
function watchTourChunks(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (request) => {
    const match = TOUR_CHUNK.exec(request.url());
    if (match) asked.push(match[1]!);
  });
  return asked;
}

async function openPicker(page: Page): Promise<void> {
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await expect(page.locator('.stour-picker')).toBeVisible();
}

test.describe('le précache', () => {
  const sw = existsSync(join(DIST, 'sw.js'))
    ? readFileSync(join(DIST, 'sw.js'), 'utf8')
    : '';
  const precached = [...sw.matchAll(/\{url:"([^"]+)",revision:/g)].map(
    (m) => m[1]!
  );

  test('contient le lecteur et UNE fiche par visite déclarée', () => {
    expect(precached.length, 'manifeste lu dans dist/sw.js').toBeGreaterThan(
      50
    );
    expect(
      precached.some((url) => /assets\/tourPlayer-.*\.js$/.test(url))
    ).toBe(true);
    for (const id of ORDER)
      expect(
        precached.filter((url) =>
          new RegExp(`assets/tour-${id}-[A-Za-z0-9_-]{8}\\.js$`).test(url)
        ),
        `fiche ${id} dans le précache`
      ).toHaveLength(1);
  });
});

test.describe('à la demande, sans service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('le démarrage ne télécharge aucune fiche ; le choix d’une visite télécharge la sienne seule', async ({
    page,
  }) => {
    const asked = watchTourChunks(page);
    await boot(page);
    await openPicker(page);
    expect(asked, 'fiches demandées avant tout choix').toEqual([]);
    const index = ORDER.indexOf('seasons');
    await page.locator('.stour-picker-item').nth(index).click();
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
    expect(asked).toEqual(['seasons']);
  });

  test('un identifiant inconnu ne télécharge aucune fiche', async ({
    page,
  }) => {
    const asked = watchTourChunks(page);
    await boot(page, '/?tour=inconnue');
    await expect(page.locator('.stour-card')).toBeHidden();
    expect(asked).toEqual([]);
  });

  test('l’ouverture directe ?tour=<id> ne télécharge que la visite demandée', async ({
    page,
  }) => {
    const asked = watchTourChunks(page);
    await boot(page, '/?tour=seasons');
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
    expect(asked).toEqual(['seasons']);
  });

  test('un téléchargement refusé est annoncé, ne démarre rien, et le clic suivant réessaie', async ({
    page,
  }) => {
    await boot(page);
    await openPicker(page);
    await page.route(chunkRoute('seasons'), (route) => route.abort());
    const item = page
      .locator('.stour-picker-item')
      .nth(ORDER.indexOf('seasons'));
    await item.click();
    await expect(page.locator('[role="status"].sr-only').first()).toContainText(
      'could not be loaded',
      { timeout: 15_000 }
    );
    await expect(page.locator('.stour-card')).toBeHidden();
    // Le sélecteur n'est plus occupé : rien ne reste désactivé après l'échec.
    await expect(page.locator('.stour-picker')).toHaveAttribute(
      'aria-busy',
      'false'
    );
    await expect(item).toBeEnabled();
    await page.unroute(chunkRoute('seasons'));
    if (test.info().project.name === 'iphone') {
      // WebKit garde l'échec du module en mémoire (mesuré, `built-lazyLaunchers.spec.ts`) : le
      // texte le dit au lieu de répéter « réessayez ».
      await item.click();
      await expect(
        page.locator('[role="status"].sr-only').first()
      ).toContainText('Reload the page', { timeout: 15_000 });
      return;
    }
    await item.click();
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
  });

  /**
   * LE SÉLECTEUR FERMÉ RETIRE SA DEMANDE : la fiche est retenue côté réseau, le visiteur ferme le
   * sélecteur (bouton, croix, Échap), puis la fiche arrive. Rien ne doit démarrer, et le sélecteur
   * rouvert doit être libre (ni `aria-busy`, ni bouton désactivé).
   */
  const closers: Record<string, (page: Page) => Promise<void>> = {
    'le bouton du sélecteur': (page) => page.locator('.stour-start').click(),
    'la croix de l’aide': (page) =>
      page.locator('#help-popover .surface-close').click(),
    Échap: (page) => page.keyboard.press('Escape'),
  };
  for (const [name, closeIt] of Object.entries(closers)) {
    test(`fermer le sélecteur (${name}) avant la fiche : rien ne démarre, la réouverture est libre`, async ({
      page,
    }) => {
      await boot(page);
      await openPicker(page);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held = 0;
      await page.route(chunkRoute('seasons'), async (route) => {
        held++;
        await gate;
        await route.continue();
      });
      const item = page
        .locator('.stour-picker-item')
        .nth(ORDER.indexOf('seasons'));
      await item.click();
      await expect.poll(() => held).toBe(1);
      await expect(page.locator('.stour-picker')).toHaveAttribute(
        'aria-busy',
        'true'
      );
      await closeIt(page);
      // L'abandon libère le sélecteur sans attendre le réseau.
      await expect(page.locator('.stour-picker')).toHaveAttribute(
        'aria-busy',
        'false'
      );
      release();
      // Le téléchargement réussit bel et bien ; il ne démarre rien. Attente sur un FAIT : le
      // module est arrivé (la fiche, une fois résolue, serait affichée dans la seconde).
      await expect
        .poll(() =>
          page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .some((e) => /\/assets\/tour-seasons-/.test(e.name))
          )
        )
        .toBe(true);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => r(null)))
      );
      await expect(page.locator('.stour-card')).toBeHidden();
      await page.unroute(chunkRoute('seasons'));
      // Réouverture : une nouvelle sélection fonctionne normalement.
      if (await page.locator('.stour-picker').isHidden()) {
        if (await page.locator('#help-popover').isHidden())
          await page.locator('#help-btn').click();
        if (await page.locator('.stour-picker').isHidden())
          await page.locator('.stour-start').click();
      }
      await expect(item).toBeEnabled();
      await item.click();
      await expect(page.locator('.stour-card')).toBeVisible({
        timeout: 30_000,
      });
    });
  }

  test('un échec tardif après fermeture du sélecteur n’annonce rien et ne bloque pas le suivant', async ({
    page,
  }) => {
    await boot(page);
    await openPicker(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = 0;
    await page.route(chunkRoute('seasons'), async (route) => {
      held++;
      await gate;
      await route.abort();
    });
    const item = page
      .locator('.stour-picker-item')
      .nth(ORDER.indexOf('seasons'));
    await item.click();
    await expect.poll(() => held).toBe(1);
    await page.keyboard.press('Escape');
    release();
    await page.evaluate(
      () => new Promise((r) => setTimeout(() => r(null), 500))
    );
    await expect(
      page.locator('[role="status"].sr-only').first()
    ).not.toContainText('could not be loaded');
    await expect(page.locator('.stour-card')).toBeHidden();
    await page.unroute(chunkRoute('seasons'));
    await page.locator('#help-btn').click();
    if (await page.locator('.stour-picker').isHidden())
      await page.locator('.stour-start').click();
    await expect(item).toBeEnabled();
  });

  test('le lien direct ?tour= n’est pas annulé par la fermeture de l’aide', async ({
    page,
  }) => {
    await boot(page);
    // Le lien direct passe par `start()` hors sélecteur : on ouvre puis ferme l'aide pendant qu'il
    // est en vol (même motif que ci-dessus, demande non issue du sélecteur).
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = 0;
    await page.route(chunkRoute('seasons'), async (route) => {
      held++;
      await gate;
      await route.continue();
    });
    await page.goto('/?tour=seasons');
    await expect.poll(() => held).toBe(1);
    await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
    await page.locator('#help-btn').click();
    await page.keyboard.press('Escape');
    release();
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
  });

  test('changer de langue pendant une visite ne télécharge rien et relit la légende', async ({
    page,
  }) => {
    const asked = watchTourChunks(page);
    await boot(page, '/?tour=seasons');
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.stour-progress')).toContainText('Step');
    const before = asked.length;
    // Le popover d'aide est derrière le fond modal de la visite : le bouton est cliqué dans la
    // page, comme le ferait un raccourci, sans passer par un geste que le fond intercepterait.
    await page.evaluate(() =>
      (
        document.querySelector(
          '#lang-switch .lang-btn[data-locale="fr"]'
        ) as HTMLElement
      ).click()
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('.stour-progress')).toContainText('Étape');
    expect(asked.length, 'fiches demandées après le changement').toBe(before);
  });
});

test.describe('hors ligne, avec le service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('une visite s’ouvre hors ligne, depuis le précache', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const asked = watchTourChunks(page);
    await boot(page, '/earth/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Installation COMPLÈTE : la fiche de la visite et le lecteur sont dans le cache du worker.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const urls: string[] = [];
            for (const key of await caches.keys())
              for (const request of await (await caches.open(key)).keys())
                urls.push(request.url);
            return (
              urls.some((u) => /\/assets\/tour-seasons-/.test(u)) &&
              urls.some((u) => /\/assets\/tourPlayer-/.test(u))
            );
          }),
        { timeout: 90_000, message: 'lecteur et fiche précachés' }
      )
      .toBe(true);
    expect(asked, 'la page ne demande aucune fiche avant le choix').toEqual([]);
    await context.setOffline(true);
    await openPicker(page);
    await page
      .locator('.stour-picker-item')
      .nth(ORDER.indexOf('seasons'))
      .click();
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.stour-caption')).not.toBeEmpty();
  });
});
