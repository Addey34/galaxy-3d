import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LA DÉCOUVERTE, DANS UN VRAI NAVIGATEUR (lot 44, ligne 22.10).
 *
 * Ce que ce scénario prouve et qu'aucun test unitaire ne peut prouver :
 *  - que RIEN n'est demandé au démarrage ;
 *  - que l'adresse de la liste des satellites RÉSOUT quand le corps est porté par le CHEMIN
 *    (`/jupiter/`), seule forme sous laquelle une adresse relative casserait (lot 42) ;
 *  - et que la DATE DE LA SCÈNE change la réponse : c'est la question même du réservoir de
 *    vision, « que savait-on de Jupiter en 1609, en 1610 », posée en déplaçant l'horloge.
 *
 * Les nombres attendus sont LUS dans la donnée livrée, jamais recopiés.
 */

const ROOT = resolve(import.meta.dirname, '..');
const systemOf = (body: string): { years: number[] }[] =>
  JSON.parse(
    readFileSync(resolve(ROOT, `public/assets/discovery/${body}.json`), 'utf-8')
  ) as { years: number[] }[];
const JUPITER_TOTAL = systemOf('jupiter').length;
const KNOWN_BEFORE = (year: number): number =>
  systemOf('jupiter').filter((s) => s.years.every((y) => y < year)).length;

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

async function boot(page: Page, path: string): Promise<void> {
  await page.goto(`/${path}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
}

const block = (page: Page) => page.locator('#body-info .bi-discovery');

test('ne demande NI l’index NI aucune liste au démarrage', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/assets\/discovery\/|discoveryIndex/.test(r.url())) asked.push(r.url());
  });
  await boot(page, '');
  expect(asked, `demandé au démarrage : ${asked.join(', ')}`).toEqual([]);
});

test('Jupiter en 1609 puis en 1611 : zéro lune, puis les quatre de Galilée', async ({
  page,
}) => {
  const answered: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/assets/discovery/jupiter.json'))
      answered.push(r.status());
  });
  await boot(page, 'jupiter/?date=1609-06-01T12:00:00Z');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  expect(answered, 'la liste de Jupiter n’a jamais été servie').toContain(200);

  await expect(discovery).toContainText('Since prehistoric times');
  await expect(discovery.locator('.bi-discovery-moons')).toHaveText(
    `Moons already seen at this date: 0 of the ${JUPITER_TOTAL} the JPL lists today`
  );
  await expect(discovery.locator('.bi-discovery-next')).toHaveText(
    /^Next discovery: 1610 \((Io|Europa|Ganymede|Callisto)(, (Io|Europa|Ganymede|Callisto)){3}\)$/
  );

  await boot(page, 'jupiter/?date=1611-06-01T12:00:00Z');
  await expect(block(page).locator('.bi-discovery-moons')).toHaveText(
    `Moons already seen at this date: ${KNOWN_BEFORE(1611)} of the ${JUPITER_TOTAL} the JPL lists today`,
    { timeout: 15_000 }
  );
  expect(KNOWN_BEFORE(1611)).toBe(4);
});

test('Titan, avant et après 1655', async ({ page }) => {
  await boot(page, 'titan/?date=1650-01-01T12:00:00Z');
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await expect(block(page)).toContainText('C. Huygens');
  await expect(block(page).locator('.bi-discovery-standing')).toHaveText(
    'At the date of the scene, this body was not yet known.'
  );
  await boot(page, 'titan/?date=1700-01-01T12:00:00Z');
  await expect(block(page).locator('.bi-discovery-standing')).toHaveText(
    'At the date of the scene, this body was already known.',
    { timeout: 15_000 }
  );
});

test('Pluton entre ses deux dates publiées : les deux sources, et aucune tranchée', async ({
  page,
}) => {
  await boot(page, 'pluto/?date=1930-02-01T12:00:00Z');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery.locator('.bi-discovery-claims li')).toHaveCount(2);
  await expect(discovery).toContainText('January 23, 1930');
  await expect(discovery).toContainText('February 18, 1930');
  await expect(discovery.locator('.bi-discovery-standing')).toHaveText(
    /falls between the published dates/
  );
  // Le TEXTE de la ligne, pas son rendu : sans séparateur réel, un lecteur d'écran lisait
  // « 1930Tombaugh », la marge CSS ne séparant les deux qu'à l'œil. Trouvé en lisant le rendu.
  for (const text of await discovery
    .locator('.bi-discovery-claims li')
    .allTextContents())
    expect(text).not.toMatch(/\d{4}[A-Za-z]/);
});

test('Halley : un retour prédit, jamais une découverte en 1758', async ({
  page,
}) => {
  await boot(page, 'halley/');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery).toContainText(
    'Predicted return, observed on December 25, 1758'
  );
  await expect(discovery).toContainText('Ancient observations');
  // Connue depuis l'Antiquité : aucune phrase d'état ne dit « pas encore connue » ni « connue ».
  await expect(discovery.locator('.bi-discovery-standing')).toBeHidden();
});

test('la Terre n’affiche aucun bloc, et revenir sur Titan le réaffiche', async ({
  page,
}) => {
  await boot(page, 'earth/');
  await expect(page.locator('#body-info')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  // Vérifier le BLOC et non un ancêtre : `toBeHidden()` serait vrai si la fiche l'était (lot 42).
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(block(page)).toBeHidden();

  // Le détour par la vue globale est le chemin qui discrimine le cas vide retenu (lot 42).
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-titan').click();
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();
  await expect(page.locator('#body-info')).toBeVisible({ timeout: 15_000 });
  await expect(block(page)).toBeHidden();
});
