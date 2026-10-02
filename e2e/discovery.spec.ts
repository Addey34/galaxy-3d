import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';
import { MOON_SCENE_DATE } from './moonScene';

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

/**
 * LIGNE 22.10, PAS 2 : un petit corps que la table du JPL n'a pas en section compte ses
 * satellites par SBDB. Ida boote par son CHEMIN (`/ida/`), comme Jupiter, pour que l'adresse
 * de sa liste soit éprouvée là où une adresse relative casserait ; et la NOTE doit nommer la
 * liste réellement comptée, pas la table du JPL.
 */
test('Ida en 1990 puis en 1995 : Dactyl, compté par SBDB, et la note le dit', async ({
  page,
}) => {
  const [dactyl] = systemOf('ida') as { name: string; years: number[] }[];
  expect(dactyl?.years).toEqual([1993]);
  await boot(page, 'ida/?date=1990-06-01T12:00:00Z');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery.locator('.bi-discovery-moons')).toHaveText(
    'Moons already seen at this date: 0 of the only one the JPL lists today'
  );
  await expect(discovery.locator('.bi-discovery-next')).toHaveText(
    `Next discovery: 1993 (${dactyl!.name})`
  );
  await expect(discovery.locator('.bi-discovery-note')).toHaveText(
    /^This count only includes the satellites the JPL Small-Body Database confirms today, read on /
  );

  await boot(page, 'ida/?date=1995-06-01T12:00:00Z');
  await expect(block(page).locator('.bi-discovery-moons')).toHaveText(
    'Moons already seen at this date: 1 of the only one the JPL lists today',
    { timeout: 15_000 }
  );
  await expect(block(page).locator('.bi-discovery-next')).toBeHidden();
});

test('Makemake en 2010 : une lune sans nom UAI, nommée par sa désignation', async ({
  page,
}) => {
  await boot(page, 'makemake/?date=2010-06-01T12:00:00Z');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery.locator('.bi-discovery-next')).toHaveText(
    'Next discovery: 2015 (S/2015 (136472) 1)'
  );
});

/**
 * LIGNE 22.10, FRONT DES NOMS : les noms de surface que l'UAI avait rendus officiels à la date de
 * la scène. Pluton est le cas qui raconte l'exploration (aucun nom avant New Horizons, puis une
 * adoption datée au JOUR) ; la Lune est celui des deux pièges (une année seule, et les
 * désignations lettrées comptées à part). Les nombres sont LUS dans l'index livré.
 */
type Step = [string, number, number];
const adoptionIndex = JSON.parse(
  readFileSync(resolve(ROOT, 'src/config/gazetteerAdoptionIndex.json'), 'utf-8')
) as {
  bodies: Record<string, { total: number; lettered: number; steps: Step[] }>;
};
const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n);

test('Pluton avant et après le 8 août 2017 : ses premiers noms officiels', async ({
  page,
}) => {
  const pluto = adoptionIndex.bodies.pluto!;
  const [first, firstCount] = pluto.steps[0]!;
  expect(first).toBe('2017-08-08');
  await boot(page, 'pluto/?date=2017-06-01T12:00:00Z');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery.locator('.bi-discovery-names')).toHaveText(
    `Surface names the IAU had made official at this date: 0 of ${fmt(pluto.total)}`
  );
  // Aucune désignation lettrée sur Pluton : la ligne n'existe pas, plutôt que « 0 sur 0 ».
  await expect(discovery.locator('.bi-discovery-lettered')).toBeHidden();
  await expect(discovery.locator('.bi-discovery-names-next')).toHaveText(
    `Next adoption: August 8, 2017, ${firstCount} more`
  );
  await expect(discovery.locator('.bi-discovery-names-note')).toHaveText(
    /not the date the feature was first seen or named\.$/
  );

  await boot(page, 'pluto/?date=2017-09-01T12:00:00Z');
  await expect(block(page).locator('.bi-discovery-names')).toHaveText(
    `Surface names the IAU had made official at this date: ${firstCount} of ${fmt(pluto.total)}`,
    { timeout: 15_000 }
  );
});

/** Ce que l'index compte avant (ou jusqu'à) une année, noms propres ou lettrés. */
const counted = (
  body: string,
  pick: (on: string) => boolean,
  column: 'named' | 'lettered'
): number =>
  adoptionIndex.bodies[body]!.steps.filter(([on]) => pick(on)).reduce(
    (sum, [, names, letters]) =>
      sum + (column === 'lettered' ? letters : names - letters),
    0
  );

