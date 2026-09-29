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
    const next = page.locator('.stour-next');
    for (let i = 0; i < 24; i++) {
      if (((await caption.textContent()) ?? '').includes(needle)) break;
      if (!(await next.isDisabled())) await next.click();
      else await page.waitForTimeout(200);
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
