import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * « Poursuivre l'observation » au toucher (GAL-OBSERVATION-001), sur Pixel 7 (Chromium Android) et iPhone 15
 * (WebKit) émulés : la fiche repliée se déplie, une sonde se choisit au doigt à la date de sa preuve, le retour
 * rend le corps et la date, rien ne déborde. Le prochain événement de la Lune y est aussi calculé, et son coût
 * imprimé. Hors CI : `pnpm test:mobile` (docs/TESTING.md). Ce que cela NE prouve PAS : un vrai téléphone.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

const bodyOf = (page: Page): string | null =>
  new URL(page.url()).pathname.split('/').filter(Boolean).pop() ?? null;
const dateOf = (page: Page): string =>
  (new URL(page.url()).searchParams.get('date') ?? '').slice(0, 10);

async function openCard(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
  if (!(await page.locator('#body-info').isVisible()))
    await page.locator('#info-trigger').tap();
  // Sur téléphone la fiche s'ouvre réduite : on la déplie au doigt.
  if (await page.locator('#body-info.is-compact').count())
    await page.locator('#body-info .bi-toggle').tap();
  await expect(page.locator('.bi-observe')).toBeVisible({ timeout: 60_000 });
}

test('Pluton → New Horizons au doigt, retour au corps et à la date, aucun débordement', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openCard(page, 'body=pluto&date=2026-01-01T00:00:00Z');
  const probe = page
    .locator('.bi-observe-action[data-kind="probe"]')
    .filter({ hasText: /New Horizons/ });
  await probe.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await probe.boundingBox();
  // Une cible tactile d'au moins 40 px de haut.
  expect(box!.height).toBeGreaterThanOrEqual(40);
  await probe.tap();
  await expect
    .poll(() => bodyOf(page), { timeout: 30_000 })
    .toBe('new-horizons');
  expect(dateOf(page)).toBe('2015-07-14');

  if (await page.locator('#body-info.is-compact').count())
    await page.locator('#body-info .bi-toggle').tap();
  const back = page.locator('#observe-back');
  await back.scrollIntoViewIfNeeded();
  await back.tap();
  await expect.poll(() => bodyOf(page), { timeout: 30_000 }).toBe('pluto');
  expect(dateOf(page)).toBe('2026-01-01');
});

test('Lune : le prochain événement, et son coût sur ce profil', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openCard(page, 'body=moon&date=2026-01-01T00:00:00Z');
  const event = page.locator('.bi-observe-action[data-kind="event"]');
  await expect(event).toBeVisible({ timeout: 30_000 });
  const cost = await page
    .locator('.bi-observe')
    .getAttribute('data-event-cost-ms');
  console.log(
    `[observation] ${test.info().project.name} : calcul des événements ${cost} ms`
  );
  expect(Number(cost)).toBeGreaterThan(0);
});
