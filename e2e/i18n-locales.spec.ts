import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES QUATRE LANGUES, ET LA SEULE CHOSE QU'UN TEST UNITAIRE NE PEUT PAS VOIR (lot 20, phase 20A).
 *
 * Depuis ce lot, le dictionnaire de la langue active arrive par un import DYNAMIQUE : seul
 * l'anglais est dans la clôture statique du démarrage. Cela crée un mode de panne que ni le
 * compilateur ni Vitest ne verraient — le premier texte affiché avant l'arrivée du dictionnaire
 * serait ANGLAIS, chez un visiteur hispanophone, et rien ne le dirait ensuite : le chargeur ne se
 * retraduit pas, il disparaît.
 *
 * D'où la garde centrale de ce fichier : on enregistre le PREMIER texte que le chargeur affiche,
 * avec un observateur posé avant tout script d'application, plutôt que de courir après lui avec
 * une assertion. C'est la leçon du banc du lot 19 — on relève, on ne court pas.
 */

/**
 * Tous les textes SUCCESSIFS de `#load-status`, horodatés, enregistrés avant tout script.
 *
 * On enregistre au lieu de courir après : une assertion lancée après `goto` peut arriver quand
 * le chargeur a déjà changé d'étape, et rendrait un verdict dépendant de la machine.
 */
async function bootRecordingLoader(page: Page, locale: string): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript((loc) => {
    localStorage.setItem('ssv-locale', loc as string);
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    const w = window as unknown as {
      __loaderTexts?: { text: string; at: number }[];
    };
    w.__loaderTexts = [];
    const record = (): void => {
      const text =
        document.getElementById('load-status')?.textContent?.trim() ?? '';
      const seen = w.__loaderTexts!;
      if (text !== '' && seen[seen.length - 1]?.text !== text)
        seen.push({ text, at: Math.round(performance.now()) });
    };
    new MutationObserver(record).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener('DOMContentLoaded', record);
  }, locale);
  await page.goto('/');
}

const loaderTexts = (page: Page): Promise<{ text: string; at: number }[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __loaderTexts?: { text: string; at: number }[] })
        .__loaderTexts ?? []
  );

/**
 * Les libellés du chargeur que `t()` produirait EN ANGLAIS. Aucun ne doit apparaître dans une
 * autre langue : ce serait la preuve que `t()` a répondu avant l'arrivée du dictionnaire.
 *
 * « Initializing... » n'en fait PAS partie, et c'est mesuré, pas concédé : ce texte est celui
 * qu'`index.html` porte en dur, affiché dès la première peinture, donc AVANT que le moindre
 * script tourne. Il reste visible le temps d'un aller-retour réseau (le dictionnaire), ce qui
 * est le prix de la langue chargée à la demande, et il est chiffré dans le journal du lot 20.
 */
const ENGLISH_LOADER_LABELS = [
  'Loading core components',
  'Building scene',
  'Setting up lighting',
  'Creating celestial bodies',
  'Finalizing',
  'Starting',
  'Ready for launch',
  'Ephemeris data loaded',
  'Textures loaded',
];

test.describe('le dictionnaire arrive avant le premier texte', () => {
  for (const [locale, translated] of [
    ['es', /Inicializando|Cargando|Construyendo|Creando|Finalizando/],
    ['pt-BR', /Inicializando|Carregando|Construindo|Criando|Finalizando/],
  ] as const) {
    test(`${locale} : le chargeur n’énonce aucun libellé anglais`, async ({
      page,
    }) => {
      await bootRecordingLoader(page, locale);
      await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
      const seen = await loaderTexts(page);
      expect(seen.length, 'étapes enregistrées').toBeGreaterThan(1);

      // Le texte statique d'`index.html` ouvre la séquence : il est peint avant tout script.
      expect(seen[0]!.text).toContain('Initializing');
      // Tout le reste vient de `t()`, donc du dictionnaire : aucun libellé anglais ne doit
      // s'y trouver, et au moins un libellé traduit doit y être.
      const produced = seen.slice(1).map((entry) => entry.text);
      // La MESURE, pas seulement le verdict : combien de temps le texte statique anglais reste
      // affiché avant que le dictionnaire arrive. C'est le prix de la langue à la demande, et il
      // est reporté dans le journal du lot 20 plutôt que deviné.
      test.info().annotations.push({
        type: 'mesure',
        description: `${locale} : statique anglais jusqu’à ${seen[1]!.at} ms, séquence = ${seen
          .map((entry) => `${entry.at}ms ${entry.text}`)
          .join(' → ')}`,
      });
      for (const english of ENGLISH_LOADER_LABELS)
        expect(
          produced.join(' | '),
          `${english} servi en ${locale} : dictionnaire arrivé trop tard`
        ).not.toContain(english);
      expect(produced.join(' | ')).toMatch(translated);
    });
  }
});

