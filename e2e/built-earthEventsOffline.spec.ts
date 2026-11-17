import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-PERF-001B-02, sur le BUILD de production (`test:pages`) : les événements terrestres sont un
 * morceau différé. Trois choses ne se prouvent que sur le vrai build, les scénarios de comportement
 * étant joués au serveur de développement par `earthEventsLauncher.spec.ts` :
 *   - le morceau n'est PAS demandé par le démarrage de la page, et n'est importé qu'au premier geste ;
 *   - il est dans le précache du service worker, donc le panneau s'ouvre HORS LIGNE ;
 *   - un échec de son import sur le build réel est annoncé, puis le clic suivant réussit.
 * Deux démarrages de l'application en tout : ce job a 15 minutes.
 */
const CHUNK = readdirSync(
  join(import.meta.dirname, '..', 'dist', 'assets')
).find((f) => /^earthEventsModule-.*\.js$/.test(f));

const init = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });

test.use({
  serviceWorkers: 'allow',
  // Le service worker adresse lui-même ses requêtes `galaxy-data` au réseau, hors de portée de
  // `page.route` : on rend les hôtes externes introuvables au niveau du navigateur, pour que ce
  // test ne touche JAMAIS la production (ni ses éphémérides, ni la balise d'audience, ni USGS).
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP static.cloudflareinsights.com ~NOTFOUND, MAP galaxy-data.adrianguichard.dev ~NOTFOUND, MAP galaxy-static.galaxy-3d.workers.dev ~NOTFOUND, MAP earthquake.usgs.gov ~NOTFOUND, MAP eonet.gsfc.nasa.gov ~NOTFOUND',
    ],
  },
});

test.describe('avec service worker', () => {
  test('le panneau des événements terrestres s’ouvre hors ligne, depuis le précache', async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    expect(
      CHUNK,
      'morceau des événements terrestres dans le build'
    ).toBeDefined();
    await blockExternalNetwork(page);
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes(CHUNK!)) requested.push(request.url());
    });
    await init(page);
    await page.goto('/earth/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(
        () =>
          page.evaluate(async (name) => {
            for (const key of await caches.keys()) {
              const cache = await caches.open(key);
              for (const request of await cache.keys())
                if (request.url.includes(name)) return true;
            }
            return false;
          }, CHUNK!),
        { timeout: 60_000, message: 'morceau précaché' }
      )
      .toBe(true);
    // Au démarrage ordinaire : le morceau n'est pas demandé par la page, rien n'est monté.
    expect(requested, 'requêtes de la page pour le morceau').toEqual([]);
    await expect(page.locator('#earth-events-overlay')).toHaveCount(0);
    await expect(page.locator('#earth-events .ee-item')).toHaveCount(0);
    await expect(page.locator('#event-labels-toggle')).toHaveCount(0);

    await context.setOffline(true);
    await page.locator('#earth-events-trigger').click();
    await expect(page.locator('#earth-events')).toBeVisible({
      timeout: 20_000,
    });
    // L'import dynamique a bien eu lieu, une seule fois, depuis le précache.
    expect(requested, 'import dynamique unique').toHaveLength(1);
    await expect(page.locator('#earth-events .ee-item')).toHaveCount(2);
    await expect(page.locator('#earth-events-overlay')).toHaveCount(1);
    await expect(page.locator('#event-labels-toggle')).toBeChecked();
  });
});

test.describe('sans service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('un échec d’import sur le build réel est annoncé, puis le clic suivant réussit', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    expect(
      CHUNK,
      'morceau des événements terrestres dans le build'
    ).toBeDefined();
    await blockExternalNetwork(page);
    await init(page);
    await page.goto('/earth/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
    const pattern = `**/assets/${CHUNK}`;
    await page.route(pattern, (route) => route.abort());
    await page.locator('#earth-events-trigger').click();
    await expect(page.locator('[role="status"].sr-only').first()).toContainText(
      'could not be loaded',
      { timeout: 20_000 }
    );
    await expect(page.locator('#earth-events-overlay')).toHaveCount(0);
    await expect(page.locator('#earth-events-trigger')).not.toHaveAttribute(
      'aria-busy',
      /.*/
    );
    await page.unroute(pattern);
    await page.locator('#earth-events-trigger').click();
    await expect(page.locator('#earth-events')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#earth-events .ee-item')).toHaveCount(2);
    await expect(page.locator('#earth-events-overlay')).toHaveCount(1);
  });
});
