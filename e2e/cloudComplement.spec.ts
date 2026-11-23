import { test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import {
  scenarioBothMissing,
  scenarioEmptyAqua,
  scenarioFill,
  scenarioNoAqua,
  scenarioViirsAlone,
} from './cloudComplementScenarios';

/**
 * LE COMBLEMENT DES COINS NOIRS DE FAUCHÉE (GAL-CLOUD-VISUAL-001) dans Chromium, sur un GIBS
 * simulé. Les scénarios et leur raison d'être sont dans `cloudComplementScenarios.ts`, que
 * `device-cloudComplement.spec.ts` rejoue sur Pixel 7 et iPhone 15 émulés.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

test('VIIRS absent, MODIS Terra a une fente : Aqua la comble, et le badge nomme les deux', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await scenarioFill(page);
});

test('ce que les deux instruments n’ont pas vu reste sans donnée, et le dit', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await scenarioBothMissing(page);
});

test('sans Aqua, la couche marche comme avant : image seule, badge inchangé, aucune erreur', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await scenarioNoAqua(page);
});

test('un jour vide chez Aqua n’est pas recopié : image seule', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await scenarioEmptyAqua(page);
});

test('VIIRS n’est pas complété : aucune requête MODIS, badge VIIRS', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await scenarioViirsAlone(page);
});
