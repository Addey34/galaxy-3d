import { expect, type Page } from '@playwright/test';

/**
 * L'HISTORIQUE DU NAVIGATEUR (GAL-PRODUCT-015). Les scénarios sont écrits une fois ici et joués
 * par deux fichiers : `navigationHistory.spec.ts` (bureau, serveur de développement) et
 * `device-navigationHistory.spec.ts` (Pixel 7 et iPhone 15 émulés).
 *
 * Règle mesurée : choisir un AUTRE corps ajoute une entrée, tout le reste (date, mode, même
 * corps, partage) réécrit l'entrée courante, et Retour/Suivant restaurent le corps SANS recharger
 * le document (le marqueur posé sur `window` survit) et sans ajouter d'entrée.
 */

/** Pose les drapeaux qui coupent les visites d'accueil et la langue, avant tout `goto`. */
export async function quietStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
}

export async function boot(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  // Détruit par tout rechargement du document : c'est ce qui prouve « sans recharger ».
  await page.evaluate(() => {
    (window as unknown as { __alive?: string }).__alive = 'yes';
  });
}

/** La commande unique de sélection, par la palette : un clic sur le bouton du corps (cf. planetNav). */
export async function pick(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (bodyId) => document.getElementById(`orbit-${bodyId}`)!.click(),
    id
  );
}

export const historyLength = (page: Page): Promise<number> =>
  page.evaluate(() => history.length);

export const path = (page: Page): string => new URL(page.url()).pathname;

export const alive = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as { __alive?: string }).__alive);

/** Le corps que la fiche affiche ; `null` quand elle est masquée (vue d'ensemble). */
export async function shownBody(page: Page): Promise<string | null> {
  const card = page.locator('#body-info');
  if (!(await card.isVisible())) return null;
  return (
    (await page.locator('#body-info .bi-name').textContent())?.trim() ?? null
  );
}

export async function expectBody(
  page: Page,
  pathname: string,
  name: string | null
): Promise<void> {
  await expect.poll(() => path(page), { timeout: 20_000 }).toBe(pathname);
  if (name === null) await expect(page.locator('#body-info')).toBeHidden();
  else await expect(page.locator('#body-info .bi-name')).toHaveText(name);
}

/** Un aller-retour d'historique complet : Terre, Mars, Jupiter, Retour, Retour, Suivant. */
export async function scenarioBackForward(page: Page): Promise<void> {
  await boot(page, '/earth/');
  await expectBody(page, '/earth/', 'Earth');
  const start = await historyLength(page);

  await pick(page, 'mars');
  await expectBody(page, '/mars/', 'Mars');
  await pick(page, 'jupiter');
  await expectBody(page, '/jupiter/', 'Jupiter');
  expect(await historyLength(page)).toBe(start + 2);

  await page.goBack();
  await expectBody(page, '/mars/', 'Mars');
  await page.goBack();
  await expectBody(page, '/earth/', 'Earth');
  await page.goForward();
  await expectBody(page, '/mars/', 'Mars');

  // Restaurer n'ajoute rien et ne recharge pas la scène.
  expect(await historyLength(page)).toBe(start + 2);
  expect(await alive(page)).toBe('yes');
}

/** La vue d'ensemble est une destination comme une autre. */
export async function scenarioOverview(page: Page): Promise<void> {
  await boot(page, '/earth/');
  await expectBody(page, '/earth/', 'Earth');
  await pick(page, 'overview');
  await expectBody(page, '/', null);
  await pick(page, 'mars');
  await expectBody(page, '/mars/', 'Mars');

  await page.goBack();
  await expectBody(page, '/', null);
  await page.goBack();
  await expectBody(page, '/earth/', 'Earth');
  await page.goForward();
  await expectBody(page, '/', null);
  expect(await alive(page)).toBe('yes');
}

/** Choisir le même corps plusieurs fois, ou le choisir en plein vol, ne crée pas de doublon. */
export async function scenarioRepeatAndRapid(page: Page): Promise<void> {
  await boot(page, '/earth/');
  await expectBody(page, '/earth/', 'Earth');
  const start = await historyLength(page);

  for (let i = 0; i < 3; i++) await pick(page, 'mars');
  await expectBody(page, '/mars/', 'Mars');
  expect(await historyLength(page)).toBe(start + 1);

  // Trois choix sans attendre la fin du vol : une entrée par corps, dans l'ordre.
  await pick(page, 'jupiter');
  await pick(page, 'saturn');
  await pick(page, 'neptune');
  await expectBody(page, '/neptune/', 'Neptune');
  expect(await historyLength(page)).toBe(start + 4);

  await page.goBack();
  await expectBody(page, '/saturn/', 'Saturn');
  await page.goBack();
  await expectBody(page, '/jupiter/', 'Jupiter');
  await page.goBack();
  await expectBody(page, '/mars/', 'Mars');
  await page.goBack();
  await expectBody(page, '/earth/', 'Earth');
  expect(await alive(page)).toBe('yes');
}

/** La date, le mode et le temps qui passe réécrivent l'entrée courante, sans en ajouter. */
export async function scenarioStateIsNotNavigation(page: Page): Promise<void> {
  await boot(page, '/earth/?mode=educ');
  await expectBody(page, '/earth/', 'Earth');
  await pick(page, 'mars');
  await expectBody(page, '/mars/', 'Mars');
  const start = await historyLength(page);

  // Le mode.
  await page.locator('[data-mode="explo"]').first().click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('mode'))
    .toBe('explo');
  // La date : plusieurs saisies de suite.
  for (const day of ['2030-01-15', '2031-02-16', '2032-03-17']) {
    await page.locator('#date-input').fill(day);
    await page.locator('#date-input').press('Enter');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('date') ?? '')
      .toContain(day);
  }
  // Le temps qui passe (horloge en marche) : rien n'est écrit pendant la lecture.
  await page.waitForTimeout(2500);
  expect(await historyLength(page)).toBe(start);

  // Une navigation après tout cela : une seule entrée, et Retour revient à Mars SANS remonter
  // l'horloge à la date de l'ancienne entrée.
  await pick(page, 'jupiter');
  await expectBody(page, '/jupiter/', 'Jupiter');
  expect(await historyLength(page)).toBe(start + 1);
  const dateBefore = await page.locator('#date-input').inputValue();
  await page.goBack();
  await expectBody(page, '/mars/', 'Mars');
  expect(await page.locator('#date-input').inputValue()).toBe(dateBefore);
  expect(await alive(page)).toBe('yes');
}

/** Un permalien existant s'ouvre comme avant, ne laisse pas d'entrée en plus, et se recharge. */
export async function scenarioPermalinks(page: Page): Promise<void> {
  // L'ancienne forme `?body=` est remontée à `/mars/` en REMPLAÇANT l'entrée d'arrivée.
  await boot(page, '/?mode=explo&body=mars&date=2026-11-20T18%3A00%3A00Z');
  await expectBody(page, '/mars/', 'Mars');
  const first = await historyLength(page);
  await pick(page, 'jupiter');
  await expectBody(page, '/jupiter/', 'Jupiter');
  expect(await historyLength(page)).toBe(first + 1);

  // Le rechargement rouvre le corps courant, et l'entrée précédente reste atteignable.
  await page.reload();
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expectBody(page, '/jupiter/', 'Jupiter');
  await page.goBack();
  await expectBody(page, '/mars/', 'Mars');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('explo');
}
