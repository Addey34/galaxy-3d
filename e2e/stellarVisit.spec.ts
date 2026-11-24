import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';
import { SOLAR, load, quiet } from './stellarAddressScenarios';

/**
 * LA VISITE GUIDÉE DU VOISINAGE SOLAIRE (GAL-UNIVERSE-005), dans Chromium : le bouton des Réglages l'ouvre,
 * sept arrêts du Soleil aux étoiles les plus remarquables du catalogue, le temps et l'étoile suivent
 * l'arrêt, l'adresse porte `visit=` et `step=`, on peut la quitter (la vue reste libre) et la reprendre, la
 * nature de chaque information est dite, rien n'est téléchargé avant qu'on la demande, quatre langues,
 * clavier, téléphone. Les nombres affichés sont LUS dans les données par la visite : ce fichier vérifie
 * leur présence et leur forme, `core/stellarVisit.test.ts` leur justesse contre les fichiers livrés.
 */
const VISIT_MODULE = /\/src\/ui\/stellarVisit\.ts(\?.*)?$/;
const panel = (page: Page) => page.locator('#stellar-visit');
const title = (page: Page) => page.locator('#stellar-visit-title');
const progress = (page: Page) => page.locator('#stellar-visit-progress');
const search = (page: Page) => new URL(page.url()).searchParams;

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await quiet(page);
});

