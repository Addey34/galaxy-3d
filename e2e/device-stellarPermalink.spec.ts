import { test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import {
  quiet,
  scenarioAddressFollows,
  scenarioDataUnavailable,
  scenarioDeepLink,
  scenarioReturn,
  scenarioUnknownStar,
} from './stellarAddressScenarios';

/**
 * L'adresse d'une observation du voisinage solaire sur Pixel 7 (Chromium Android) et iPhone 15
 * (WebKit) émulés (GAL-UNIVERSE-004). Mêmes scénarios que `stellarPermalink.spec.ts`, avec le
 * mouvement réduit de la configuration. Hors CI : `pnpm test:mobile` (docs/TESTING.md). Ce que cela
 * NE prouve PAS : le toucher réel, la chaleur, la mémoire GPU d'un téléphone physique.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quiet(page);
});

test('un lien ouvre la vue sur la bonne étoile et au bon temps', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioDeepLink(page);
});

test('une étoile inconnue est dite, la vue s’ouvre sans sélection', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioUnknownStar(page, 'no-such-star', /not among the nearby stars/);
});

test('des étoiles illisibles : la vue ne s’ouvre pas et c’est dit', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioDataUnavailable(page, /file of nearby stars could not be read/);
});

test('l’adresse suit l’étoile et le temps, un rechargement les retrouve', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioAddressFollows(page);
});

test('retour : bouton, Échap, Retour et Suivant du navigateur', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioReturn(page);
});
