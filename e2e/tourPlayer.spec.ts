import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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
      steps: unknown[];
    }
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
      await next.click();
    } else {
      await page.waitForTimeout(200);
    }
  }
  await expect(card).toBeHidden({ timeout: 20_000 });
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
    await page.locator('.stour-picker-item').nth(0).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    await page.locator('.stour-close').click();
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
      await page.locator('.stour-picker-item').nth(index).click();

      const card = page.locator('.stour-card');
      await expect(card).toBeVisible();
      // Le TOTAL, pas l'étape courante : une visite dont les premières étapes sont instantanées
      // (l'éclipse saute la date, puis vole) a déjà dépassé l'étape 1 quand on regarde, et une
      // assertion sur « 1 » serait une course. Le total, lui, vient de la fiche et ne bouge pas.
      await expect(page.locator('.stour-progress')).toHaveText(
        new RegExp(`\\b${FICHES[index]!.steps.length}$`)
      );

      await page.locator('.stour-close').click();
      await expect(card).toBeHidden();
      await expect(page.locator('#body-info')).toBeHidden();
    });
  }
});

test.describe('mobile scripted tour', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the caption card inside a phone viewport', async ({ page }) => {
    await openPicker(page);
    await page.locator('.stour-picker-item').nth(0).click();

    const card = page.locator('.stour-card');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    if (!box) throw new Error('Tour card is not measurable');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });
});
