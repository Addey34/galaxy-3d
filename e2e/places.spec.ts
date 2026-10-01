import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { MOON_SCENE_DATE } from './moonScene';
import { blockExternalNetwork } from './netBlock';

/**
 * LES FORMATIONS OBSERVÉES, DANS UN VRAI NAVIGATEUR (ligne 40.3).
 *
 * Ce que ces scénarios prouvent et qu'aucun test unitaire ne peut prouver :
 *
 *  - que RIEN n'est demandé au démarrage, ni l'index, ni un morceau, ni les noms ;
 *  - que le morceau d'une formation est SERVI, en JSON, à une adresse ABSOLUE. Ici la garde a un
 *    sens, contrairement à la fiche d'une sonde : la Lune GARDE son chemin (`/moon/…`) après le
 *    boot, donc une adresse relative résoudrait sous `/moon/assets/…` et la réécriture SPA
 *    servirait la coquille en HTTP 200. C'est le `content-type` qui tranche ;
 *  - qu'un corps nommé que le service ne couvre PAS le DIT, en nommant les corps couverts lus
 *    dans l'index, au lieu de masquer son bloc ;
 *  - et que revenir par la VUE GLOBALE réaffiche le bloc (la leçon du lot 42 : seul ce détour
 *    remet le corps courant à `null`).
 */

