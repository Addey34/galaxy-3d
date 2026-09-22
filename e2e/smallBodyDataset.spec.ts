import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * DÉFAUT DE PRODUCTION CORRIGÉ, MESURÉ ICI. La couche des petits corps interrogeait
 * `ssd-api.jpl.nasa.gov` depuis le navigateur ; ce service répond HTTP 200 SANS en-tête
 * `Access-Control-Allow-Origin`, donc le navigateur jetait la réponse et la couche était vide
 * en ligne, en silence, alors qu'elle se remplissait en développement.
 *
 * Deux affirmations, toutes deux vérifiables à l'œil dans l'application : la couche PEINT, et
 * elle ne demande RIEN à JPL. La première moitié seule passerait encore si on rebranchait
 * l'API depuis une machine où elle répond ; la seconde seule passerait sur une couche morte.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('the small-body layer paints from the shipped snapshot, without asking JPL', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const jpl: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('jpl.nasa.gov')) jpl.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.locator('.mode-btn[data-mode=explo]').click();

  // Pixels réellement peints sur la couche instrument : la seule preuve qu'un champ existe.
  // Un canevas vide en rendrait zéro, ce qui était le cas en production.
  const painted = async (): Promise<number> =>
    page.evaluate(() => {
      const canvas = document.getElementById(
        'smallbody-overlay'
      ) as HTMLCanvasElement | null;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return -1;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) opaque++;
      return opaque;
    });
  await expect.poll(painted, { timeout: 30_000 }).toBeGreaterThan(200);

  expect(jpl, `requêtes JPL : ${jpl.join(' | ')}`).toEqual([]);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('the small-body panel names its source and the date of the snapshot', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.locator('#settings-trigger').click();

  // Une donnée figée qui se présenterait comme vivante serait le défaut, pas la correction :
  // le panneau porte le nombre d'objets chargés, la base et la DATE du relevé.
  const note = page.locator('#smallbody-filters .sb-source');
  await expect(note).toBeVisible();
  await expect(note).toContainText('JPL Small-Body Database');
  await expect(note).toContainText(/\d{4}/);
  const count = Number(/^(\d+)/.exec((await note.innerText()).trim())?.[1]);
  expect(count).toBeGreaterThan(1000);
});

test('past its declared age, the panel says the snapshot is old', async ({
  page,
}) => {
  // Un relevé périmé ne doit pas se lire comme un relevé du jour. L'horloge du NAVIGATEUR est
  // avancée à huit mois après le relevé commité (2026-09-20), au-delà des 180 jours déclarés
  // dans `core/snapshotAge.ts` ; les minuteries continuent de tourner.
  await page.clock.setFixedTime(new Date('2027-05-25T12:00:00Z'));
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.locator('#settings-trigger').click();

  const note = page.locator('#smallbody-filters .sb-source');
  await expect(note).toBeVisible();
  await expect(note).toContainText('This snapshot is 8 months old');
});
