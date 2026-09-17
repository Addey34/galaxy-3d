import { expect, test } from '@playwright/test';

/**
 * MODÈLE TEMPOREL À L'ÉCRAN : ce que la fiche dit de la position du corps selon la date de la
 * scène. La même sélection change de source en changeant de date, sans que rien ne bouge dans
 * l'image : Encelade vient de son binaire Horizons jusqu'en 2101, de ses éléments képlériens
 * ensuite, et plus aucune mesure ne couvre 2300.
 *
 * Il n'y a AUCUN indicateur global de précision : chaque donnée porte la sienne (règle du lot 6).
 */
test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**gibs.earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**open-meteo.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const openAt = async (
  page: import('@playwright/test').Page,
  body: string,
  date: string
): Promise<void> => {
  await page.goto(`/?body=${body}&date=${encodeURIComponent(date)}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
};

test('the info card names the source that places the body at this date', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const source = page.locator('.bi-position-source');
  const error = page.locator('.bi-position-error');

  // 2026 : le binaire Horizons couvre, et son écart mesuré est affiché en kilomètres.
  await openAt(page, 'enceladus', '2026-06-01T00:00:00Z');
  await expect(source).toContainText('JPL Horizons', { timeout: 30_000 });
  await expect(error).toContainText('Mean measured gap');

  // 2300 : plus aucun binaire, plus aucune mesure — extrapolé, et l'écart est dit non mesuré.
  await openAt(page, 'enceladus', '2300-01-01T00:00:00Z');
  await expect(source).toContainText('Keplerian', { timeout: 30_000 });
  await expect(source).toContainText('extrapolated');
  await expect(error).toContainText('not measured');
});

test('the Sun has no position row, and the overview closes the card', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openAt(page, 'sun', '2026-06-01T00:00:00Z');
  // Le Soleil est l'origine du repère : sa position n'est pas une donnée à dater.
  await page.waitForTimeout(1500);
  await expect(page.locator('.bi-position')).toBeHidden();
});

test('the weather badge says when the tile is older than the scene', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Une vraie image locale sert de tuile GIBS : le badge n'existe qu'avec une tuile appliquée.
  await page.unroute('**gibs.earthdata.nasa.gov/**');
  await page.route('**gibs.earthdata.nasa.gov/wms/**', (route) =>
    route.fulfill({ path: 'public/assets/textures/earth/earth_clouds_1k.jpg' })
  );
  await openAt(page, 'earth', '2030-01-01T00:00:00Z');
  await page.locator('#weather-trigger').click();
  const badge = page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Clouds (NASA)' })
    .locator('.wl-source');
  // L'imagerie satellite n'existe pas en 2030 : la dernière image réelle est servie, observée,
  // et l'écart à la scène est ÉCRIT (le défaut corrigé : « observé » sans rien dire de plus).
  await expect(badge).toContainText('observed', { timeout: 30_000 });
  await expect(badge).toContainText('scene on 2030-01-01');
});
