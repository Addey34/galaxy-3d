import { expect, test, type Page, type Route } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LA VISITE DE RETOUR NE REPAYE PLUS, ET LE HORS-LIGNE EXISTE À NOUVEAU (lot 17, phase 17E).
 *
 * Deux faits MESURÉS le 2026-09-24 contre le build livré de 17D, octets comptés côté serveur,
 * service worker actif, trois chargements successifs dans le même navigateur :
 *
 *   - la deuxième visite coûtait **987 168 octets en 62 requêtes, et RIEN d'autre** : 100 % de
 *     la visite de retour était de l'éphéméride, tout le reste venant du service worker ;
 *   - le cache `ssv-assets` ne contenait **aucun `.bin`** (il n'était même pas créé) alors
 *     qu'il en tenait 64 avant 17C : une réponse 206 n'est mise en cache ni par le navigateur
 *     ni par le service worker, donc les éphémérides n'étaient plus disponibles hors ligne.
 *
 * Ce scénario vérifie les deux dans un VRAI navigateur, avec le VRAI `Cache` : ce qui compte
 * n'est pas qu'un cache existe, c'est qu'aucune requête ne parte.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/** Les requêtes de binaires d'éphémérides, quelles qu'elles soient. */
function countBinaries(page: Page): { requests: number } {
  const traffic = { requests: 0 };
  page.on('request', (request) => {
    if (/\/assets\/ephemerides\/.*\.bin$/.test(request.url()))
      traffic.requests++;
  });
  return traffic;
}

/** Ouvre la surface de réglages et sa section « Utilisation hors ligne ». */
async function openOfflineSection(page: Page): Promise<void> {
  await page.locator('#settings-trigger').click();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await page.locator('#settings-section-offline').scrollIntoViewIfNeeded();
}

test('la visite de RETOUR ne demande plus un seul octet d’éphéméride', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const first = countBinaries(page);
  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  expect(first.requests).toBeGreaterThan(0);

  // Deuxième visite, même navigateur, même origine : c'est exactement ce qui coûtait
  // 987 168 octets avant cette phase.
  const second = countBinaries(page);
  const before = second.requests;
  await page.reload();
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(3_000);
  expect(second.requests - before).toBe(0);

  // Et ce n'est pas une scène dégradée : la position vient toujours du binaire Horizons.
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 30_000 }
  );
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);
});

test('la section hors ligne DIT ce que l’appareil tient, et le prépare', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });

  await openOfflineSection(page);
  const status = page.locator('#offline-status');
  // Au départ, aucun fichier n'est tenu ENTIER : seules les fenêtres du démarrage sont là.
  await expect(status).toContainText('holds 0 of 64 files', {
    timeout: 30_000,
  });

  await page.locator('#offline-prepare').click();
  // L'état final est LU dans le magasin, pas déduit du téléchargement.
  await expect(status).toContainText(/All \d+ files are on this device/, {
    timeout: 240_000,
  });
  await expect(page.locator('#offline-prepare')).toBeDisabled();

  // Et la place se rend : le bouton nomme ce qu'il libère.
  const forget = page.locator('#offline-forget');
  await expect(forget).toBeVisible();
  await forget.click();
  await expect(status).toContainText('holds 0 of 64 files', {
    timeout: 60_000,
  });
});

test('une fois préparé, l’appareil place les corps SANS réseau', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });

  await openOfflineSection(page);
  await page.locator('#offline-prepare').click();
  await expect(page.locator('#offline-status')).toContainText(
    /All \d+ files are on this device/,
    { timeout: 240_000 }
  );

  // Plus rien ne répond, ni le manifeste ni les binaires : c'est l'appareil emporté en
  // classe. Sans la copie du manifeste, il afficherait « aucune éphéméride précise » alors
  // que ses fichiers sont là — son cache de service worker expire au bout d'une heure.
  await page.route('**/assets/ephemerides/**', (route: Route) => route.abort());

  await page.goto('/?body=mercury&date=2080-03-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#date-input')).toHaveValue('2080-03-01');
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 30_000 }
  );
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);
});
