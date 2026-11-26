import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { blockExternalNetwork } from './netBlock';

/**
 * L'OBSERVATION INTERCONNECTÉE (GAL-OBSERVATION-001) : le bloc « Poursuivre l'observation » de la fiche.
 * Parcours : Lune → visite Apollo 11 ; Pluton → New Horizons au survol → retour exact (corps, date, mode),
 * puis Retour du navigateur ; Pluton → inspection 3D de New Horizons ; Voyager 2 → Neptune à la date de la
 * rencontre ; Terre → satellites ; Soleil → voisinage solaire ; clavier, quatre langues, axe.
 */
const satellites = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
);

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.route('**/satellites/elements.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: satellites })
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function boot(page: Page, query: string, lang = 'en'): Promise<void> {
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), lang);
  await page.goto(`/?${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('.bi-observe')).toBeVisible({ timeout: 60_000 });
}

const action = (page: Page, kind: string, text?: RegExp) => {
  const all = page.locator(`.bi-observe-action[data-kind="${kind}"]`);
  return text ? all.filter({ hasText: text }) : all.first();
};

const param = (page: Page, key: string): string | null =>
  new URL(page.url()).searchParams.get(key);

/** Le corps de l'adresse : le chemin le porte (`/pluto/`), `?body=` seulement à défaut. */
const bodyOf = (page: Page): string | null => {
  const url = new URL(page.url());
  return (
    url.pathname.split('/').filter(Boolean).pop() ??
    url.searchParams.get('body')
  );
};

test('Lune : la visite Apollo 11 se lance depuis la fiche', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await boot(page, 'body=moon');
  const tour = action(page, 'tour', /Tranquillitatis/);
  await expect(tour).toBeVisible();
  await tour.focus();
  await tour.press('Enter');
  await expect(page.locator('.stour-card')).toBeVisible({ timeout: 60_000 });
});

test('Pluton → New Horizons au survol, puis retour exact au corps, à la date et au mode', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page, 'body=pluto&date=2026-01-01T00:00:00Z&mode=educ');
  const startDate = param(page, 'date');
  const probe = action(page, 'probe', /New Horizons/);
  await expect(probe).toBeVisible({ timeout: 30_000 });
  await probe.click();
  await expect
    .poll(() => bodyOf(page), { timeout: 30_000 })
    .toBe('new-horizons');
  await expect.poll(() => param(page, 'date')?.slice(0, 10)).toBe('2015-07-14');
  expect(param(page, 'mode')).toBe('explo');

  const back = page.locator('#observe-back');
  await expect(back).toBeVisible({ timeout: 30_000 });
  await expect(back).toContainText('Pluto');
  await back.click();
  await expect.poll(() => bodyOf(page), { timeout: 30_000 }).toBe('pluto');
  await expect
    .poll(() => param(page, 'date')?.slice(0, 10))
    .toBe(startDate?.slice(0, 10));
  await expect.poll(() => param(page, 'mode')).not.toBe('explo');
  await expect(back).toBeHidden();

  // Le Retour du navigateur ramène aussi d'une sonde choisie depuis la fiche.
  await action(page, 'probe', /New Horizons/).click();
  await expect
    .poll(() => bodyOf(page), { timeout: 30_000 })
    .toBe('new-horizons');
  await page.goBack();
  await expect.poll(() => bodyOf(page), { timeout: 30_000 }).toBe('pluto');
});

test('Pluton → inspection 3D de New Horizons, par la commande existante', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page, 'body=pluto');
  const inspect = action(page, 'inspect', /New Horizons/);
  await expect(inspect).toBeVisible({ timeout: 30_000 });
  await inspect.click();
  const view = page.locator('#craft-view');
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute('data-craft-model', 'new-horizons');
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden({ timeout: 30_000 });
  // Le focus revient dans la fiche, et la fiche est toujours celle de Pluton.
  expect(bodyOf(page)).toBe('pluto');
});

test('Voyager 2 → Neptune à la date de la rencontre, retour immédiat puis exact (corps, date, mode)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await boot(page, 'body=voyager2&date=1990-01-01T00:00:00Z&mode=educ');
  const startDate = param(page, 'date');
  const neptune = action(page, 'body', /Neptune/);
  await expect(neptune).toBeVisible({ timeout: 30_000 });
  await neptune.click();
  // Seul le temps a changé (la sonde reste choisie) : le retour s'offre quand même, tout de suite.
  const back = page.locator('#observe-back');
  await expect(back).toBeVisible({ timeout: 1_000 });
  await expect(back).toContainText('Voyager 2');
  await expect
    .poll(() => param(page, 'date')?.slice(0, 10), { timeout: 30_000 })
    .toBe('1989-08-25');
  expect(bodyOf(page)).toBe('voyager2');
  expect(param(page, 'mode')).toBe('explo');

  await back.click();
  await expect
    .poll(() => param(page, 'date')?.slice(0, 10), { timeout: 30_000 })
    .toBe(startDate?.slice(0, 10));
  expect(bodyOf(page)).toBe('voyager2');
  await expect.poll(() => param(page, 'mode')).not.toBe('explo');
  await expect(back).toBeHidden();
});

const setSceneDate = (page: Page, day: string) =>
  page.locator('#date-input').evaluate((el, d) => {
    (el as HTMLInputElement).value = d;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, day);

test('Lune : le prochain événement suit la date de la scène sans quitter la fiche, et le saut fige la lecture', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await boot(page, 'body=moon&date=2026-01-01T00:00:00Z');
  const event = page.locator('.bi-observe-action[data-kind="event"]');
  const at = async () => (await event.getAttribute('data-at')) ?? '';
  await expect(event).toBeVisible({ timeout: 30_000 });
  expect((await at()) >= '2026-01-01').toBe(true);
  expect((await at()) < '2026-01-09').toBe(true);

  // En avant puis en arrière : un quartier de Lune tombe moins de 8 jours plus tard.
  await setSceneDate(page, '2026-06-15');
  await expect
    .poll(at, { timeout: 10_000 })
    .toMatch(/^2026-06-(1[5-9]|2[0-3])/);
  await setSceneDate(page, '2026-03-01');
  await expect.poll(at, { timeout: 10_000 }).toMatch(/^2026-03-0[1-9]/);
  const cost = Number(
    await page.locator('.bi-observe').getAttribute('data-event-cost-ms')
  );
  test
    .info()
    .annotations.push({ type: 'eventCostMs', description: String(cost) });
  console.log(`[observation] calcul des événements : ${cost} ms`);

  // Le saut : lecture figée (garantie du panneau des événements), date exacte, retour offert, puis le
  // PROCHAIN événement (l'actuel est atteint, donc recalculé).
  const target = await at();
  await event.click();
  await expect(page.locator('#play-pause-btn')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect
    .poll(() => param(page, 'date')?.slice(0, 16), { timeout: 30_000 })
    .toBe(target.slice(0, 16));
  await expect(page.locator('#observe-back')).toBeVisible();
  await expect.poll(at, { timeout: 10_000 }).not.toBe(target);
  expect((await at()) > target).toBe(true);
  expect(bodyOf(page)).toBe('moon');
});

test('Terre → satellites en orbite ; Soleil → voisinage solaire', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await boot(page, 'body=earth');
  await action(page, 'satellites').click();
  await expect(page.locator('#satellites-toggle')).toBeChecked();

  await page.goto('/?body=sun');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  const leave = action(page, 'neighbourhood');
  await expect(leave).toBeVisible({ timeout: 60_000 });
  await leave.click();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 40_000 });
});

for (const [lang, label] of [
  ['fr', 'Poursuivre l’observation'],
  ['es', 'Seguir observando'],
  ['pt-BR', 'Continuar observando'],
] as const)
  test(`quatre langues : ${lang}`, async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page, 'body=mars', lang);
    await expect(page.locator('.bi-observe > summary')).toHaveText(label);
    await expect(action(page, 'probe')).toBeVisible({ timeout: 30_000 });
  });

test('axe sur le bloc, et aucun débordement à 390 px', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), 'en');
  await page.goto('/?body=mars');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  // Sur téléphone la fiche s'ouvre repliée : on la déplie comme on le ferait au doigt.
  const toggle = page.locator('#body-info .bi-toggle');
  if (await page.locator('#body-info.is-compact').count()) await toggle.click();
  await expect(page.locator('.bi-observe')).toBeVisible({ timeout: 60_000 });
  await expect(action(page, 'probe')).toBeVisible({ timeout: 30_000 });
  const results = await new AxeBuilder({ page })
    .include('.bi-observe')
    .analyze();
  expect(results.violations).toEqual([]);
  await page.addStyleTag({ content: '* { letter-spacing: 1px !important; }' });
  const over = await page.evaluate(() =>
    [...document.querySelectorAll('.bi-observe *')]
      .filter((el) => !el.classList.contains('sr-only'))
      .filter((el) => el.scrollWidth - el.clientWidth > 1)
      .map((el) => el.className)
  );
  expect(over).toEqual([]);
});
