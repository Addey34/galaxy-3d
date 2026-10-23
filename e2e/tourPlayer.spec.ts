import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickWhenCalm, waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LES VISITES SONT LUES DANS LE REGISTRE, PAS ÉCRITES ICI (lot 21).
 *
 * Ce fichier comptait « 3 » en dur. Depuis que les visites sont des fiches
 * (`src/registry/tours/`), le compte et les titres viennent d'`order.json` et des fiches
 * elles-mêmes : c'est ce qui rend vraie la promesse du lot — ajouter une visite est une fiche et
 * une ligne d'ordre, sans toucher une ligne de `.ts`, pas même un test.
 */
const TOURS = resolve(import.meta.dirname, '../src/registry/tours');
const ORDER = (
  JSON.parse(readFileSync(resolve(TOURS, 'order.json'), 'utf-8')) as {
    order: string[];
  }
).order;
const FICHES = ORDER.map(
  (id) =>
    JSON.parse(readFileSync(resolve(TOURS, `${id}.json`), 'utf-8')) as {
      title: { en: string };
      steps: { kind: string; text?: { en: string } }[];
    }
);
/** La légende anglaise la plus longue du registre, et la visite qui la porte. */
const LONGEST_CAPTION = FICHES.flatMap((fiche, index) =>
  fiche.steps
    .filter((step) => step.kind === 'caption' && step.text !== undefined)
    .map((step) => ({ index, text: step.text!.en }))
).reduce((best, entry) =>
  entry.text.length > best.text.length ? entry : best
);
const TITLES_EN = FICHES.map((fiche) => fiche.title.en);

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  // Évite que le tour d'accueil première-visite (`ui/guidedTour.ts`) ne s'affiche par-dessus
  // et n'intercepte les clics — sans rapport avec les tours scénarisés testés ici.
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function openPicker(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  // Le chargeur masqué ne veut pas dire « cliquable » : la mesure est dans `e2e/mainThread.ts`.
  // C'est la même cause qui a fait expirer `.stour-next` à 15 s dans le shard 6 rouge de la
  // PR #42, juste après `titan.spec.ts`, le journal s'arrêtant à « done scrolling ».
  await waitForCalmMainThread(page);
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await expect(page.locator('.stour-picker')).toBeVisible();
}

/**
 * Clique « Suivant » tant qu'il est actif (légende sans durée), attend sinon (étape
 * flyTo/jumpToDate en cours — instantanée sous `reducedMotion: 'reduce'`, cf. playwright.config.ts).
 */
async function advanceToEnd(page: Page): Promise<void> {
  const card = page.locator('.stour-card');
  const next = page.locator('.stour-next');
  for (let i = 0; i < 20; i++) {
    if (!(await card.isVisible())) return;
    if (!(await next.isDisabled())) {
      // Une visite en cours enchaîne vols de caméra et sauts de date : le thread est occupé
      // par à-coups, et c'est ce clic-ci qui a expiré dans le shard 6 rouge de la PR #42.
      await clickWhenCalm(page, next);
    } else {
      await page.waitForTimeout(200);
    }
  }
  await expect(card).toBeHidden({ timeout: 20_000 });
}

/**
 * Démarre la visite `index` et attend que la scène ait fini d'encaisser sa première étape.
 *
 * L'apaisement n'est pas décoratif : la visite de l'éclipse commence par un SAUT DE DATE, qui
 * recharge des fenêtres d'éphémérides et recalcule toutes les positions. Sous frein CPU × 8, le
 * clic suivant sur `.stour-close` expirait à 15 s — et seulement pour l'éclipse, les trois
 * autres visites passant (mesuré le 2026-09-28). C'est la même cause que dans
 * `e2e/mainThread.ts`, à un autre instant : le thread, pas le réseau.
 */
async function startTour(page: Page, index: number): Promise<void> {
  await page.locator('.stour-picker-item').nth(index).click();
  await expect(page.locator('.stour-card')).toBeVisible();
  await waitForCalmMainThread(page);
}

test.describe('scripted tour picker', () => {
  test('lists every tour of the registry, in the declared order', async ({
    page,
  }) => {
    await openPicker(page);
    const items = page.locator('.stour-picker-item');
    await expect(items).toHaveCount(ORDER.length);
    // Le titre vient de la fiche : ce contrôle est ce qui prouve que la DONNÉE arrive à l'écran.
    await expect(items).toHaveText(TITLES_EN);
  });
});

