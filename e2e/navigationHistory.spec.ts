import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  alive,
  boot,
  expectBody,
  historyLength,
  path,
  quietStart,
  scenarioBackForward,
  scenarioEclipseBack,
  scenarioLocaleBack,
  scenarioTourBack,
  scenarioOverview,
  scenarioPermalinks,
  scenarioRepeatAndRapid,
  scenarioStateIsNotNavigation,
} from './historyScenarios';
import { blockExternalNetwork } from './netBlock';

/**
 * L'HISTORIQUE DU NAVIGATEUR, au bureau (GAL-PRODUCT-015). Les scénarios partagés vivent dans
 * `historyScenarios.ts` ; le mobile émulé les rejoue dans `device-navigationHistory.spec.ts`.
 */
const FIRST_TOUR = (
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../src/registry/tours/order.json'),
      'utf-8'
    )
  ) as { order: string[] }
).order[0]!;

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quietStart(page);
});

test('Terre, Mars, Jupiter, Retour, Retour, Suivant : le corps est restauré sans recharger', async ({
  page,
}) => {
  await scenarioBackForward(page);
});

test('la vue d’ensemble est une destination de l’historique', async ({
  page,
}) => {
  await scenarioOverview(page);
});

test('un même corps choisi plusieurs fois, ou plusieurs corps en plein vol, ne fait pas de doublon', async ({
  page,
}) => {
  await scenarioRepeatAndRapid(page);
});

test('la date, le mode et la lecture réécrivent l’entrée sans en ajouter', async ({
  page,
}) => {
  await scenarioStateIsNotNavigation(page);
});

test('un permalien existant s’ouvre, se recharge, et Retour reste cohérent', async ({
  page,
}) => {
  await scenarioPermalinks(page);
});

test('une visite guidée n’accumule pas ses étapes dans l’historique', async ({
  page,
}) => {
  // Depuis la vue d'ensemble : les vols de la visite vers d'autres corps (Terre, Lune...) seraient
  // chacun une entrée si le permalien n'était pas suspendu pendant la visite.
  await boot(page, `/?tour=${FIRST_TOUR}`);
  const start = await historyLength(page);
  const next = page.locator('.stour-next');
  await expect(next).toBeVisible({ timeout: 30_000 });
  let advanced = 0;
  for (let i = 0; i < 12 && (await next.isVisible()); i++) {
    await next.click();
    advanced++;
    await page.waitForTimeout(700);
  }
  expect(advanced).toBeGreaterThanOrEqual(1);
  // Les étapes ont fait voler la caméra ; l'historique n'a pas bougé, l'adresse non plus.
  expect(await historyLength(page)).toBe(start);
  expect(path(page)).toBe('/');

  // À la fin la vue d'ensemble est rétablie : même corps que l'entrée de départ, donc aucune
  // entrée de plus, et le document n'a pas été rechargé.
  const close = page.locator('.stour-close');
  if (await close.isVisible()) await close.click();
  await expect(page.locator('.stour-card')).toBeHidden();
  await expectBody(page, '/', null);
  expect(await historyLength(page)).toBe(start);
  expect(await alive(page)).toBe('yes');
});

test('Retour vers une page d’éclipse restaure le corps sans imposer pause, date ni cadrage', async ({
  page,
}) => {
  await scenarioEclipseBack(page);
});

test('Retour après un changement de langue garde la langue choisie', async ({
  page,
}) => {
  await scenarioLocaleBack(page);
});

test('Retour pendant une visite guidée ne déplace pas la caméra de la visite', async ({
  page,
}) => {
  await scenarioTourBack(page);
});
