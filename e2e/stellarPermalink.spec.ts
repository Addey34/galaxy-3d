import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { useAnimatedMotion } from './motion';
import {
  SOLAR,
  load,
  quiet,
  scenarioAddressFollows,
  scenarioDataUnavailable,
  scenarioDeepLink,
  scenarioDeepLinkClose,
  scenarioNoViewNoOpen,
  scenarioRepeat,
  scenarioReturn,
  scenarioUnknownStar,
} from './stellarAddressScenarios';

/**
 * L'ADRESSE D'UNE OBSERVATION DU VOISINAGE SOLAIRE (GAL-UNIVERSE-004), dans Chromium : bureau et
 * téléphone, quatre langues, avec et sans mouvement réduit. Les scénarios sont dans
 * `stellarAddressScenarios.ts`, que `device-stellarPermalink.spec.ts` rejoue sur Pixel 7 et iPhone 15
 * émulés ; le contrat est `core/stellarPermalink` et `docs/ARCHITECTURE.md`.
 */

const UNKNOWN: Record<string, RegExp> = {
  en: /not among the nearby stars/,
  fr: /ne figure pas parmi les étoiles voisines/,
  es: /no está entre las estrellas cercanas/,
  'pt-BR': /não está entre as estrelas próximas/,
};
const UNAVAILABLE: Record<string, RegExp> = {
  en: /file of nearby stars could not be read/,
  fr: /fichier des étoiles voisines n’a pas pu être lu/,
  es: /no se pudo leer el archivo de estrellas cercanas/,
  'pt-BR': /não foi possível ler o arquivo das estrelas próximas/,
};

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quiet(page);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('un lien ouvre la vue sur la bonne étoile et au bon temps', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await scenarioDeepLink(page);
  });

  test('sans `view=neighbourhood`, `star` et `t` ne rouvrent rien', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await scenarioNoViewNoOpen(page);
  });

  test('une étoile inconnue ou mal formée est dite, jamais ignorée en silence', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await scenarioUnknownStar(page, 'no-such-star', UNKNOWN['en']!);
  });

  test('un identifiant mal formé reçoit le même traitement', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await scenarioUnknownStar(page, '../../etc/passwd', UNKNOWN['en']!);
  });

  test('des étoiles illisibles : la vue ne s’ouvre pas, c’est dit, la demande est retirée', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await scenarioDataUnavailable(page, UNAVAILABLE['en']!);
  });

  test('l’adresse suit l’étoile et le temps, et un rechargement les retrouve', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await scenarioAddressFollows(page);
  });

  test.describe('retour', () => {
    // Incident récurrent (runs 45885343865 et 45916089589) : la configuration ne trace que le
    // RÉESSAI (`on-first-retry`), et `test.use({ trace })` est refusé dans un groupe. La première
    // tentative de CE test est donc tracée à la main, et sa trace gardée seulement si elle échoue.
    test.beforeEach(async ({ context }, testInfo) => {
      if (testInfo.retry === 0)
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
        });
    });
    test.afterEach(async ({ context }, testInfo) => {
      if (testInfo.retry !== 0) return;
      const failed = testInfo.status !== testInfo.expectedStatus;
      await context.tracing.stop(
        failed ? { path: testInfo.outputPath('trace-first-attempt.zip') } : {}
      );
    });

    test('retour : bouton, Échap, Retour et Suivant du navigateur, sans recharger ni résidu', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await scenarioReturn(page);
    });
  });

  test('arrivé par un lien, fermer réécrit l’adresse sans retirer d’entrée', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await scenarioDeepLinkClose(page);
  });

  test('ouvrir et fermer plusieurs fois ne laisse ni écouteur ni canevas', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await scenarioRepeat(page);
  });

  test('la vue ouverte par un lien n’a aucune violation d’accessibilité, et le clavier la referme', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await load(page, `${SOLAR}&view=neighbourhood&star=proxima-centauri&t=300`);
    await expect(page.locator('#stellar-view')).toBeVisible({
      timeout: 60_000,
    });
    // Le focus est dans la vue, sur « Retour au Système solaire » : le clavier suffit.
    await expect(page.locator('#stellar-back')).toBeFocused();
    const results = await new AxeBuilder({ page })
      .include('#stellar-view')
      .analyze();
    expect(results.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('view'))
      .toBeNull();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('un lien ouvre la vue sur la bonne étoile et au bon temps', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await scenarioDeepLink(page);
    // Le volet bas porte la fiche : aucun débordement horizontal.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

for (const locale of ['fr', 'es', 'pt-BR'] as const) {
  test.describe(`langue ${locale}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test(`une étoile inconnue est dite en ${locale}`, async ({ page }) => {
      test.setTimeout(180_000);
      // `quiet` a déjà posé l'anglais : la dernière valeur écrite avant le `goto` gagne.
      await quiet(page, locale);
      await scenarioUnknownStar(page, 'no-such-star', UNKNOWN[locale]!);
    });
  });
}

test.describe('mouvement non réduit', () => {
  useAnimatedMotion();
  test.use({ viewport: { width: 1280, height: 800 } });

  test('la transition d’arrivée n’empêche pas l’observation demandée par le lien', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await load(page, `${SOLAR}&view=neighbourhood&star=barnards-star&t=-600`);
    await expect(page.locator('#stellar-view')).toBeVisible({
      timeout: 60_000,
    });
    // L'étoile et le temps sont posés dès l'ouverture, pendant que la caméra recule encore.
    await expect(
      page.locator('#stellar-list button[aria-pressed="true"]')
    ).toContainText(/^Barnard/);
    await expect(page.locator('#stellar-time-out')).toContainText('-600 years');
    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0);
  });
});

test.describe('données illisibles, autres langues', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('le message est celui de la langue du visiteur', async ({ page }) => {
    test.setTimeout(180_000);
    await quiet(page, 'es');
    await scenarioDataUnavailable(page, UNAVAILABLE['es']!);
  });
});