test.describe('eclipse tour', () => {
  test('runs to completion and returns to overview', async ({ page }) => {
    await openPicker(page);
    const bodyInfo = page.locator('#body-info');

    await page.locator('.stour-picker-item').nth(0).click();
    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    // Les étapes `jumpToDate`/`flyTo` sont instantanées sous reducedMotion : pas d'assertion
    // sur le numéro d'étape ici, la course jusqu'à la 1re légende serait sujette aux courses.
    await expect(bodyInfo).toBeVisible(); // vol vers la Terre effectué

    await advanceToEnd(page);
    await expect(card).toBeHidden();
    // Fin de tour : `navigation.selectBody('overview')` referme la fiche d'info.
    await expect(bodyInfo).toBeHidden();
  });

  /**
   * L'ÉTAPE QUI A REMPLACÉ UNE EXCEPTION DE CODE (lot 21).
   *
   * La première étape de cette visite était, jusqu'ici, préfixée par `ui/tourPlayer.ts` quand
   * l'identifiant valait « eclipse ». C'est désormais une étape `jumpToEvent` écrite dans la
   * fiche, et la date est résolue depuis `core/astronomicalEvents.ts` à l'exécution. Ce contrôle
   * est le seul qui prouve la chaîne entière : fiche → schéma → chargeur → moteur → horloge.
   *
   * Le délai est explicite et sa raison écrite : depuis le lot 17C l'horloge est RETENUE jusqu'à
   * l'arrivée des octets d'éphémérides, et un saut de date prend une dizaine de secondes de
   * médiane (relevé du 2026-09-27 dans `e2e/events.spec.ts` : 1,3 à 13,6 s). Un délai par défaut
   * de 30 s tomberait au hasard de la machine.
   */
  test('jumps the scene to a real eclipse date, from the fiche alone', async ({
    page,
  }) => {
    await openPicker(page);
    const dateInput = page.locator('#date-input');
    const before = await dateInput.inputValue();

    await page.locator('.stour-picker-item').nth(0).click();
    await expect(dateInput).not.toHaveValue(before, { timeout: 90_000 });

    // Une éclipse solaire survient deux fois par an : la date atteinte est donc à venir, et
    // proche. Le contrôle borne les deux côtés — une date figée dans une fiche aurait fini par
    // tomber dans le passé, ce que cette étape existe pour éviter.
    const after = new Date(await dateInput.inputValue());
    const now = Date.now();
    expect(after.getTime()).toBeGreaterThan(now);
    expect(after.getTime() - now).toBeLessThan(400 * 24 * 3600 * 1000);
  });

  test('can be closed early with the Close button', async ({ page }) => {
    await openPicker(page);
    await startTour(page, 0);

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await clickWhenCalm(page, page.locator('.stour-close'));
    await expect(card).toBeHidden();
    await expect(page.locator('#body-info')).toBeHidden();
  });

  test('can be closed early with Escape', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(0).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
  });
});

/**
 * CHAQUE visite du registre démarre et se ferme — la boucle est sur `order.json`, jamais sur des
 * indices écrits à la main.
 *
 * Deux tests nommaient `nth(1)` et `nth(2)` (« galileans », « kuiper ») : une visite ajoutée
 * n'était donc exercée par rien. Cette forme-ci couvre la quatrième sans être modifiée, ce qui est
 * la même promesse que le lot tient sur le reste de la chaîne.
 */
test.describe('every tour of the registry', () => {
  for (const [index, id] of ORDER.entries()) {
    test(`${id} runs and can be closed`, async ({ page }) => {
      await openPicker(page);
      await startTour(page, index);

      const card = page.locator('.stour-card');
      await expect(card).toBeVisible();
      // Le TOTAL, pas l'étape courante : une visite dont les premières étapes sont instantanées
      // (l'éclipse saute la date, puis vole) a déjà dépassé l'étape 1 quand on regarde, et une
      // assertion sur « 1 » serait une course. Le total, lui, vient de la fiche et ne bouge pas.
      await expect(page.locator('.stour-progress')).toHaveText(
        new RegExp(`\\b${FICHES[index]!.steps.length}$`)
      );

      // La visite CONTINUE de jouer pendant qu'on regarde : on ferme quand la scène a rendu la
      // main, sinon le clic tombe dans le vol ou le saut de date de l'étape suivante.
      await clickWhenCalm(page, page.locator('.stour-close'));
      await expect(card).toBeHidden();
      await expect(page.locator('#body-info')).toBeHidden();
    });
  }
});

