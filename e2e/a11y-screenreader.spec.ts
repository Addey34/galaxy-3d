import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES GARDES DE LA PASSE LECTEUR D'ÉCRAN (lot 19).
 *
 * Chaque test de ce fichier tient UN défaut mesuré par la passe NVDA décrite dans
 * `docs/private/LECTEUR_ECRAN_LOT19.md`, et porte son numéro. Aucun n'a été écrit à partir
 * d'une règle générale : tous viennent d'un énoncé qui a été entendu, ou d'un silence qui a
 * été mesuré.
 *
 * Ce que ces gardes NE remplacent PAS : le lecteur d'écran lui-même. Elles vérifient les
 * CONDITIONS de ce qu'on a entendu (le focus est là, le nom existe, la région live porte le
 * message), pas la parole. La capture réelle reste `scripts/capture-screenreader.mjs`, qui
 * demande NVDA et Windows et ne peut donc pas tourner ici.
 *
 * Complète `a11y-audit.spec.ts` (axe-core, des RÈGLES) et `a11y-tree.spec.ts` (des NOMS et des
 * ÉTATS). Celui-ci parle de PARCOURS : où va le focus, et ce que l'application dit quand elle
 * change d'état.
 */

async function boot(
  page: Page,
  options: { locale?: string; firstVisit?: boolean } = {}
): Promise<void> {
  const { locale = 'en', firstVisit = false } = options;
  await blockExternalNetwork(page);
  await page.addInitScript(
    ([loc, first]) => {
      localStorage.setItem('ssv-locale', loc as string);
      if (!first) {
        localStorage.setItem('ssv-guided-tour-v1', '1');
        localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      }
    },
    [locale, firstVisit]
  );
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
}