async function openVisitFromSettings(page: Page): Promise<void> {
  await load(page, SOLAR);
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#stellar-visit-open').click();
  await expect(panel(page)).toBeVisible({ timeout: 60_000 });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('rien de la visite n’est téléchargé avant qu’on la demande, puis un seul chargement', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const requests: string[] = [];
    page.on('request', (r) => {
      if (VISIT_MODULE.test(r.url())) requests.push(r.url());
    });
    await load(page, SOLAR);
    await page.waitForTimeout(2000);
    expect(requests).toEqual([]);
    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    // Ouvrir la vue sans visite ne charge toujours pas la visite : le bouton de la vue est là, rien de plus.
    await page.locator('#stellar-open').click();
    await expect(page.locator('#stellar-view')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('#stellar-visit-start')).toBeVisible();
    expect(requests).toEqual([]);
    await page.locator('#stellar-visit-start').click();
    await expect(panel(page)).toBeVisible({ timeout: 60_000 });
    expect(requests).toHaveLength(1);
  });

  test('sept arrêts : l’étoile, le temps et l’adresse suivent, la nature des informations est dite', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openVisitFromSettings(page);
    await expect(progress(page)).toHaveText('Stop 1 of 7');
    await expect(page.locator('#stellar-visit-prev')).toBeDisabled();
    expect(search(page).get('visit')).toBe('neighbours');
    expect(search(page).get('step')).toBe('0');
    // Le Soleil : l'échelle, sans étoile choisie ni ligne de données.
    await expect(page.locator('#stellar-visit-body')).toContainText(
      'one unit is one parsec'
    );
    await expect(page.locator('.sv-visit-facts dt')).toHaveCount(0);

    // Arrêt 2 : l'étoile la plus proche, choisie PAR LA RÈGLE ; l'archive en liste des planètes.
    await page.locator('#stellar-visit-next').click();
    await expect(progress(page)).toHaveText('Stop 2 of 7');
    await expect(title(page)).toContainText('Proxima Centauri');
    await expect(search(page).get('star')).toBe('proxima-centauri');
    await expect(
      page.locator('.sv-visit-facts dt', { hasText: 'Planets listed' })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#stellar-visit-body')).toContainText(
      'draws no planet'
    );

    // Arrêt 3 : le plus grand mouvement propre ; le temps est déplacé et dit CALCULÉ.
    await page.locator('#stellar-visit-next').click();
    await expect(title(page)).toContainText("Barnard's Star");
    expect(search(page).get('t')).toBe('6000');
    await expect(page.locator('#stellar-visit-body')).toContainText(
      'CALCULATED'
    );
    await expect(page.locator('.sv-visit-reading-list')).toContainText(
      'Calculated'
    );
    await page.locator('.sv-visit-reading summary').click();
    await expect(page.locator('.sv-visit-reading-list')).toContainText(
      'Illustrative'
    );
    await expect(page.locator('.sv-visit-reading-list')).toContainText(
      'Unknown here'
    );
    // La planète d'une étoile qui en a (l'archive en liste quatre pour Barnard) n'est JAMAIS « aucune ».
    await expect(page.locator('.sv-visit-facts dd').last()).not.toHaveText(
      'none'
    );

    // Arrêt 4 : la plus brillante, un système double dont une naine blanche (type D).
    await page.locator('#stellar-visit-next').click();
    await expect(title(page)).toContainText('Sirius');
    await expect(search(page).get('t')).toBeNull();
    await expect(page.locator('#stellar-visit-body')).toContainText(
      'white dwarf'
    );

    // Les arrêts à planètes de l'archive : des entrées de catalogue, rien de dessiné.
    for (const star of ['Ran', 'Gl 71']) {
      await page.locator('#stellar-visit-next').click();
      await expect(title(page)).toContainText(star);
      await expect(page.locator('#stellar-visit-body')).toContainText(
        /lists \d+ planets? for this star/
      );
    }
    await page.locator('#stellar-visit-next').click();
    await expect(progress(page)).toHaveText('Stop 7 of 7');
    await expect(title(page)).toContainText("Kapteyn's Star");
    await expect(page.locator('#stellar-visit-next')).toHaveText(
      'Finish the visit'
    );
    // Terminer : le panneau part, la liste des étoiles revient, le focus va à « Retour », l'adresse est propre.
    await page.locator('#stellar-visit-next').click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('#stellar-back')).toBeFocused();
    expect(search(page).get('visit')).toBeNull();
    expect(search(page).get('step')).toBeNull();
    await expect(page.locator('#stellar-list')).toBeVisible();
  });

  test('quitter la visite laisse la vue libre, la reprendre revient au même arrêt', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openVisitFromSettings(page);
    await page.locator('#stellar-visit-next').click();
    await page.locator('#stellar-visit-next').click();
    await expect(progress(page)).toHaveText('Stop 3 of 7');

    await page.locator('#stellar-visit-leave').click();
    await expect(page.locator('#stellar-visit-resume')).toBeFocused();
    await expect(page.locator('#stellar-visit-resume')).toHaveText(
      'Resume the visit (stop 3 of 7)'
    );
    expect(search(page).get('visit')).toBeNull();
    // Libre : la liste est là, une autre étoile se choisit, le curseur se déplace.
    await expect(page.locator('#stellar-list')).toBeVisible();
    await page.locator('#stellar-list button', { hasText: /^Sirius/ }).click();
    await expect(
      page.locator('#stellar-list button[aria-pressed="true"]')
    ).toContainText('Sirius');

    await page.locator('#stellar-visit-resume').click();
    await expect(progress(page)).toHaveText('Stop 3 of 7');
    await expect(title(page)).toContainText("Barnard's Star");
    expect(search(page).get('visit')).toBe('neighbours');
    expect(search(page).get('step')).toBe('2');
    await expect(page.locator('#stellar-list')).toBeHidden();

    // Échap ferme la vue, et la visite avec elle : plus de panneau, aucun résidu dans l'adresse.
    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    expect(search(page).get('visit')).toBeNull();
    expect(search(page).get('view')).toBeNull();
  });

  test('un lien ouvre la visite à son arrêt ; une visite inconnue est dite et retirée de l’adresse', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await load(page, `${SOLAR}&view=neighbourhood&visit=neighbours&step=4`);
    await expect(panel(page)).toBeVisible({ timeout: 60_000 });
    await expect(progress(page)).toHaveText('Stop 5 of 7');
    await expect(title(page)).toContainText('Ran');
    expect(search(page).get('star')).toBe('ran');
    // Une étape hors visite se ramène à la dernière : jamais un arrêt qui n'existe pas.
    await page.goto(`${SOLAR}&view=neighbourhood&visit=neighbours&step=99`);
    await expect(progress(page)).toHaveText('Stop 7 of 7', { timeout: 60_000 });

    await load(page, `${SOLAR}&view=neighbourhood&visit=no-such-visit`);
    await expect(page.locator('#stellar-view')).toBeVisible({
      timeout: 60_000,
    });
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => search(page).get('visit')).toBeNull();
    await expect(page.locator('#stellar-visit-start')).toBeVisible();
  });

  test('l’archive en chargement ou illisible ne dit JAMAIS « aucune planète » : un nombre absent n’est pas zéro', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Chargement : la réponse est retenue par une porte, jamais par un délai deviné.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/assets/sky/exoplanets.json', async (route) => {
      await gate;
      await route.continue();
    });
    await load(page, `${SOLAR}&view=neighbourhood&visit=neighbours&step=1`);
    await expect(panel(page)).toBeVisible({ timeout: 60_000 });
    const body = page.locator('#stellar-visit-body');
    await expect(body).toContainText('still loading');
    await expect(body).not.toContainText(/lists no planet|lists 0/);
    await expect(
      page.locator('.sv-visit-facts dt', { hasText: 'Planets listed' })
    ).toHaveCount(0);
    release();
    await expect(body).toContainText(/lists \d+ planets for this star/, {
      timeout: 30_000,
    });
    await expect(body).not.toContainText('still loading');
    await expect(
      page.locator('.sv-visit-facts dt', { hasText: 'Planets listed' })
    ).toBeVisible();
  });

  test('archive illisible : la phrase le dit, aucune ligne de planètes, rien n’est présenté comme zéro', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.route('**/assets/sky/exoplanets.json', (route) => route.abort());
    await load(page, `${SOLAR}&view=neighbourhood&visit=neighbours&step=1`);
    await expect(panel(page)).toBeVisible({ timeout: 60_000 });
    const body = page.locator('#stellar-visit-body');
    await expect(body).toContainText('could not be read', { timeout: 30_000 });
    await expect(body).toContainText('does not mean zero planets');
    await expect(body).not.toContainText(/lists no planet|still loading/);
    await expect(
      page.locator('.sv-visit-facts dt', { hasText: 'Planets listed' })
    ).toHaveCount(0);
    // Les arrêts à planètes suivants disent la même chose, dans la langue de la page.
    for (let i = 0; i < 3; i += 1)
      await page.locator('#stellar-visit-next').click();
    await expect(title(page)).toContainText('Ran');
    await expect(body).toContainText('could not be read');
  });

  test('clavier seul, axe, et le texte suit la langue (français)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => localStorage.setItem('ssv-locale', 'fr'));
    await openVisitFromSettings(page);
    await expect(progress(page)).toHaveText('Étape 1 sur 7');
    await expect(page.locator('#stellar-visit-body')).toContainText(
      'un parsec'
    );
    // Le focus est sur « Étape suivante » : Entrée avance, sans souris.
    await expect(page.locator('#stellar-visit-next')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(progress(page)).toHaveText('Étape 2 sur 7');
    await expect(title(page)).toContainText('L’étoile la plus proche');
    await expect(
      page.locator('.sv-visit-facts dt', { hasText: 'Planètes listées' })
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const axe = await new AxeBuilder({ page })
      .include('#stellar-visit')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    // Le changement d'arrêt est ANNONCÉ (région vivante unique de l'application).
    await expect(page.locator('body > [aria-live]').first()).toBeAttached();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('la visite tient dans l’écran, aucun débordement, les boutons se touchent', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await load(page, `${SOLAR}&view=neighbourhood&visit=neighbours&step=1`);
    await expect(panel(page)).toBeVisible({ timeout: 60_000 });
    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const id of ['#stellar-visit-next', '#stellar-visit-leave']) {
      const b = (await page.locator(id).boundingBox())!;
      expect(b.height, id).toBeGreaterThanOrEqual(24);
    }
    await page.locator('#stellar-visit-next').tap();
    await expect(progress(page)).toHaveText('Stop 3 of 7');
    await page.locator('#stellar-visit-leave').tap();
    await expect(page.locator('#stellar-visit-resume')).toBeVisible();
    await page.locator('#stellar-visit-resume').tap();
    await expect(progress(page)).toHaveText('Stop 3 of 7');
  });
});