test('Mars en 1976 : une année d’adoption sans jour publié rend une BORNE', async ({
  page,
}) => {
  const mars = adoptionIndex.bodies.mars!;
  const before = counted('mars', (on) => on.slice(0, 4) < '1976', 'named');
  const within = counted('mars', (on) => on.slice(0, 4) <= '1976', 'named');
  // L'année 1976 est publiée SANS jour pour au moins un nom (sinon ce test ne prouverait rien).
  expect(mars.steps.some(([on]) => on === '1976')).toBe(true);
  await boot(page, 'mars/?date=1976-06-01T12:00:00Z');
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery.locator('.bi-discovery-names')).toHaveText(
    `Surface names the IAU had made official at this date: between ${fmt(before)} and ${fmt(within)} of ${fmt(mars.total)}`
  );
});

/**
 * La Lune, à la seule date que la suite lui permet (`e2e/moonScene.ts`) : les désignations
 * lettrées ont leur ligne, et la ligne des noms ne les compte PAS. Si la séparation cassait, la
 * première afficherait le total du gazetteer, 9 087 et non le nombre des noms propres.
 */
test('la Lune : les désignations lettrées comptées à part des noms propres', async ({
  page,
}) => {
  const moon = adoptionIndex.bodies.moon!;
  const day = MOON_SCENE_DATE.slice(0, 10);
  const upTo = (on: string): boolean =>
    on.length === 4 ? on < day.slice(0, 4) : on <= day;
  await boot(page, `moon/?date=${MOON_SCENE_DATE}`);
  const discovery = block(page);
  await expect(discovery).toBeVisible({ timeout: 15_000 });
  await expect(discovery.locator('.bi-discovery-names')).toHaveText(
    `Surface names the IAU had made official at this date: ${fmt(counted('moon', upTo, 'named'))} of ${fmt(moon.total - moon.lettered)}`
  );
  await expect(discovery.locator('.bi-discovery-lettered')).toHaveText(
    `Lettered designations such as “Copernicus A” made official at this date: ${fmt(counted('moon', upTo, 'lettered'))} of ${fmt(moon.lettered)}`
  );
});

/**
 * LIGNE 22.10, FRONT DES CROYANCES : ce qu'on a signalé autour de Vénus, puis cherché sans le
 * trouver. Les années et les noms sont LUS dans l'index, que le générateur n'a écrit qu'après
 * avoir retrouvé chacun dans une citation du PDF. Vénus boote par son CHEMIN, pour que le lien
 * de la source soit éprouvé là où une adresse relative casserait.
 */
test('Vénus : le satellite signalé dès 1645, puis la recherche qui n’en trouve aucun', async ({
  page,
}) => {
  const index = JSON.parse(
    readFileSync(resolve(ROOT, 'src/config/discoveryIndex.json'), 'utf-8')
  ) as {
    bodies: {
      venus: {
        refuted: {
          url: string;
          reported: { year: number; who: string };
          later: { who: string };
          notFound: { on: string; radiusKm: number };
        }[];
      };
    };
  };
  const [claim] = index.bodies.venus.refuted;
  const refuted = (p: Page) => block(p).locator('.bi-discovery-refuted');
  const { year, who } = claim!.reported;

  await boot(page, `venus/?date=${year - 45}-06-01T12:00:00Z`);
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await expect(refuted(page)).toBeHidden();

  await boot(page, `venus/?date=${year}-06-01T12:00:00Z`);
  await expect(refuted(page)).toHaveText(
    new RegExp(
      `^In ${year}, the year of the scene, ${who} reports a possible satellite`
    ),
    { timeout: 15_000 }
  );

  await boot(page, 'venus/?date=1700-06-01T12:00:00Z');
  await expect(refuted(page)).toContainText(
    `from ${year} by ${who}, then several more times by other observers, including ${claim!.later.who}.`,
    { timeout: 15_000 }
  );
  await expect(refuted(page)).not.toContainText('found none');
  await expect(refuted(page).locator('a')).toHaveAttribute('href', claim!.url);

  await boot(page, 'venus/?date=2010-06-01T12:00:00Z');
  await expect(refuted(page)).toContainText(
    `A survey submitted on ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(claim!.notFound.on))} found none, down to about ${claim!.notFound.radiusKm} km in radius.`,
    { timeout: 15_000 }
  );
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
