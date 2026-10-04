import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { clickWhenCalm } from './mainThread';

/**
 * UNE LIGNE D'ORBITE N'EST PAYÉE QUE SI ELLE EST TRACÉE (2026-10-04).
 *
 * Une ligne coûte une période ENTIÈRE d'éphéméride (333 Ko pour Halley, 76 ans au pas de 4 jours).
 * Le démarrage la demandait pour tous les corps, ligne affichée ou non ; il ne demande plus que les
 * lignes de la règle par défaut (`core/orbitLineDefaults.ts`, les planètes), et une ligne allumée
 * dans le tableau fait venir sa période à ce moment-là. Ce scénario le voit au RÉSEAU, la seule
 * chose qu'un test peut observer d'une ligne Three.js : Halley ne demande que sa position au
 * démarrage, puis sa période quand on allume son orbite.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/** Les octets demandés au fichier d'un corps, par en-tête `Range`. */
function watchBody(page: Page, body: string): { bytes: number } {
  const traffic = { bytes: 0 };
  page.on('request', (request) => {
    if (
      !new RegExp(`/assets/ephemerides/${body}\\.[^/]*\\.bin$`).test(
        request.url()
      )
    )
      return;
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers()['range'] ?? '');
    if (match) traffic.bytes += Number(match[2]) - Number(match[1]) + 1;
  });
  return traffic;
}

test('l’orbite de Halley ne se télécharge qu’allumée', async ({ page }) => {
  const halley = watchBody(page, 'halley');
  // Une date FIXE : la période de Halley tient dans la couverture du fichier à cette date.
  await page.goto('/?date=2026-09-23T00:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });

  // Au démarrage : sa position seulement, quelques échantillons. Sa période en ferait des
  // centaines de kilo-octets.
  expect(halley.bytes).toBeGreaterThan(0);
  expect(halley.bytes).toBeLessThan(10_000);

  await clickWhenCalm(page, page.locator('#settings-trigger'));
  // Halley est dans le groupe des petits corps, replié par défaut : on le déplie d'abord.
  await page.getByRole('button', { name: /^Small bodies \d+$/ }).click();
  const orbit = page.getByRole('checkbox', { name: "Show Halley's orbit" });
  await orbit.scrollIntoViewIfNeeded();
  await expect(orbit).not.toBeChecked();
  await orbit.check();

  // La période entière part alors, et seulement alors.
  await expect
    .poll(() => halley.bytes, { timeout: 30_000 })
    .toBeGreaterThan(100_000);
});