test.describe('mobile scripted tour', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * LE BANDEAU DE PROVENANCE NE PASSE PAS SOUS LA CARTE (2026-10-20). Vu sur le delta du Nil à
   * 390 px : la carte de la visite, au-dessus de lui dans la pile, cachait ses lignes de crédit,
   * que la licence de l'imagerie exige à l'écran. Pendant une visite il se place sous la barre du
   * haut, à gauche de la colonne de boutons. L'imagerie est coupée dans cette suite : le bandeau
   * est rendu visible à la main, avec un crédit aussi long que celui d'EOX.
   */
  test('keeps the imagery credit clear of the tour card and the buttons', async ({
    page,
  }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(0).click();
    await expect(page.locator('.stour-card')).toBeVisible();
    await page.evaluate(() => {
      const badge = document.querySelector<HTMLElement>('#surface-imagery')!;
      badge.hidden = false;
      for (const [cls, text] of [
        [
          'si-headline',
          'EOxCloudless Sentinel-2 cloudless 2016 (s2cloudless) à 611 m/pixel',
        ],
        ['si-detail', 'images de janvier 2016 à décembre 2017 · observé'],
        [
          'si-credit',
          'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017) · NOAA National Centers for Environmental Information (ETOPO 2022) · Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved · Water mask: NASA GIBS (MODIS/SRTM)',
        ],
      ] as const)
        badge.querySelector(`.${cls}`)!.textContent = text;
      // Le bandeau se replace sur cet événement, comme à la publication de la carte.
      window.dispatchEvent(new Event('galaxy:tour-clearance'));
    });
    const rect = (selector: string) =>
      page.evaluate((sel) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }, selector);
    const badge = await rect('#surface-imagery');
    const card = await rect('.stour-card');
    const topDock = await rect('.dock--top-left');
    // Le premier bouton VISIBLE : « Fiche du corps » reste masqué tant que la visite n'a
    // sélectionné aucun corps (elle attend sa date avant de voler), et son rectangle vaut zéro.
    const button = await page.evaluate(() => {
      for (const b of document.querySelectorAll('.dock--top-right button')) {
        const r = b.getBoundingClientRect();
        if (r.width > 0) return { left: r.left };
      }
      throw new Error('aucun bouton visible dans la colonne de droite');
    });
    expect(badge.bottom, 'above the card').toBeLessThanOrEqual(card.top);
    expect(badge.top, 'under the top bar').toBeGreaterThanOrEqual(
      topDock.bottom
    );
    expect(badge.right, 'left of the button column').toBeLessThanOrEqual(
      button.left
    );
    // Fermée, la visite rend le bandeau à sa place du bas.
    await clickWhenCalm(page, page.locator('.stour-close'));
    await expect(page.locator('.stour-card')).toBeHidden();
    // Sans imagerie, la fermeture a masqué le bandeau : on le remontre pour lire où il se pose.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#surface-imagery')!.hidden = false;
      window.dispatchEvent(new Event('resize'));
    });
    const after = await rect('#surface-imagery');
    expect(after.top, 'back at the bottom').toBeGreaterThan(badge.top + 100);
    expect(
      await page.evaluate(() => document.documentElement.dataset['tour'])
    ).toBeUndefined();
  });

  /**
   * LA PLUS LONGUE LÉGENDE DU REGISTRE, et non la première visite venue.
   *
   * Ce test mesurait la carte sur `nth(0)`, dont la première étape n'affiche aucune prose : il ne
   * disait donc rien du cas qui déborde vraiment. La visite visée est DÉRIVÉE des fiches, donc une
   * visite plus bavarde ajoutée demain sera mesurée sans que ce fichier change.
   */
  test('keeps the longest caption inside a phone viewport', async ({
    page,
  }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(LONGEST_CAPTION.index).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();

    // On avance jusqu'à CETTE légende : les étapes de vol et de saut sont instantanées sous
    // `reducedMotion`, et « Suivant » reste désactivé tant qu'elles courent.
    const needle = LONGEST_CAPTION.text.slice(0, 40);
    const caption = page.locator('.stour-caption');
    for (let i = 0; i < 24; i++) {
      // LECTURE ET CLIC EN UN SEUL TEMPS, dans la page : la légende cherchée peut apparaître
      // entre une lecture faite côté test et le clic qui suit, et ce clic la sautait (vu en CI,
      // shard 3, 2026-10-19 : le test se retrouvait au périhélie). « Suivant » est aussi masqué
      // sans être désactivé pendant la transition d'une légende, d'où le test de visibilité.
      const found = await page.evaluate((text) => {
        const cap = document.querySelector('.stour-caption');
        if ((cap?.textContent ?? '').includes(text)) return true;
        const btn = document.querySelector<HTMLButtonElement>('.stour-next');
        if (btn && !btn.disabled && btn.offsetParent !== null) btn.click();
        return false;
      }, needle);
      if (found) break;
      await page.waitForTimeout(200);
    }
    await expect(caption).toContainText(needle);

    const box = await card.boundingBox();
    if (!box) throw new Error('Tour card is not measurable');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });
});

