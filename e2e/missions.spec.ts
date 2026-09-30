import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LES MISSIONS DU PDS, DANS UN VRAI NAVIGATEUR.
 *
 * Ce que ce scénario prouve et qu'aucun test unitaire ne peut prouver :
 *
 *  - que l'adresse de l'actif RÉSOUT. Le corps est porté par le CHEMIN de l'URL (`/titan`), donc
 *    une adresse relative deviendrait `/titan/assets/missions/titan.json` et rendrait 404. Le lot
 *    37 l'a payé exactement là, et la couche restait vide sans un mot ;
 *  - que RIEN n'est demandé au démarrage : ni l'index, ni aucune liste ;
 *  - et que la DATE DE LA SCÈNE change la réponse, qui est la raison d'être de ce bloc. Avec
 *    Cassini (1997-2017) dans la liste de Titan, une scène en 1980 ne doit compter aucune mission
 *    commencée, et une scène en 2005 doit en compter.
 */

const INDEX = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../src/config/missionIndex.json'),
    'utf-8'
  )
) as { bodies: Record<string, { count: number }> };

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
}

const block = (page: Page) => page.locator('#body-info .bi-missions');

test('ne demande NI l’index NI aucune liste au démarrage', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/assets\/missions\/|missionIndex/.test(r.url())) asked.push(r.url());
  });
  await boot(page, '');
  expect(asked, `demandé au démarrage : ${asked.join(', ')}`).toEqual([]);
});

test('remplit le bloc à l’ouverture d’une fiche, et son adresse RÉSOUT', async ({
  page,
}) => {
  // Les réponses, et non les seules requêtes : un 404 servi par la réécriture SPA aurait un code
  // 200 et un corps HTML, donc on vérifie que la couche a bien obtenu sa LISTE.
  const answered: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/assets/missions/titan.json'))
      answered.push(r.status());
  });
  /**
   * LE BOOT PAR LE CHEMIN, ET C'EST CE QUI REND CE SCÉNARIO FALSIFIABLE. Il bootait sur
   * `?body=titan` jusqu'au lot 42, donc à la racine : une adresse RELATIVE y résout au même
   * endroit qu'une absolue, et la garde restait VERTE avec le défaut qu'elle prétendait tenir.
   * Mesuré le 2026-09-30 : un CORPS garde son chemin après le boot (`/titan/?mode=educ…`), donc
   * `assets/missions/titan.json` y deviendrait `/titan/assets/missions/titan.json`. C'est la seule
   * forme sous laquelle ce test dit quelque chose.
   */
  await boot(page, 'titan/');

  const missions = block(page);
  await expect(missions).toBeVisible({ timeout: 15_000 });
  expect(answered, 'la liste de Titan n’a jamais été servie').toContain(200);

  const items = missions.locator('li');
  await expect(items).toHaveCount(INDEX.bodies['titan']!.count);
  // Cassini est dans la liste que le PDS déclare sur Titan, avec son intervalle. Le nom est
  // celui que l'archive PUBLIE : on le cherche tel quel.
  await expect(missions).toContainText('Cassini-Huygens');
});

test('un corps sans mission le DIT, au lieu de masquer le bloc', async ({
  page,
}) => {
  // Éris est l'un des dix corps qu'aucune mission ne déclare. Masquer le bloc laisserait croire
  // à un chargement en cours ; la phrase dit ce qui est mesuré.
  expect(INDEX.bodies['eris']!.count).toBe(0);
  await boot(page, '?body=eris');
  const missions = block(page);
  await expect(missions).toBeVisible({ timeout: 15_000 });
  await expect(missions.locator('li')).toHaveCount(1);
  await expect(missions).toContainText(/Aucune mission|No mission/);
});

test('revenir sur un corps déjà vu réaffiche son bloc', async ({ page }) => {
  // Un aller-retour entre deux corps, qui est ce qu'une personne fait vraiment. Ce scénario NE
  // PROUVE PAS la remise à zéro défensive de `rendered` dans `ui/missionsBlock.ts` : j'ai essayé
  // de le falsifier en retirant cette ligne, et il reste vert, parce que `bodyInfo.hide()` met
  // déjà le corps courant à null dès que la palette s'ouvre. Il couvre le parcours, pas la ligne,
  // et c'est écrit ici pour que personne ne le croie plus fort qu'il n'est.
  await boot(page, '?body=titan');
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  const titan = await block(page).locator('li').count();
  expect(titan).toBeGreaterThan(0);

  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-europa').click();
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await expect(block(page)).toContainText('Galileo');

  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-titan').click();
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await expect(block(page).locator('li')).toHaveCount(titan);
  await expect(block(page)).toContainText('Cassini-Huygens');

  /**
   * LE DÉTOUR PAR LA VUE GLOBALE, ajouté au lot 42, et c'est LE chemin qui discrimine. Seul le
   * retour à la vue globale appelle `bodyInfo.hide()`, qui remet le corps courant à `null` ;
   * ouvrir la palette ne le fait PAS. Ce lot a ajouté un raccourci qui retient la fiche dont on
   * sait qu'elle n'a rien à montrer, pour ne pas redemander sa liste toutes les 500 ms
   * indéfiniment, et sa MAUVAISE forme laisserait ici le bloc masqué en revenant. Mesuré : sans
   * ces six lignes, cette variante passe les six scénarios de ce fichier.
   */
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();
  await expect(block(page)).toBeHidden();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-titan').click();
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await expect(block(page).locator('li')).toHaveCount(titan);
});

test('une SONDE n’affiche aucun bloc missions, et n’en demande pas la liste', async ({
  page,
}) => {
  // La fiche s'ouvre aussi pour une sonde et pour un objet interstellaire
  // (`config/navigable.ts`), et l'index ne porte que les CORPS. Sans la distinction entre « zéro
  // mission » et « pas un corps du catalogue », Voyager 1 afficherait « aucune mission ne déclare
  // ce corps » : une mission n'est pas la cible d'une archive, elle en est l'auteur.
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/missions/')) asked.push(r.url());
  });
  await boot(page, '?body=voyager1');
  await expect(page.locator('#body-info')).toBeVisible({ timeout: 15_000 });
  // Laisser passer plusieurs synchronisations : le bloc se remplit à la cadence de l'interface.
  await page.waitForTimeout(2000);
  await expect(block(page)).toBeHidden();
  expect(asked, `demandé pour une sonde : ${asked.join(', ')}`).toEqual([]);
});

test('la DATE de la scène change la réponse', async ({ page }) => {
  // Le coeur du lot : le bloc n'est pas une liste, c'est une réponse à « quand ». En 1980 aucune
  // des missions de Titan n'a commencé selon ce que l'archive déclare, sauf Voyager (1972) ; en
  // 2005 Cassini a commencé aussi. Le compte de lignes MARQUÉES doit donc croître.
  const marked = async (): Promise<number> =>
    await block(page).locator('li.is-at-date').count();

  await boot(page, '?body=titan&date=1980-01-01');
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  const early = await marked();

  await boot(page, '?body=titan&date=2005-06-01');
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  const later = await marked();

  expect(
    later,
    `missions commencées : ${early} en 1980, ${later} en 2005`
  ).toBeGreaterThan(early);
  expect(early, 'aucune mission marquée en 1980').toBeGreaterThan(0);
});
