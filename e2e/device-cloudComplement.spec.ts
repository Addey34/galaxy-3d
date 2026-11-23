import { test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { scenarioFill, scenarioNoAqua } from './cloudComplementScenarios';

/**
 * Le comblement des coins noirs de fauchée sur Pixel 7 (Chromium Android) et iPhone 15 (WebKit)
 * émulés (GAL-CLOUD-VISUAL-001). Mêmes scénarios que `cloudComplement.spec.ts` ; sur un téléphone la
 * couche des nuages ne démarre qu'à la demande, on la coche donc dans le panneau météo. Hors CI :
 * `pnpm test:mobile` (docs/TESTING.md). Ce que cela NE prouve PAS : un vrai téléphone (mémoire,
 * chaleur), ni le coût du comblement sur ce matériel.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

test('une fente de Terra est comblée par Aqua, et le badge nomme les deux', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioFill(page, true);
});

test('sans Aqua : image seule, comme avant, aucune erreur', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scenarioNoAqua(page, true);
});
