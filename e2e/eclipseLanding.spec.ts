import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { eclipseForSlug } from '../src/core/eclipsePages';
import { formatPermalinkDate } from '../src/core/permalink';

/**
 * UNE PAGE D'ÉCLIPSE EST L'APPLICATION OUVERTE AU PIC — ce que `/eclipse/<jour>/` exige.
 *
 * Les pages elles-mêmes ne naissent qu'au build (`src/seo/eclipseLandingPage.test.ts`). Ce que
 * seul un navigateur peut voir, c'est l'application ouverte sur ce chemin : arrive-t-elle
 * vraiment à la date de l'éclipse, sur le bon corps, et l'adresse dit-elle encore la vérité
 * après qu'on a bougé ? Le serveur de développement sert le shell SPA pour tout chemin : seul
 * le chemin porte l'information, exactement comme en production.
 */

const openApp = async (
  page: import('@playwright/test').Page,
  path: string
): Promise<void> => {
  await page.goto(path);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await page.waitForTimeout(1500);
};

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('a solar eclipse page travels to the peak, on the Earth, and keeps its address', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const peak = eclipseForSlug('2026-08-12')!.date;

  await openApp(page, '/eclipse/2026-08-12/');
  await expect(page.locator('#body-info .bi-name')).toHaveText('Earth');
  await expect(page.locator('#date-input')).toHaveValue('2026-08-12');
  await expect(page.locator('#time-input')).toHaveValue(
    new RegExp(`^${peak.toISOString().slice(11, 16)}`)
  );
  // Au pic, et pas une minute plus tard : la lecture est figée comme depuis le panneau.
  await expect(page.locator('#play-pause-btn')).toHaveClass(/is-paused/);

  // L'adresse reste celle de l'éclipse, sans répéter date ni corps.
  const url = new URL(page.url());
  expect(url.pathname).toBe('/eclipse/2026-08-12/');
  expect(url.searchParams.get('date')).toBeNull();
  expect(url.searchParams.get('body')).toBeNull();
  await expect(page).toHaveTitle(
    'Total solar eclipse of August 12, 2026 in 3D'
  );

  // Dès qu'on regarde autre chose, l'adresse devient le permalien ordinaire — qui porte, lui,
  // la date réelle de l'éclipse : c'est le lien qu'un partage emporterait.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-jupiter').click();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Jupiter');
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
    .toBe('/jupiter/');
  expect(new URL(page.url()).searchParams.get('date')).toBe(
    formatPermalinkDate(peak)
  );
  await expect(page).toHaveTitle(/^Jupiter in 3D/);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('a lunar eclipse page opens on the Moon', async ({ page }) => {
  await openApp(page, '/eclipse/2026-08-28/');
  await expect(page.locator('#body-info .bi-name')).toHaveText('Moon');
  await expect(page.locator('#date-input')).toHaveValue('2026-08-28');
  expect(new URL(page.url()).pathname).toBe('/eclipse/2026-08-28/');
});

test('a day without eclipse is ignored, not guessed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openApp(page, '/eclipse/2026-08-13/');
  await expect(page.locator('#body-info')).toBeHidden();
  expect(errors).toEqual([]);
});