test.describe('ce que chaque langue sert', () => {
  for (const [locale, lang, overview] of [
    ['es', 'es', 'Vista general'],
    ['pt-BR', 'pt-BR', 'Visão geral'],
  ] as const) {
    test(`${locale} : chrome statique, <html lang> et catalogue`, async ({
      page,
    }) => {
      await bootRecordingLoader(page, locale);
      await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });

      // `<html lang>` est ce qui décide de la VOIX d'un lecteur d'écran et de la coupure de mots.
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('#orbit-overview .chip-label')).toHaveText(
        overview
      );
      // Aucun libellé statique ne doit rester sur sa valeur anglaise.
      await expect(page.locator('#orbit-overview .chip-label')).not.toHaveText(
        'Overview'
      );
    });
  }
});

test.describe('le sélecteur de langue', () => {
  test('porte quatre segments, dit lequel est actif, et annonce le changement', async ({
    page,
  }) => {
    await bootRecordingLoader(page, 'en');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
    await page.locator('#help-btn').click();

    const segments = page.locator('#lang-switch .lang-btn');
    await expect(segments).toHaveCount(4);
    // L'état actif était porté par une CLASSE seule avant le lot 20 : invisible pour un lecteur
    // d'écran, ce qui passait encore à deux segments et plus du tout à quatre.
    await expect(
      page.locator('#lang-switch .lang-btn[data-locale="en"]')
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('#lang-switch .lang-btn[data-locale="es"]')
    ).toHaveAttribute('aria-pressed', 'false');
    // Le nom de la langue est énoncé dans SA langue, avec `lang` pour la prononciation.
    await expect(
      page.locator('#lang-switch .lang-btn[data-locale="pt-BR"]')
    ).toHaveAttribute('aria-label', 'Português (Brasil)');

    await page.locator('#lang-switch .lang-btn[data-locale="es"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(
      page.locator('#lang-switch .lang-btn[data-locale="es"]')
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('#lang-switch .lang-btn[data-locale="en"]')
    ).toHaveAttribute('aria-pressed', 'false');
    // Le changement est ANNONCÉ, dans la langue d'arrivée : sans cela, quelqu'un au clavier
    // entend le bouton qu'il active, puis rien, alors que toute l'interface a changé de langue.
    await expect(
      page.locator('body > p[role="status"][aria-live="polite"]')
    ).toContainText('Idioma de la interfaz: Español.', { timeout: 5_000 });
  });

  test('bascule le catalogue et la fiche sans re-sélection', async ({
    page,
  }) => {
    await bootRecordingLoader(page, 'en');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
    await page.locator('#body-search-trigger').click();
    await page.locator('#orbit-earth').click();
    const panel = page.locator('#body-info');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.bi-name')).toHaveText('Earth');

    await page.locator('#help-btn').click();
    await page.locator('#lang-switch .lang-btn[data-locale="pt-BR"]').click();
    // Les libellés de la fiche viennent du dictionnaire, donc ils suivent tout de suite.
    await expect(panel).toContainText('Raio');
    await expect(panel).toContainText('Massa');
  });
});

test.describe('le texte du catalogue suit la langue', () => {
  /**
   * LA GARDE DE L'OPTIMISATION DU LOT 20 : le bundle ne porte que l'anglais des fiches, et les
   * autres langues arrivent dans une carte dérivée au build (`config/catalogueText`). Si cette
   * carte n'arrivait pas, ou se posait sur les mauvais objets, la fiche afficherait sa
   * description ANGLAISE sous une interface espagnole — et aucun test unitaire ne le verrait,
   * puisque Vitest passe par la voie SSR, qui garde les quatre langues.
   */
  test('la fiche d’un corps est décrite en espagnol', async ({ page }) => {
    await bootRecordingLoader(page, 'es');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
    await page.locator('#body-search-trigger').click();
    await page.locator('#orbit-earth').click();
    const panel = page.locator('#body-info');
    await expect(panel).toBeVisible();
    // Le nom vient de `displayName`, la description de `realData.description` : deux champs
    // différents de la fiche, donc deux preuves que la carte s'est posée au bon endroit.
    await expect(panel.locator('.bi-name')).toHaveText('Tierra');
    await expect(panel).toContainText(
      'El único planeta conocido que alberga vida'
    );
    await expect(panel).not.toContainText('The only known planet');
  });

  test('et en anglais, c’est bien l’anglais des fiches', async ({ page }) => {
    // Le TÉMOIN : sans lui, une carte qui ne se poserait jamais passerait pour un succès si le
    // test espagnol cherchait une chaîne trop courte.
    await bootRecordingLoader(page, 'en');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
    await page.locator('#body-search-trigger').click();
    await page.locator('#orbit-earth').click();
    const panel = page.locator('#body-info');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.bi-name')).toHaveText('Earth');
    await expect(panel).toContainText('The only known planet to harbour life');
  });
});