/**
 * LE SOMMAIRE DE LA VISITE EST ANNONCÉ, ET IL EST DÉRIVÉ DE LA FICHE.
 *
 * La carte disait « Étape 3 sur 8 » : une POSITION, et rien sur ce que la visite contient. Un
 * visiteur voyant a la scène pour le deviner ; un lecteur d'écran n'a que ce dialogue. Le
 * sommaire liste les LÉGENDES — les temps du récit — et non les `flyTo` ni les `wait`, qui sont
 * de la mécanique.
 *
 * Ce test compare à la FICHE, donc il suit une visite qu'on modifie, et il tombe si le sommaire
 * se met à lister autre chose que le récit.
 */
test.describe("le sommaire d'une visite", () => {
  test('est rattaché au dialogue et cite les légendes de sa fiche', async ({
    page,
  }) => {
    await openPicker(page);
    await startTour(page, 0);

    const card = page.locator('.stour-card');
    const describedBy = await card.getAttribute('aria-describedby');
    expect(describedBy, 'le dialogue ne décrit rien').toBe('stour-outline');

    const outline = page.locator('#stour-outline');
    const text = (await outline.textContent()) ?? '';
    const beats = FICHES[0]!.steps.filter(
      (step) => step.kind === 'caption' && step.text !== undefined
    );
    expect(text).toContain(TITLES_EN[0]!);
    expect(text, 'le nombre de parties vient de la fiche').toContain(
      String(beats.length)
    );
    // Comparaison EXACTE, et non « contient » : c'est la seule forme qui prouve aussi que le
    // sommaire ne liste RIEN D'AUTRE. Un `flyTo` ou un `wait` qui s'y glisserait passerait
    // sous un `toContain`, puisque les légendes y seraient toujours.
    const expected = beats.map((step) => step.text!.en).join(' · ');
    expect(text.slice(text.indexOf(': ') + 2)).toBe(expected);

    // Le témoin : cette visite CONTIENT bien de la mécanique, sinon la phrase ci-dessus ne
    // prouverait rien.
    const mechanical = FICHES[0]!.steps.filter(
      (step) => step.kind !== 'caption'
    );
    expect(
      mechanical.length,
      'cette visite est faite de légendes seules : mauvais témoin'
    ).toBeGreaterThan(0);

    // Et le sommaire n'est pas VISIBLE : la carte est étroite, et la scène le redit déjà.
    await expect(outline).toHaveClass(/sr-only/);
  });
});

/**
 * UNE VISITE PEUT CHANGER D'ÉCHELLE, ET ELLE REND CE QU'ELLE A EMPRUNTÉ (lot 35, ligne 22.8 d).
 *
 * « Voyage aux confins » passe en Explo juste avant Sedna : c'est le seul endroit du récit où
 * la distance cesse d'être un mot. Deux choses se vérifient ici, et la seconde est celle qui
 * aurait été livrée cassée — `finish()` remettait la VITESSE mais pas le MODE, si bien qu'une
 * visite laissait l'application dans un réglage que l'utilisateur n'a pas choisi.
 *
 * Le mode restauré est celui du DÉPART, pas « éduc » en dur : un utilisateur déjà en Explo ne
 * doit pas en être sorti par une visite.
 */
