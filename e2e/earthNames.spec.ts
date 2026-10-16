import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LES NOMS DE LA TERRE, DANS UN VRAI NAVIGATEUR (lot 53, pas 1).
 *
 * L'UAI ne nomme pas la Terre ; ses noms viennent de Natural Earth, par la couche des noms de
 * surface. Ce que ce fichier prouve : le fichier n'est demandé qu'à l'APPROCHE de la Terre, la
 * couche en écrit, et dans la LANGUE de l'interface (un nom d'océan en français porte
 * « océan », que l'anglais n'écrit jamais).
 */
const EARTH_NAMES = '/assets/earth-names/earth.json';
// Une date fixée : la vue de la Terre change avec la date courante (§ « Pièges », ligne 44.2).
const SCENE_DATE = '2026-06-21T12:00:00Z';

async function boot(page: Page, query: string, locale = 'en'): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript((value) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', value);
  }, locale);
  await page.goto(`/${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
}

test('ne demande pas les noms de la Terre au démarrage', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(EARTH_NAMES)) asked.push(r.url());
  });
  await boot(page, '');
  expect(asked).toEqual([]);
});

test('écrit les noms de la Terre à l’approche, dans la langue de l’interface', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(EARTH_NAMES)) asked.push(r.url());
  });
  await boot(page, `?body=earth&date=${SCENE_DATE}`, 'fr');
  const overlay = page.locator('#gazetteer-overlay');
  await expect(overlay).toHaveClass(/is-visible/);
  // Les noms se lisent quand le fichier est arrivé : on attend la couche, pas une durée.
  await expect
    .poll(
      async () => Number((await overlay.getAttribute('data-names')) ?? '0'),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  expect(asked.length).toBeGreaterThan(0);
  const drawn = (await overlay.getAttribute('data-drawn')) ?? '';
  // LE TÉMOIN DE LANGUE : de la distance de visite, les océans sont au-dessus de leur zoom
  // minimal ; en français leur nom porte « océan », en anglais « Ocean ».
  expect(drawn).toMatch(/océan /);
  expect(drawn).not.toMatch(/ Ocean\b/);
});

test('un nom caché par un autre corps n’est pas écrit', async ({ page }) => {
  // Au 2026-08-10 à midi, la visite de la Terre place la Lune devant l'Amérique du Sud (capture
  // lue le 2026-10-16) : « Rio de Janeiro » s'écrivait par-dessus la Lune.
  await boot(page, '?body=earth&date=2026-08-10T12:00:00Z', 'fr');
  const overlay = page.locator('#gazetteer-overlay');
  await expect
    .poll(
      async () => Number((await overlay.getAttribute('data-names')) ?? '0'),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  const drawn = ((await overlay.getAttribute('data-drawn')) ?? '').split('|');
  // LE TÉMOIN : un nom de la face visible, hors de la Lune, est bien écrit.
  expect(drawn).toContain('New York');
  expect(drawn).not.toContain('Rio de Janeiro');
});
