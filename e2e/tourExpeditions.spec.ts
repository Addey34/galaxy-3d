import { expect, test, type Page } from '@playwright/test';
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

/**
 * L'OBSERVATION DATÉE QUI MANQUE (finalisation de GAL-TOUR-EXCELLENCE-002). Le service worker est bloqué :
 * il servirait les textures et contournerait l'interception (même règle que `surfaceEditions.spec.ts`).
 * Chaque édition que la SCÈNE montre est enregistrée, même une seule image, par le témoin de la fiche
 * (`#surface-editions`, `data-scene-edition`, publié à chaque image, fiche ouverte ou fermée).
 */
test.describe('observation datée : indisponible, retardée, catalogue absent', () => {
  test.use({ serviceWorkers: 'block' });

  /** Jusqu'à la première légende de Juno (la fiche de Jupiter est ouverte), puis le témoin des éditions. */
  async function toFirstCaption(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page, 'juno-jupiter');
    await expect(page.locator('.stour-next')).toBeEnabled({
      timeout: STEP_TIMEOUT,
    });
    await page.locator('#surface-editions').waitFor({ state: 'attached' });
    await page.evaluate(() => {
      const box = document.getElementById('surface-editions')!;
      const seen: string[] = [];
      (window as unknown as { __sceneEditions: string[] }).__sceneEditions =
        seen;
      new MutationObserver(() => {
        seen.push(box.dataset['sceneEdition'] ?? '');
      }).observe(box, {
        attributes: true,
        attributeFilter: ['data-scene-edition'],
      });
    });
    return errors;
  }
  const sceneEditions = (page: Page): Promise<string[]> =>
    page.evaluate(
      () => (window as unknown as { __sceneEditions: string[] }).__sceneEditions
    );

  test('indisponible : la carte de visite le dit, la scène garde la carte affichée, la visite continue', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.route('**/jupiter_surface__opal_2015a_*', (route) =>
      route.abort()
    );
    const errors = await toFirstCaption(page);
    await page.locator('.stour-next').click();
    const notice = page.locator('.stour-notice');
    await expect(notice).toBeVisible({ timeout: STEP_TIMEOUT });
    // L'échec est DIT : la date demandée, la carte qui reste, et que la légende ne décrit pas l'écran.
    await expect(notice).toContainText('could not be loaded');
    await expect(notice).toContainText('2015');
    await expect(notice).toContainText('2025');
    await expect(page.locator('.stour-caption')).toContainText(
      '19 January 2015'
    );
    await expectJupiterEdition(page, 'opal_2025a');
    expect(await sceneEditions(page)).not.toContain('opal_2015a');
    // La visite continue jusqu'au bout ; le signalement ne suit pas les vols suivants.
    await page.locator('.stour-next').click();
    await expect(page.locator('.stour-next')).toBeEnabled({
      timeout: STEP_TIMEOUT,
    });
    await expect(notice).toBeHidden();
    const { inspections } = await playToEnd(page);
    expect(inspections).toBe(1);
    await expectContextRestored(page);
    expect(errors).toEqual([]);
  });

  test('retardée puis Échap : la visite se ferme tout de suite, l’édition tardive ne se pose jamais', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const HOLD_MS = 8_000;
    let released = false;
    await page.route('**/jupiter_surface__opal_2015a_*', async (route) => {
      await new Promise((r) => setTimeout(r, HOLD_MS));
      released = true;
      await route.continue().catch(() => {});
    });
    const errors = await toFirstCaption(page);
    const requested = page.waitForRequest('**/jupiter_surface__opal_2015a_*');
    await page.locator('.stour-next').click();
    await requested;
    const t0 = Date.now();
    await page.keyboard.press('Escape');
    // Fermée sans attendre le réseau (le chargement retenu dure 8 s).
    await expect(page.locator('.stour-card')).toBeHidden({ timeout: 3_000 });
    expect(Date.now() - t0).toBeLessThan(HOLD_MS);
    expect(released).toBe(false);
    await expectContextRestored(page);
    // Le chargement retenu arrive après la fermeture : il ne doit rien poser.
    await expect.poll(() => released, { timeout: HOLD_MS + 5_000 }).toBe(true);
    await page.waitForTimeout(3_000);
    expect(await sceneEditions(page)).not.toContain('opal_2015a');
    await openJupiter(page);
    await expectJupiterEdition(page, 'opal_2025a');
    expect(errors).toEqual([]);
  });

  test('catalogue absent : la visite le dit et va au bout', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Le catalogue des éditions ne s'obtient pas (module refusé au chargement).
    await page.route(/surface-edition-catalogue/, (route) => route.abort());
    await boot(page, 'juno-jupiter');
    let sawNotice = false;
    const { inspections } = await playToEnd(page, async () => {
      if (await page.locator('.stour-notice').isVisible()) {
        await expect(page.locator('.stour-notice')).toContainText(
          'could not be loaded'
        );
        sawNotice = true;
      }
    });
    expect(sawNotice).toBe(true);
    expect(inspections).toBe(1);
    await expectContextRestored(page);
    // Aucune promesse rejetée non traitée venue du lecteur.
    expect(errors.filter((m) => /tour|edition/i.test(m))).toEqual([]);
  });
});
