import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { clickWhenCalm } from './mainThread';
import { openSettingsTab } from './settingsTab';

/**
 * LE SUIVI D'UN SATELLITE (GAL-SATELLITE-TRACKING-001) : depuis la fiche, la caméra suit l'objet (il reste au
 * centre de l'écran quand la date change), la trace de son orbite est dessinée (une période en avant, calculée
 * par SGP4), et le suivi s'arrête proprement : sur demande, sur choix d'un autre corps, hors de la validité des
 * éléments. Le fichier servi est la lecture RÉELLE de CelesTrak du 2026-11-03, à la date de son époque.
 */
const FIXTURE_TEXT = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
);
const INSIDE = '2026-11-02T19:00:00Z';
const ISS = 25544;

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.route('**/satellites/elements.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_TEXT,
    })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto(`/?mode=explo&body=earth&date=${INSIDE}&debug-satellites`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#satellites-toggle')).toBeEnabled({
    timeout: 40_000,
  });
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#satellites-toggle').check();
  await expect
    .poll(
      async () =>
        Number(
          await page.locator('#satellite-overlay').getAttribute('data-markers')
        ),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);
  await page.locator('#satellite-search').fill('ISS');
  await page.locator('#satellite-search').press('Enter');
  await expect(page.locator('#satellite-card')).toBeVisible();
}

/** Le repère de l'ISS à la dernière image : [x, y] en pixels fenêtre, ou `null` quand il n'est pas peint. */
async function issPoint(page: Page): Promise<[number, number] | null> {
  const raw =
    (await page.locator('#satellite-overlay').getAttribute('data-points')) ??
    '[]';
  const found = (JSON.parse(raw) as [number, number, number][]).find(
    ([id]) => id === ISS
  );
  return found ? [found[1], found[2]] : null;
}

async function arrived(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.locator('canvas').first().getAttribute('data-scene-moving'),
      { timeout: 60_000, intervals: [100] }
    )
    .not.toBe('1');
}

async function setDate(page: Page, day: string): Promise<void> {
  const readout = page.locator('#time-readout');
  // `#date-input` est dans le DOM même refermé : c'est l'état du bouton qui dit si le panneau est ouvert.
  if ((await readout.getAttribute('aria-expanded')) !== 'true')
    await clickWhenCalm(page, readout);
  const date = page.locator('#date-input');
  await expect(date).toBeVisible({ timeout: 30_000 });
  await date.fill(day);
  await date.blur();
  await expect(date).toHaveValue(day);
}

test('suivi : la trace de l’orbite est dessinée, la caméra garde l’ISS au centre quand la date change, l’arrêt revient sur la Terre', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await boot(page);
  const canvas = page.locator('#satellite-overlay');
  const card = page.locator('#satellite-card');

  // La trace : une période en avant, calculée, dite sur la fiche ; aucun passé.
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-path')), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await expect(card).toContainText('computed by SGP4');
  await expect(card).toContainText('no past path is drawn');

  // Suivre : le bouton bascule, le bandeau d'arrêt apparaît, la caméra vient.
  const follow = page.locator('#satellite-card-follow');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#satellite-follow-chip')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-following', String(ISS));
  await arrived(page);

  // L'objet suivi est au centre de l'écran, et le reste quand la date change dans la validité.
  const size = page.viewportSize()!;
  const centered = async (): Promise<number> => {
    const point = await issPoint(page);
    if (!point) return Number.POSITIVE_INFINITY;
    return Math.hypot(point[0] - size.width / 2, point[1] - size.height / 2);
  };
  await expect.poll(centered, { timeout: 20_000 }).toBeLessThan(40);
  await setDate(page, '2026-11-05');
  await expect(canvas).toHaveAttribute('data-following', String(ISS));
  await expect.poll(centered, { timeout: 20_000 }).toBeLessThan(40);
  await page.locator('#satellite-card .surface-close').click(); // ferme la fiche : le suivi continue
  await expect(card).toBeHidden();
  await expect(canvas).toHaveAttribute('data-following', String(ISS));
  await expect(page.locator('#satellite-follow-stop')).toBeVisible();
  // La carte fermée, l'objet suivi garde sa trace.
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-path')), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  // Aucune violation d'accessibilité sur le bandeau.
  const axe = await new AxeBuilder({ page })
    .include('#satellite-follow-chip')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Arrêt volontaire : au clavier, le bandeau disparaît, la caméra revient sur la Terre (l'ISS n'est plus au centre).
  await page.locator('#satellite-follow-stop').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#satellite-follow-chip')).toBeHidden();
  await expect(canvas).toHaveAttribute('data-following', '');
  await arrived(page);
  await expect.poll(centered, { timeout: 20_000 }).toBeGreaterThan(40);
});

test('suivi : sortir de la validité des éléments arrête le suivi sans garder de position périmée ; choisir un autre corps l’arrête aussi', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await boot(page);
  const canvas = page.locator('#satellite-overlay');

  // Le suivi d'UN objet dont les éléments s'arrêtent avant ceux des autres : à minuit du 9 novembre, les éléments
  // de SPACEMOBILE-003 (époque du 1er) ne valent plus, ceux de l'ISS et de presque tous les autres valent encore.
  // La couche reste dessinée, mais ce suivi-là s'arrête et le dit : aucune position périmée n'est gardée.
  await page.locator('#satellite-card .surface-close').click();
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#satellite-search').fill('SPACEMOBILE-003');
  await page.locator('#satellite-search').press('Enter');
  await expect(page.locator('#satellite-card-name')).toHaveText(
    'SPACEMOBILE-003'
  );
  await page.locator('#satellite-card-follow').click();
  await expect(canvas).toHaveAttribute('data-following', '61045');
  await arrived(page);
  await setDate(page, '2026-11-09');
  await expect(canvas).toHaveAttribute('data-following', '', {
    timeout: 20_000,
  });
  await expect(page.locator('#satellite-follow-chip')).toBeHidden();
  await expect(page.locator('#satellite-card-follow')).toBeDisabled();
  await expect(page.locator('#satellite-card .sat-status')).toContainText(
    'out of validity'
  );
  expect(Number(await canvas.getAttribute('data-markers'))).toBeGreaterThan(50);

  // Tout le fichier hors validité, l'ISS suivie : le suivi s'arrête aussi.
  await setDate(page, '2026-11-02');
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#satellite-search').fill('ISS');
  await page.locator('#satellite-search').press('Enter');
  await expect(page.locator('#satellite-card-name')).toHaveText('ISS (ZARYA)');
  await page.locator('#satellite-card-follow').click();
  await expect(canvas).toHaveAttribute('data-following', String(ISS));
  await arrived(page);
  await setDate(page, '2026-12-20');
  await expect(canvas).toHaveAttribute('data-following', '', {
    timeout: 20_000,
  });
  await expect(page.locator('#satellite-follow-chip')).toBeHidden();

  // Retour dans la fenêtre : on peut suivre de nouveau, puis choisir un autre corps par la palette l'arrête.
  await setDate(page, '2026-11-02');
  await expect(page.locator('#satellite-card-follow')).toBeEnabled({
    timeout: 20_000,
  });
  await page.locator('#satellite-card-follow').click();
  await expect(canvas).toHaveAttribute('data-following', String(ISS));
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-moon').click();
  await expect(canvas).toHaveAttribute('data-following', '', {
    timeout: 20_000,
  });
});
