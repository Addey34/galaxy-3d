import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { reportFailureDiagnostics } from './failureDiagnostics';
import { useAnimatedMotion } from './motion';
import {
  EXPEDITIONS,
  boot,
  expectContextRestored,
  expectJupiterEdition,
  openJupiter,
  playToEnd,
  quietEnglish,
  STEP_TIMEOUT,
} from './tourExpeditionScenarios';

/**
 * LES GRANDES EXPÉDITIONS (GAL-TOUR-EXCELLENCE-002), jouées EN ENTIER.
 *
 * Chaque visite va de sa première à sa dernière étape au clavier et au bouton « Suivant ». À
 * l'étape d'inspection, la carte de la visite se retire, la vue 3D de l'engin s'ouvre, Échap la
 * referme (et ne ferme PAS la visite), la carte revient avec le focus sur « Pause ». À la fin : la
 * carte est fermée, le mode de départ (Éducatif) est rendu, l'adresse ne porte plus la visite.
 * Juno vérifie en plus l'observation datée : la fiche de Jupiter dit l'édition 2015 pendant la
 * visite, et l'édition par défaut une fois la visite fermée (par la fin ou par Échap).
 *
 * Réseau extérieur coupé : le modèle 3D, servi par l'origine des gros fichiers, ne se charge pas, et
 * l'inspection le dit. Le parcours (ouverture, fermeture, retour de la visite) est ce qui est prouvé.
 */
test.afterEach(async ({ page }, testInfo) => {
  await reportFailureDiagnostics(page, testInfo);
});

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quietEnglish(page);
});

test.describe('bureau', () => {
  for (const id of EXPEDITIONS) {
    test(`${id} : jouée en entier, inspection fermée par Échap, contexte rendu`, async ({
      page,
    }) => {
      test.setTimeout(600_000);
      await boot(page, id);
      let sawEdition = false;
      const { captions, inspections } = await playToEnd(page, async (text) => {
        if (id === 'juno-jupiter' && /19 January 2015/.test(text)) {
          // La fiche ouverte par le vol décrit la scène : l'édition 2015 est bien posée.
          await expectJupiterEdition(page, 'opal_2015a');
          sawEdition = true;
        }
      });
      expect(captions).toBeGreaterThanOrEqual(5);
      expect(inspections).toBe(1);
      await expectContextRestored(page);
      if (id === 'juno-jupiter') {
        expect(sawEdition).toBe(true);
        // La visite rend l'édition par défaut : la fiche, rouverte, dit celle de 2025.
        await openJupiter(page);
        await expectJupiterEdition(page, 'opal_2025a');
      }
    });
  }

  test('Juno : pause, reprise, puis Échap en pleine visite rend le mode et l’édition', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await boot(page, 'juno-jupiter');
    const next = page.locator('.stour-next');
    const pause = page.locator('.stour-pause');
    const caption = page.locator('.stour-caption');
    // Jusqu'à la légende de l'observation datée.
    for (let i = 0; i < 6; i++) {
      await expect(next).toBeEnabled({ timeout: STEP_TIMEOUT });
      if (/19 January 2015/.test((await caption.textContent()) ?? '')) break;
      await next.click();
    }
    await expect(caption).toContainText('19 January 2015');
    await expectJupiterEdition(page, 'opal_2015a');
    await pause.click();
    await expect(pause).toHaveText('Resume');
    await pause.click();
    await expect(pause).toHaveText('Pause');
    await page.keyboard.press('Escape');
    await expect(page.locator('.stour-card')).toBeHidden();
    await expectContextRestored(page);
    await openJupiter(page);
    await expectJupiterEdition(page, 'opal_2025a');
  });
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('osiris-rex-bennu : jouée en entier à 390 px, sans débordement', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await boot(page, 'osiris-rex-bennu');
    const { captions, inspections } = await playToEnd(page, async () => {
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(0);
      const box = await page.locator('.stour-card').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    });
    expect(captions).toBeGreaterThanOrEqual(5);
    expect(inspections).toBe(1);
    await expectContextRestored(page);
  });
});

test.describe('téléphone, observation datée', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /**
   * Sur téléphone la visite replie la fiche qu'ouvre chaque vol. L'état final est le même qu'au
   * bureau : la fiche rouverte dit l'édition par défaut. Mesuré : ce résultat tient AUSSI sans le
   * `restoreEditions` de la visite, parce que le bloc des éditions suit le corps de la fiche même
   * repliée et rend le défaut quand la fin de visite sélectionne la vue d'ensemble. La restauration
   * de la visite reste le chemin d'une édition posée sur un corps que la fiche n'a jamais montré.
   */
  test('juno-jupiter : la visite finie, la fiche rouverte dit l’édition par défaut', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await boot(page, 'juno-jupiter');
    const { inspections } = await playToEnd(page);
    expect(inspections).toBe(1);
    await expectContextRestored(page);
    await openJupiter(page);
    if (await page.locator('#body-info.is-compact').count())
      await page.locator('#body-info .bi-toggle').click();
    await expectJupiterEdition(page, 'opal_2025a');
  });
});

test.describe('mouvement non réduit', () => {
  useAnimatedMotion();

  test('voyager2-giants : les vols animés jouent la visite en entier', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await boot(page, 'voyager2-giants');
    const { captions, inspections } = await playToEnd(page);
    expect(captions).toBeGreaterThanOrEqual(5);
    expect(inspections).toBe(1);
    await expectContextRestored(page);
  });
});
