import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { MOON_SCENE_DATE } from './moonScene';
import { blockExternalNetwork } from './netBlock';

/**
 * LA RECHERCHE UNIVERSELLE TYPÉE (lot 47), dans un vrai navigateur. Ce qu'aucun test unitaire ne
 * prouve : que l'index n'est demandé qu'à la première frappe utile, et qu'un résultat AGIT, la
 * caméra face à la formation choisie, la scène à la date du survol.
 *
 * La scène démarre à la date fixée des scénarios lunaires (`e2e/moonScene.ts`) : « Tycho »
 * amène la Lune, et la Lune démarrée à la date courante change de coût d'une journée à l'autre.
 */
const INDEX = '/assets/search/index.json';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

async function openPalette(page: Page): Promise<string[]> {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(INDEX)) asked.push(r.url());
  });
  await page.goto(`/?date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#palette-input')).toBeFocused();
  return asked;
}

test('a formation: the index loads on the second letter, the camera faces it', async ({
  page,
}) => {
  const asked = await openPalette(page);
  const input = page.locator('#palette-input');
  await input.pressSequentially('T');
  expect(asked, 'une lettre ne demande rien').toEqual([]);
  await input.pressSequentially('ycho');
  const hit = page.locator('.palette-hit[data-kind="place"]').first();
  await expect(hit).toContainText('Tycho');
  await expect(hit).toContainText('Moon');
  expect(asked).toHaveLength(1);

  await hit.click();
  await expect(page).toHaveURL(/\/moon\//, { timeout: 30_000 });
  // Publié par l'action une fois le vol fini : nom|distance au centre de l'image|face.
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Tycho\|/, {
    timeout: 60_000,
  });
  const [, offset, side] = (
    (await canvas.getAttribute('data-search-focus')) ?? ''
  ).split('|');
  expect(side).toBe('front');
  expect(Number(offset)).toBeLessThan(0.05);
});

test('a flyby: the scene jumps to closest approach, in Explo, on the probe', async ({
  page,
}) => {
  await openPalette(page);
  await page.locator('#palette-input').pressSequentially('voyager neptune');
  const hit = page.locator('.palette-hit[data-kind="flyby"]').first();
  await expect(hit).toContainText('1989-08-25');
  // Au clavier, comme un visiteur : les flèches traversent corps et résultats typés.
  const items = page.locator('#palette-results .palette-item:visible');
  const index = await items.evaluateAll((els) =>
    els.findIndex((el) => el.classList.contains('palette-hit'))
  );
  await page.keyboard.press('ArrowDown', { delay: 0 });
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
  await expect(hit).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/voyager2\//, { timeout: 30_000 });
  await expect(page).toHaveURL(/mode=explo/);
  await expect(page).toHaveURL(/date=1989-08-25T03%3A5|date=1989-08-25T03:5/);
});

test('a mission whose probe is gone at this date opens its page', async ({
  page,
}) => {
  await openPalette(page);
  await page.locator('#palette-input').pressSequentially('cassini huygens');
  const hit = page.locator('.palette-hit[data-kind="mission"]').first();
  await expect(hit).toContainText('Cassini-Huygens');
  await hit.click();
  // Cassini n'existe plus en 2026 et la mission a plusieurs cibles : sa page les donne toutes.
  await expect(page).toHaveURL(/\/missions\/cassini-huygens\/$/, {
    timeout: 30_000,
  });
});

test('a data layer: Earth, the weather panel open, the layer checked', async ({
  page,
}) => {
  await openPalette(page);
  await page.locator('#palette-input').pressSequentially('wind');
  const hit = page.locator('.palette-hit[data-kind="dataset"]').first();
  await expect(hit).toContainText('Wind (model)');
  await expect(hit).toContainText('Earth');
  await hit.click();
  await expect(page).toHaveURL(/\/earth\//, { timeout: 30_000 });
  await expect(page.locator('#weather-layers')).toBeVisible();
  // La case cochée est celle du panneau : le même chemin qu'un clic.
  await expect(
    page
      .locator('#weather-layers .wl-item')
      .filter({ hasText: 'Wind (model)' })
      .locator('input')
  ).toBeChecked();
});

/**
 * LE COMPTE ANNONCÉ N'ATTEND PAS UN INDEX LENT, ET NE DISPARAÎT PAS SANS LUI. Payé en CI le
 * 2026-10-12 : la garde NVDA (« la recherche annonce combien de corps correspondent ») n'est
 * passée qu'au réessai, parce que l'annonce attendait le morceau et l'index de la recherche.
 * Ici la lenteur est PROVOQUÉE, pas espérée d'un coureur lent.
 */
for (const mode of ['slow index', 'search code unavailable'] as const) {
  test(`the result count is announced even with a ${mode}`, async ({
    page,
  }) => {
    if (mode === 'slow index')
      await page.route(`**${INDEX}`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        return route.continue();
      });
    // Le MORCEAU introuvable (hors ligne, déploiement en cours) : l'index refusé, lui, laissait
    // le morceau annoncer, et ne discriminait rien (falsifié contre l'ancien code).
    else await page.route('**/*paletteSearch*', (route) => route.abort());
    await openPalette(page);
    const live = page.locator('body > p[role="status"][aria-live="polite"]');
    const typedAt = Date.now();
    await page.locator('#palette-input').fill('mars');
    await expect(live).toContainText(/match/i, { timeout: 2_500 });
    expect(Date.now() - typedAt).toBeLessThan(2_500);
  });
}
