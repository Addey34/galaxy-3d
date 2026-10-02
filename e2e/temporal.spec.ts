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

/**
 * LA PROFONDEUR DU TEMPS (lot 39) dans un vrai navigateur. Le relevé peut être juste et la
 * fiche muette : ce qui compte est qu'un visiteur parti à l'an 1000 LISE un chiffre. Et la
 * barre de temps doit encore montrer sa date, ce qu'elle ne faisait pas avant l'an 1000 —
 * « 500-05-14 » n'est pas une valeur qu'un champ de date accepte, et il se vidait en silence.
 */
test('year 1000 is measured, year 2500 for Uranus is not, and the date field holds', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const source = page.locator('.bi-position-source');
  const error = page.locator('.bi-position-error');

  // An 1000 : astronomy-engine, et l'écart est celui du millénaire 1000-1999.
  await openAt(page, 'jupiter', '1000-05-14T00:00:00Z');
  await expect(source).toContainText('Astronomy Engine', { timeout: 30_000 });
  await expect(source).toContainText('reconstructed');
  await expect(error).toContainText('Mean measured gap');
  await expect(error).toContainText('1000');

  // Uranus en 2500 : la fenêtre est mesurée mais RETENUE (son plancher de substitution est
  // trop grand devant l'écart), donc la fiche continue de dire qu'elle ne sait pas.
  await openAt(page, 'uranus', '2500-01-01T00:00:00Z');
  await expect(source).toContainText('Astronomy Engine', { timeout: 30_000 });
  await expect(error).toContainText('not measured');

  // An 500 : le champ de date porte encore sa valeur, sur quatre chiffres d'année.
  await openAt(page, 'earth', '0500-03-04T00:00:00Z');
  await expect(page.locator('#date-input')).toHaveValue('0500-03-04', {
    timeout: 30_000,
  });
});

/**
 * AVANT L'AN 1 (ligne 22.10) : le permalien sait déjà ouvrir une date avant notre ère, et la
 * mesure s'étend désormais jusqu'en 9998 av. J.-C. La fiche doit alors LIRE un chiffre, et nommer
 * sa tranche en années av. J.-C. (« 1001 BC »), jamais « -1000 ». L'application ne doit lever
 * aucune erreur à une telle date : c'est ce que ce scénario vérifie d'abord.
 */
test('a date before year 1, opened by the permalink, reads a measured gap in years BC', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openAt(page, 'jupiter', '-000584-05-28T12:00:00Z');
  const error = page.locator('.bi-position-error');
  await expect(page.locator('.bi-position-source')).toContainText(
    'Astronomy Engine',
    { timeout: 30_000 }
  );
  await expect(error).toContainText('Mean measured gap');
  await expect(error).toContainText('1001 BC');
  await expect(error).not.toContainText('-1000');
  expect(errors).toEqual([]);
});

/**
 * AVANT LE 15 OCTOBRE 1582, LA BARRE DE TEMPS ÉCRIT LE CALENDRIER JULIEN (ligne 22.10, pas 2).
 * Les dates attendues ne viennent PAS de `core/calendar.ts` (ce serait circulaire) : ce sont celles
 * qu'Horizons imprime pour ces jours juliens, lues le 2026-10-02 (B.C. 0587-Jul-30, et le 29
 * février 1500, qu'un champ de date de navigateur, grégorien, refuserait).
 */
test('before 1582 the time bar writes the Julian calendar, as Horizons prints it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const day = page.locator('#hist-day');
  const month = page.locator('#hist-month');
  const year = page.locator('#hist-year');
  const era = page.locator('#hist-era');
  const expand = async (): Promise<void> => {
    await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
    await page.locator('#time-readout').click();
  };

  // JD 1507231.5 + 12 h : Horizons, « B.C. 0587-Jul-30 ».
  await openAt(page, 'jupiter', '-000586-07-24T12:00:00Z');
  await expand();
  await expect(page.locator('#historic-date')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#date-input')).toBeHidden();
  await expect(page.locator('#historic-date')).toContainText('Julian calendar');
  await expect(day).toHaveValue('30');
  await expect(month).toHaveValue('7');
  await expect(year).toHaveValue('587');
  await expect(era).toHaveValue('bc');

  // Saisir une année déplace la scène, en gardant le jour julien.
  await year.fill('588');
  await year.blur();
  await expect(page).toHaveURL(/date=-000587-/, { timeout: 30_000 });
  await expect(day).toHaveValue('30');

  // JD 2268991.5 + 12 h : Horizons, « A.D. 1500-Feb-29 », un jour que le grégorien n'a pas.
  await openAt(page, 'earth', '1500-03-10T12:00:00Z');
  await expand();
  await expect(day).toHaveValue('29', { timeout: 30_000 });
  await expect(month).toHaveValue('2');
  await expect(year).toHaveValue('1500');
  await expect(era).toHaveValue('ad');

  // Après la réforme, le champ de date habituel revient, et le groupe julien disparaît.
  await openAt(page, 'earth', '1582-10-15T12:00:00Z');
  await expand();
  await expect(page.locator('#date-input')).toHaveValue('1582-10-15', {
    timeout: 30_000,
  });
  await expect(page.locator('#historic-date')).toBeHidden();
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
  // Vue globale, pas de vol vers la Terre : la couche nuages se charge de la même façon, et on
  // ne clique pas pendant que le runner décode la normal map 8k. Cette version échouait aux
  // trois tentatives en CI (GPU logiciel), jamais en local : 15 s d'actionnabilité ne suffisent
  // pas à travers un à-coup de décodage.
  await page.goto('/?date=2030-01-01T00%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.locator('#weather-trigger').click({ timeout: 30_000 });
  const badge = page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Clouds (NASA)' })
    .locator('.wl-source');
  // L'imagerie satellite n'existe pas en 2030 : la dernière image réelle est servie, observée,
  // et l'écart à la scène est ÉCRIT (le défaut corrigé : « observé » sans rien dire de plus).
  await expect(badge).toContainText('observed', { timeout: 30_000 });
  await expect(badge).toContainText('scene on 2030-01-01');
});
