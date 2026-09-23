import { expect, test, type Page, type Route } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LE DÉMARRAGE NE TÉLÉCHARGE PLUS DEUX SIÈCLES DE TRAJECTOIRES (lot 17, phase 17C).
 *
 * Mesuré en production le 2026-09-23 : 45,81 Mo et 15,3 s de démarrage, dont **77,5 % pour les
 * seules éphémérides**. Or afficher un instant n'en demande presque rien — 96 octets par corps
 * pour une position, une période entière seulement pour une ligne d'orbite. Ce scénario vérifie
 * dans un VRAI navigateur, contre un vrai serveur, que le démarrage demande des PLAGES et pas
 * des fichiers, que ce qui s'affiche vient quand même de JPL Horizons, et qu'un saut de date
 * garde cette source au lieu de retomber en silence sur un repli.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

interface BinaryTraffic {
  requests: number;
  withRange: number;
  bytes: number;
}

/** Ce que le navigateur demande VRAIMENT aux binaires d'éphémérides. */
function watchBinaries(page: Page): BinaryTraffic {
  const traffic: BinaryTraffic = { requests: 0, withRange: 0, bytes: 0 };
  page.on('request', (request) => {
    if (!/\/assets\/ephemerides\/.*\.bin$/.test(request.url())) return;
    traffic.requests++;
    const range = request.headers()['range'];
    if (range) {
      traffic.withRange++;
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (match) traffic.bytes += Number(match[2]) - Number(match[1]) + 1;
    }
  });
  return traffic;
}

/** La somme des binaires livrés, LUE au manifeste servi et jamais écrite à la main. */
async function shippedBytes(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/assets/ephemerides/manifest.json');
    const manifest = (await response.json()) as {
      bodies: Record<string, { sampleCount: number }>;
    };
    return Object.values(manifest.bodies).reduce(
      (sum, entry) => sum + entry.sampleCount * 48,
      0
    );
  });
}

test('le démarrage demande des plages, et une petite part des octets', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const traffic = watchBinaries(page);

  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeVisible();
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });

  // (1) Aucun fichier entier : chaque demande porte son en-tête `Range`.
  expect(traffic.requests).toBeGreaterThan(0);
  expect(traffic.withRange).toBe(traffic.requests);

  // (2) Et le compte y est : moins d'un vingtième des octets livrés.
  const shipped = await shippedBytes(page);
  expect(shipped).toBeGreaterThan(30_000_000);
  expect(traffic.bytes).toBeLessThan(shipped * 0.05);

  // (3) Ce qui s'affiche vient quand même du binaire Horizons : le gain ne se paie pas sur la
  // précision, et la fiche du corps le dit d'elle-même.
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 30_000 }
  );
  // Et le bandeau du lot 15 se tait : une fenêtre suffisante n'est pas un chargement partiel.
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);
});

test('un saut de date garde la source précise', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 30_000 }
  );

  // Un saut de cinquante ans sort de toutes les fenêtres tenues : c'est le cas où un
  // chargement paresseux mal conçu ferait repasser la scène sur astronomy-engine sans le
  // dire (Mercure à 2 600 km au lieu de 7,3, mesuré au lot 15).
  const input = page.locator('#date-input');
  await input.fill('2080-03-01');
  await input.dispatchEvent('change');

  await expect(input).toHaveValue('2080-03-01', { timeout: 60_000 });
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 60_000 }
  );
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);
});

test('une fenêtre qui échoue EN COURS DE SESSION se dit à l’écran', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  // Le démarrage, lui, était complet : le bandeau n'existe même pas dans le DOM.
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);

  // Le lien tombe APRÈS le démarrage. Avant le lot 17 ce cas n'existait pas : tout était
  // chargé au boot, donc le bandeau n'était construit qu'à l'ouverture de la page.
  await page.route('**/assets/ephemerides/*.bin', (route: Route) =>
    route.abort()
  );
  const input = page.locator('#date-input');
  await input.fill('2080-03-01');
  await input.dispatchEvent('change');

  const notice = page.locator('#ephemeris-notice');
  await expect(notice).toBeVisible({ timeout: 90_000 });
  await expect(notice).toHaveAttribute('data-state', 'degraded');
  await expect(notice).toContainText('Reduced precision');
});