/** Le descripteur de l'élément focalisé, tel qu'un relevé l'écrirait. */
const focusedElement = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'document.body';
    const dialog = el.closest('[role="dialog"]');
    const id = dialog?.id
      ? `#${dialog.id}`
      : dialog
        ? `.${String(dialog.className).split(/\s+/)[0]}`
        : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${id ? ` dans ${id}` : ''}`;
  });

test.describe('langue de ce qui est annoncé en premier', () => {
  /**
   * D1. `ui/documentTitle` n'appliquait le titre que sur `setBody`, `setEclipse` ou un
   * changement de langue. Sur la vue d'ensemble, aucun des trois ne se produit : le titre
   * ANGLAIS de la page statique restait donc en place, et c'est le PREMIER énoncé qu'un
   * lecteur d'écran lit en entrant dans le document.
   */
  test("le titre de l'onglet est traduit dès l'arrivée, sans aucune sélection", async ({
    page,
  }) => {
    await boot(page, { locale: 'fr' });
    expect(await page.title()).toBe(
      'Galaxy : système solaire 3D interactif en temps réel'
    );
  });

  /**
   * D2. Le `<h1 class="sr-only">` reste ANGLAIS dans `index.html` : c'est l'ancre que
   * `src/seo/bodyLandingPage.ts` remplace, et le texte que lisent les robots. L'application
   * doit donc le localiser au démarrage. `src/seo/headingParity.test.ts` tient les deux
   * versions anglaises identiques ; ici on vérifie que le remplacement A LIEU.
   */
  test('le seul titre de niveau 1 de la page est traduit', async ({ page }) => {
    await boot(page, { locale: 'fr' });
    const heading = await page.locator('h1.sr-only').textContent();
    expect(heading?.trim()).toContain('système solaire 3D interactif');
    expect(heading).not.toContain('Real-Time Interactive');
  });
});

test.describe('repères de la page', () => {
  /**
   * D3. La page n'exposait QU'UN repère, « Contrôles temporels ». Ni `main`, ni rien pour la
   * scène : la navigation par repères, premier réflexe sur une page inconnue, ne menait nulle
   * part. Et les deux docks portaient un `aria-label` sur un `<div>` SANS rôle, donc exposé
   * nulle part.
   */
  test('la scène est un repère principal nommé, et les deux docks sont des barres d’outils', async ({
    page,
  }) => {
    await boot(page, { locale: 'en' });
    const main = page.locator('[role="main"]');
    await expect(main).toHaveCount(1);
    expect(await main.getAttribute('aria-label')).toBeTruthy();
    // La toile EST le contenu principal : `SceneSystem` l'attache au `<body>`.
    expect(await main.evaluate((el) => el.tagName)).toBe('CANVAS');

    const toolbars = page.locator('[role="toolbar"]');
    await expect(toolbars).toHaveCount(2);
    for (const name of await toolbars.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label'))
    )) {
      expect(
        name,
        'une barre d’outils sans nom ne dit pas ce qu’elle contient'
      ).toBeTruthy();
    }
  });
});

test.describe('le focus suit ce que fait l’application', () => {
  /**
   * D4. Choisir un corps dans la palette fermait la palette, ouvrait la fiche, changeait
   * l'onglet et l'adresse — en laissant `document.activeElement` sur `document.body`. Après
   * l'action PRINCIPALE de l'application, il fallait retabuler depuis le début du document.
   */
  test('choisir un corps laisse le focus dans la fiche, jamais sur le body', async ({
    page,
  }) => {
    await boot(page, { locale: 'en' });
    await page.locator('#body-search-trigger').click();
    await expect(page.locator('#palette-input')).toBeFocused();
    await page.locator('#palette-input').fill('mars');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('#body-info')).toBeVisible();
    await expect
      .poll(() => focusedElement(page), { timeout: 5_000 })
      .toContain('dans #body-info');
  });

  /**
   * D5 et D10, qui n'ont qu'une cause. Quatre surfaces sur six ouvraient leur panneau en
   * laissant le focus sur le déclencheur, et leur écouteur d'Échap est posé SUR LE PANNEAU :
   * tant que le focus n'y entre pas, Échap ne peut pas se déclencher. Mesuré : quatorze
   * tabulations entre le bouton et le panneau qu'il venait d'ouvrir, et un Échap sans effet.
   */
  for (const [trigger, panel] of [
    ['#settings-trigger', '#orbit-options'],
    ['#weather-trigger', '#weather-layers'],
    ['#earth-events-trigger', '#earth-events'],
    ['#help-btn', '#help-popover'],
  ] as const) {
    test(`ouvrir ${panel} y emmène le focus, et Échap le referme`, async ({
      page,
    }) => {
      await boot(page, { locale: 'en' });
      await page.locator(trigger).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(panel)).toBeVisible();

      // Le focus est DANS le panneau : sans cela il faut traverser tout le dock pour l'atteindre.
      expect(
        await page.evaluate(
          (sel) =>
            document.querySelector(sel)?.contains(document.activeElement) ??
            false,
          panel
        ),
        `le focus n’est pas entré dans ${panel}`
      ).toBe(true);

      // Et donc Échap, écouté sur le panneau, fonctionne enfin.
      await page.keyboard.press('Escape');
      await expect(page.locator(panel)).toBeHidden();
      await expect(page.locator(trigger)).toBeFocused();
    });
  }
});

test.describe('ce que l’application dit quand elle change d’état', () => {
  /**
   * D6. Le chargement dure une dizaine de secondes. `#loader` n'avait ni rôle ni région live,
   * et la passe a mesuré 2 500 ms de silence complet après sa disparition : rien ne disait que
   * l'application était prête.
   */
  test('la fin du chargement est annoncée dans une région live du document', async ({
    page,
  }) => {
    await boot(page, { locale: 'en' });
    const live = page.locator('body > p[role="status"][aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toContainText('ready', {
      ignoreCase: true,
      timeout: 15_000,
    });
    // La région est attachée au `<body>` : une région live posée dans un panneau `hidden`
    // n'annonce rien, ce qui était le défaut de celle de `ui/offlineData`.
    expect(await live.evaluate((el) => el.closest('[hidden]') === null)).toBe(
      true
    );
  });

  /**
   * D11. Activer une ligne d'événement déplace la date de plusieurs jours, parfois de
   * plusieurs mois. Mesuré : 3 000 ms de silence après l'activation, donc rien ne distinguait
   * « j'ai voyagé jusqu'à l'éclipse » de « il ne s'est rien passé ».
   */
  test('activer une ligne d’événement annonce la nouvelle date', async ({
    page,
  }) => {
    await boot(page, { locale: 'en' });
    const live = page.locator('body > p[role="status"][aria-live="polite"]');
    await page.locator('#events-trigger').click();
    await expect(page.locator('#astronomical-events')).toBeVisible();
    await page.locator('#astronomical-events .event-row').first().click();
    await expect(live).toContainText('Date set to', { timeout: 5_000 });
  });

  /**
   * D8. On tapait « m », « a », « r », et rien n'était énoncé : la première information
   * arrivait à la flèche bas. Une liste de résultats sans nom, et aucun compte annoncé.
   */
  test('la recherche annonce combien de corps correspondent', async ({
    page,
  }) => {
    await boot(page, { locale: 'en' });
    const live = page.locator('body > p[role="status"][aria-live="polite"]');
    await page.locator('#body-search-trigger').click();
    await page.locator('#palette-input').fill('mars');
    await expect(live).toContainText(/match/i, { timeout: 5_000 });
    expect(
      await page.locator('#palette-results').getAttribute('aria-label')
    ).toBeTruthy();
  });
});

