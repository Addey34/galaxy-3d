import { test } from '@playwright/test';
import {
  quietStart,
  scenarioBackForward,
  scenarioEclipseBack,
  scenarioLocaleBack,
  scenarioOverview,
  scenarioPermalinks,
  scenarioRepeatAndRapid,
} from './historyScenarios';
import { blockExternalNetwork } from './netBlock';

/** L'historique du navigateur sur Pixel 7 et iPhone 15 émulés (GAL-PRODUCT-015). */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quietStart(page);
});

test('Retour et Suivant restaurent les corps sans recharger la scène', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioBackForward(page);
});

test('la vue d’ensemble est une destination, et les choix répétés ne font pas de doublon', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioOverview(page);
  await scenarioRepeatAndRapid(page);
});

test('un permalien existant s’ouvre et se recharge', async ({ page }) => {
  test.setTimeout(240_000);
  await scenarioPermalinks(page);
});

test('Retour vers une éclipse ou après un changement de langue', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioEclipseBack(page);
  await scenarioLocaleBack(page);
});