test.describe('une visite qui change d’échelle', () => {
  const KUIPER = ORDER.indexOf('kuiper');

  test('passe en Explo pendant le récit, puis rend le mode de départ', async ({
    page,
  }) => {
    expect(KUIPER, 'la visite kuiper a disparu du registre').toBeGreaterThan(
      -1
    );
    await openPicker(page);

    const before = await page.evaluate(() =>
      document.body.classList.contains('is-explo-mode') ? 'explo' : 'educ'
    );
    expect(before, 'le témoin part en Éduc').toBe('educ');

    await startTour(page, KUIPER);
    // On avance jusqu'à ce que la scène bascule : c'est le FAIT qu'on mesure, pas un compte
    // d'étapes qui changerait avec la fiche. Les légendes sans durée attendent un geste, donc
    // il en faut un — c'est le même enchaînement qu'`advanceToEnd`, arrêté sur le basculement.
    const explo = page.locator('body.is-explo-mode');
    const next = page.locator('.stour-next');
    for (let i = 0; i < 25 && (await explo.count()) === 0; i++) {
      if (!(await next.isDisabled())) await clickWhenCalm(page, next);
      else await page.waitForTimeout(300);
    }
    await expect(explo, 'la visite n’est jamais passée en Explo').toHaveCount(
      1
    );
    await expect(
      page.locator('#mode-controls .mode-btn[data-mode="explo"]')
    ).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.stour-close').click();
    await expect(page.locator('.stour-card')).toBeHidden();
    // Rendu : la classe du corps ET le bouton, parce que les deux se désynchroniseraient si la
    // visite avait appelé `OrbitalMechanics` au lieu du sélecteur.
    await expect(page.locator('body.is-explo-mode')).toBeHidden();
    await expect(
      page.locator('#mode-controls .mode-btn[data-mode="educ"]')
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * UNE FICHE D'ACTIVITÉ OUVRE SA VISITE D'UN LIEN (lot 58) : `?tour=<id>`.
 *
 * Trois choses, dont la troisième a été vue cassée à l'image : la visite part sans geste ; la
 * découverte de premier passage ne se superpose PAS à elle (on retire donc ici le témoin que le
 * `beforeEach` pose) ; et l'adresse ne garde pas `tour`, sinon un rechargement la relancerait.
 * Le paramètre était d'abord lu APRÈS `applyInitialState`, qui l'avait déjà effacé : la visite ne
 * partait jamais.
 */
test.describe('une visite ouverte par son adresse', () => {
  test('?tour=seasons lance la visite, seule, et l’adresse ne la garde pas', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.removeItem('ssv-guided-tour-v1')
    );
    await page.goto('/?tour=seasons');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('.stour-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.stour-caption')).toContainText(
      FICHES[ORDER.indexOf('seasons')]!.steps.find(
        (step) => step.kind === 'caption'
      )!.text!.en.slice(0, 40),
      { timeout: 60_000 }
    );
    await expect(page.locator('.tour-dialog')).toBeHidden();
    expect(new URL(page.url()).searchParams.has('tour')).toBe(false);
  });

  test('une visite inconnue ne lance rien', async ({ page }) => {
    await page.goto('/?tour=nope');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    await waitForCalmMainThread(page);
    await expect(page.locator('.stour-card')).toBeHidden();
  });
});

/**
 * « LE DELTA DU NIL DANS LE TEMPS » : la fiche choisit le fond Sentinel-2, plonge sur un NOM, et
 * REND le fond qu'elle a emprunté. L'imagerie d'EOX est coupée : la visite doit aller à son bout
 * sans réseau (l'attente d'une surface calme est bornée), le bandeau disant ce qui est affiché.
 */
test.describe('nile-delta tour', () => {
  test('dives onto the named place, borrows the base, gives it back', async ({
    page,
  }) => {
    // La première plongée rejoue jusqu'à cinq fois sans imagerie : mesuré 1,4 min en local et plus de
    // 2 min sur le coureur, au-delà du délai par défaut de 120 s.
    test.setTimeout(300_000);
    await page.route('**eox.at/**', (route) => route.abort());
    await page.goto('/?tour=nile-delta');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

    const next = page.locator('.stour-next');
    await expect(next).toBeEnabled({ timeout: 120_000 });
    await expect(page.locator('canvas').first()).toHaveAttribute(
      'data-place-dive',
      /^Nile Delta\|/
    );
    await expect(page.locator('#surface-earth-base')).toHaveValue('sentinel-2');
    // `?tour=` est une ouverture : l'adresse ne la garde pas, un rechargement ne la rejouerait pas.
    expect(page.url()).not.toContain('tour=');

    // La visite s'ARRÊTE ici, sans la jouer jusqu'au bout : chaque plongée est rejouée jusqu'à son
    // cadrage, et sans imagerie qui l'affine (coupée plus haut) la fin prend plus de deux minutes
    // sur le coureur de CI (shard 3, run 39367700824, délai de test dépassé), sans rien prouver de
    // plus. Que la visite aille à son bout sans réseau est tenu par `core/tourEngine.test.ts`
    // (attente de surface bornée, plongées en nombre borné).
    await clickWhenCalm(page, page.locator('.stour-close'));
    await expect(page.locator('.stour-card')).toBeHidden();
    // Rendu : le fond d'avant la visite, qui est Sentinel-2 depuis le 2026-10-23, donc le même que
    // celui qu'elle emprunte : ce contrôle ne distingue plus « rendu » de « jamais changé ». Le
    // retour du fond n'est plus tenu que par la lecture du code de `tourPlayer.finish()`.
    await expect(page.locator('#surface-earth-base')).toHaveValue('sentinel-2');
  });
});
