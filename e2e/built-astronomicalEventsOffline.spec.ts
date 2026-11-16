import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-PERF-001B-01 : le panneau des événements s'ouvre HORS LIGNE, après installation complète du
 * service worker. Le morceau différé est servi par le précache : l'application démarre en ligne, le
 * réseau est coupé, le premier clic charge le morceau depuis le cache.
 */
test.use({
  serviceWorkers: 'allow',
  // Le service worker adresse lui-même ses requêtes `galaxy-data` au réseau, hors de portée de
  // `page.route` : on rend les hôtes externes introuvables au niveau du navigateur, pour que ce test
  // ne touche JAMAIS la production (ni ses éphémérides, ni la balise d'audience).
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP static.cloudflareinsights.com ~NOTFOUND, MAP galaxy-data.adrianguichard.dev ~NOTFOUND, MAP galaxy-static.galaxy-3d.workers.dev ~NOTFOUND',
    ],
  },
});

const CHUNK = readdirSync(
  join(import.meta.dirname, '..', 'dist', 'assets')
).find((f) => /^astronomicalEvents-.*\.js$/.test(f));

test('le panneau des événements s’ouvre hors ligne, depuis le précache', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  expect(CHUNK, 'morceau du panneau dans le build').toBeDefined();
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/earth/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  // Installation COMPLÈTE : le service worker est actif et le morceau est dans son cache.
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
  await context.setOffline(true);
  await page.locator('#events-trigger').click();
  await expect(page.locator('#astronomical-events')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('#astronomical-events .event-row')).toHaveCount(8);
});