const ROOT = resolve(import.meta.dirname, '..');
const INDEX = JSON.parse(
  readFileSync(resolve(ROOT, 'src/config/placeObservationIndex.json'), 'utf-8')
) as {
  bodies: Record<
    string,
    { formations: number; observed: number; shards: number }
  >;
};
const MOON_NAMES = JSON.parse(
  readFileSync(resolve(ROOT, 'public/assets/gazetteer/moon.json'), 'utf-8')
) as { name: string; iauId: number }[];
const MOON_OBSERVED = new Set<string>();
for (const f of readdirSync(
  resolve(ROOT, 'public/assets/place-observations/moon')
))
  for (const id of Object.keys(
    (
      JSON.parse(
        readFileSync(
          resolve(ROOT, 'public/assets/place-observations/moon', f),
          'utf-8'
        )
      ) as { observed: Record<string, unknown> }
    ).observed
  ))
    MOON_OBSERVED.add(id);

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function boot(page: Page, path: string): Promise<void> {
  await page.goto(`/${path}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
}

const block = (page: Page) => page.locator('#body-info .bi-places');

async function ask(page: Page, name: string): Promise<void> {
  const places = block(page);
  const input = places.locator('.bi-places-input');
  // Les noms arrivent à l'ouverture du bloc : la liste doit être remplie avant de demander.
  await expect(places.locator('datalist option').first()).toBeAttached({
    timeout: 15_000,
  });
  await input.fill(name);
  await input.press('Enter');
}

test('ne demande NI l’index, NI un morceau, NI les noms au démarrage', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (
      /place-observations|placeObservationIndex|assets\/gazetteer\//.test(
        r.url()
      )
    )
      asked.push(r.url());
  });
  await boot(page, '');
  expect(asked, `demandé au démarrage : ${asked.join(', ')}`).toEqual([]);
});

test('nomme les orbiteurs d’une formation observée, et son morceau RÉSOUT', async ({
  page,
}) => {
  const answered: { url: string; status: number; type: string }[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/assets/place-observations/'))
      answered.push({
        url: r.url(),
        status: r.status(),
        type: r.headers()['content-type'] ?? '',
      });
  });
  // PAR LE CHEMIN : la Lune le garde après le boot, et c'est ce qui rend la garde d'adresse
  // falsifiable (cf. l'en-tête).
  await boot(page, `moon/?date=${MOON_SCENE_DATE}`);
  expect(new URL(page.url()).pathname).toBe('/moon/');
  const places = block(page);
  await expect(places).toBeVisible({ timeout: 15_000 });
  const cover = INDEX.bodies['moon']!;
  await expect(places.locator('.bi-places-count')).toContainText(
    new Intl.NumberFormat('en').format(cover.formations)
  );

  await places.locator('summary').click();
  const observed = MOON_NAMES.find((f) => MOON_OBSERVED.has(String(f.iauId)))!;
  await ask(page, observed.name);
  const items = places.locator('.bi-places-result li');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  expect(answered.length, 'aucun morceau servi').toBeGreaterThan(0);
  expect(answered[0]!.status).toBe(200);
  expect(answered[0]!.type).toContain('json');
  expect(new URL(answered[0]!.url).pathname).toMatch(
    /^\/assets\/place-observations\/moon\//
  );
  // La source primaire de chaque ligne : l'étiquette PDS, en https.
  const href = await items
    .first()
    .locator('a.bi-places-label')
    .getAttribute('href');
  expect(href).toMatch(/^https:\/\//);
});

test('un nom INCONNU le dit, sans rien demander d’autre', async ({ page }) => {
  await boot(page, `moon/?date=${MOON_SCENE_DATE}`);
  const places = block(page);
  await expect(places).toBeVisible({ timeout: 15_000 });
  await places.locator('summary').click();
  await ask(page, 'Nulle part du tout');
  await expect(places.locator('.bi-places-result')).toContainText(
    /No formation/
  );
  await expect(places.locator('.bi-places-result li')).toHaveCount(0);
});

test('une formation que RIEN ne touche le DIT, au lieu d’afficher une liste vide', async ({
  page,
}) => {
  /**
   * CE CAS N'EXISTE PLUS DANS LA DONNÉE RÉELLE, et c'est pourquoi il est simulé : depuis le
   * tirage complet, les 9 087 formations lunaires sont toutes observées, et le scénario qui
   * cherchait une formation non touchée se SAUTAIT en silence. Le message « aucune empreinte »
   * n'était donc plus exercé par aucun test. On intercepte le morceau pour rendre une réponse
   * vide, et c'est le RENDU qu'on vérifie, pas la donnée.
   */
  await page.route('**/assets/place-observations/moon/*.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ instruments: [], observed: {} }),
    })
  );
  await boot(page, `moon/?date=${MOON_SCENE_DATE}`);
  const places = block(page);
  await expect(places).toBeVisible({ timeout: 15_000 });
  await places.locator('summary').click();
  await ask(page, MOON_NAMES[0]!.name);
  await expect(places.locator('.bi-places-result')).toContainText(
    /No footprint/,
    { timeout: 15_000 }
  );
  await expect(places.locator('.bi-places-result li')).toHaveCount(0);
});

test('un corps NOMMÉ que le service ne couvre pas le DIT, sans rien demander', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/place-observations/')) asked.push(r.url());
  });
  expect(
    INDEX.bodies['titan'],
    'Titan est devenu couvert : choisir un autre témoin'
  ).toBe(undefined);
  await boot(page, 'titan/');
  const places = block(page);
  await expect(places).toBeVisible({ timeout: 15_000 });
  await places.locator('summary').click();
  // Les corps couverts sont LUS dans l'index : la phrase ne les recopie pas.
  await expect(places.locator('.bi-places-intro')).toContainText('Moon');
  await expect(places.locator('.bi-places-form')).toBeHidden();
  expect(
    asked,
    `demandé pour un corps non couvert : ${asked.join(', ')}`
  ).toEqual([]);
});

test('un corps SANS formation nommée n’affiche pas le bloc', async ({
  page,
}) => {
  await boot(page, 'jupiter/');
  await expect(page.locator('#body-info')).toBeVisible({ timeout: 15_000 });
  await expect(block(page)).toBeHidden();
});

test('revenir sur la Lune par la VUE GLOBALE réaffiche le bloc', async ({
  page,
}) => {
  await boot(page, `moon/?date=${MOON_SCENE_DATE}`);
  const places = block(page);
  await expect(places).toBeVisible({ timeout: 15_000 });
  // Le détour qui remet le corps courant à `null` (leçon du lot 42), puis par un corps SANS nom,
  // l'autre chemin qui laissait le bloc masqué dans ma première forme.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();
  await expect(places).toBeHidden();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-moon').click();
  await expect(places).toBeVisible({ timeout: 15_000 });
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-jupiter').click();
  await expect(places).toBeHidden();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-moon').click();
  await expect(places).toBeVisible({ timeout: 15_000 });
});