test.describe('la recherche filtre vraiment', () => {
  /**
   * D12, ET CE DÉFAUT-LÀ GÊNAIT TOUT LE MONDE. `ui/bodyPalette` pose bien `hidden` sur les
   * entrées qui ne correspondent pas, mais `.palette-item { display: flex }` l'emportait sur
   * la règle `[hidden]` du navigateur : les 71 corps restaient AFFICHÉS. Le clavier sautait
   * quand même à la bonne entrée, ce qui rendait le défaut discret, et NVDA annonçait
   * « Mars, 5 sur 71 » au lieu de « 1 sur 1 ».
   */
  test('taper un nom masque réellement les corps qui ne correspondent pas', async ({
    page,
  }) => {
    await boot(page, { locale: 'en' });
    await page.locator('#body-search-trigger').click();
    const options = page.locator('#palette-results [role="option"]');
    const total = await options.count();
    expect(total, 'la palette liste tout le catalogue').toBeGreaterThan(30);

    await page.locator('#palette-input').fill('mars');
    const rendered = await options.evaluateAll(
      (els) => els.filter((el) => el.checkVisibility()).length
    );
    expect(rendered, 'le filtre ne masque rien à l’écran').toBeLessThan(total);
    expect(rendered).toBeGreaterThan(0);
  });
});

test.describe('les dialogues modaux tiennent ce qu’ils déclarent', () => {
  /**
   * D7. Les deux dialogues de visite portaient `role="dialog"` et `aria-modal="true"` sans
   * aucun nom : entendu tel quel au journal, « Speaking ['dialog'] ». Une boîte de dialogue
   * modale anonyme est annoncée « dialogue », sans dire lequel.
   */
  test('aucun dialogue ouvert n’est anonyme', async ({ page }) => {
    await boot(page, { locale: 'en', firstVisit: true });
    const tour = page.locator('.tour-dialog');
    await expect(tour).toBeVisible();
    const named = await tour.evaluate((el) => {
      const byId = el.getAttribute('aria-labelledby');
      const label = byId
        ? document.getElementById(byId)?.textContent?.trim()
        : null;
      return el.getAttribute('aria-label')?.trim() || label || '';
    });
    expect(
      named,
      'la visite guidée s’annonce « dialogue » et rien d’autre'
    ).not.toBe('');

    // La carte de visite scriptée déclare la même modalité : elle porte son nom dès sa
    // création, donc on peut le lire sans lancer une visite.
    expect(
      await page.locator('.stour-card').getAttribute('aria-label')
    ).toBeTruthy();
  });

  /**
   * D9. `aria-modal="true"` déclare le reste de la page inerte. Mesuré : depuis le bouton
   * « Fermer la visite », cinq tabulations sortent du dialogue et parcourent les étiquettes de
   * la scène. Un dialogue qui promet une modalité sans la tenir est pire qu'un dialogue non
   * modal : le lecteur d'écran restreint sa lecture à un contenu que le focus a déjà quitté.
   */
  test('la visite guidée retient le focus, et le laisse circuler', async ({
    page,
  }) => {
    await boot(page, { locale: 'en', firstVisit: true });
    await expect(page.locator('.tour-dialog')).toBeVisible();

    // Assez de tabulations pour faire plus d'un tour complet des boutons du dialogue.
    const visited: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const dialog = document.querySelector('.tour-dialog');
        const active = document.activeElement;
        return {
          contained: dialog?.contains(active) ?? false,
          who: active ? String((active as HTMLElement).className) : 'body',
        };
      });
      expect(
        inside.contained,
        `le focus est sorti du dialogue à la tabulation ${i + 1}`
      ).toBe(true);
      visited.push(inside.who);
    }

    // ET IL CIRCULE. Sans cette seconde moitié, un piège cassé qui immobiliserait le focus sur
    // un seul bouton laisserait ce test vert : « resté à l'intérieur » est vrai aussi quand
    // rien ne bouge. C'est exactement ce qu'aurait produit un filtre de visibilité fondé sur
    // `offsetParent`, nul pour un dialogue en `position: fixed`.
    expect(
      new Set(visited).size,
      `le focus n’a pas circulé : ${visited.join(' → ')}`
    ).toBeGreaterThan(1);
  });
});
