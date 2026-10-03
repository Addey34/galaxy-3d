import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LES INSTRUMENTS D'UNE SONDE, DANS UN VRAI NAVIGATEUR.
 *
 * Ce que ces scénarios prouvent et qu'aucun test unitaire ne peut prouver :
 *
 *  - que l'actif est bien SERVI, et servi en JSON, depuis une adresse ABSOLUE. Au lot 42 ce
 *    scénario ne pouvait pas le prouver, et le disait : une sonde n'avait pas de page
 *    d'atterrissage, le permalien réécrivait `/voyager1/` en `/?body=voyager1` avant que le bloc ne
 *    demande son fichier, et une adresse relative résolvait donc à la racine quoi qu'il arrive.
 *    DEPUIS LE 2026-10-03 la sonde a sa page et GARDE son chemin : une adresse relative résoudrait
 *    en `/voyager1/assets/…`, et ce scénario rougit (falsifié, cf. la ligne qui exige le chemin) ;
 *  - que RIEN n'est demandé au démarrage : ni l'index, ni aucune liste ;
 *  - qu'une sonde que l'archive ne connaît PAS le DIT, au lieu de masquer son bloc. C'est le choix
 *    du lot 42 : un visiteur qui passe de Cassini à Parker Solar Probe verrait sinon un bloc
 *    disparaître sans savoir pourquoi ;
 *  - qu'un porteur SANS instrument garde sa place (l'orbiteur magnétosphérique de BepiColombo) ;
 *  - et que la DATE DE LA SCÈNE change l'état des investigations, ce qui est ce qui distingue ce
 *    bloc d'une liste : KEM1, l'extension Kuiper de New Horizons, ne peut pas avoir commencé en
 *    2007 et a commencé en 2019.
 */

const INDEX = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../src/config/instrumentIndex.json'),
    'utf-8'
  )
) as {
  spacecraft: Record<string, { hosts: number; instruments: number }>;
  absent: Record<string, true>;
};

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

const block = (page: Page) => page.locator('#body-info .bi-instruments');

test('ne demande NI l’index NI aucune liste au démarrage', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/assets\/instruments\/|instrumentIndex/.test(r.url()))
      asked.push(r.url());
  });
  await boot(page, '');
  expect(asked, `demandé au démarrage : ${asked.join(', ')}`).toEqual([]);
});

test('remplit le bloc sur la fiche d’une sonde, et son adresse RÉSOUT', async ({
  page,
}) => {
  // Les RÉPONSES, et non les seules requêtes : sur ce site la réécriture SPA sert `index.html` en
  // HTTP 200 pour tout chemin inconnu, donc une adresse fausse ressemblerait à un succès.
  const answered: { status: number; type: string }[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/assets/instruments/voyager1.json'))
      answered.push({
        status: r.status(),
        type: r.headers()['content-type'] ?? '',
      });
  });
  /**
   * LE BOOT SE FAIT PAR LE CHEMIN, et le chemin RESTE : c'est ce qui rend la garde d'adresse
   * absolue falsifiable (cf. l'en-tête). Sans cette ligne, une régression qui renverrait la sonde
   * à la racine rendrait la garde muette sans rien dire.
   */
  await boot(page, 'voyager1/');
  await expect(page).toHaveURL(/\/voyager1\/(\?|$)/);

  const instruments = block(page);
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  expect(answered, 'la liste de Voyager 1 n’a jamais été servie').not.toEqual(
    []
  );
  expect(answered[0]!.status).toBe(200);
  // Le `content-type` tranche là où le code HTTP ne dit rien : une coquille SPA serait `text/html`.
  expect(answered[0]!.type).toContain('json');

  await instruments.locator('summary').click();
  const items = instruments.locator('ul > li');
  const expected = INDEX.spacecraft['voyager1']!;
  // Les instruments PLUS l'unique investigation de Voyager 1.
  await expect(items).toHaveCount(expected.instruments + 1);
  // Chaque instrument porte son identifiant logique PDS, qui EST sa citation.
  const lids = instruments.locator('.bi-instruments-lid');
  await expect(lids).toHaveCount(expected.instruments);
  await expect(lids.first()).toContainText('urn:nasa:pds:context:instrument:');
  await expect(instruments.locator('.bi-instruments-count')).toHaveText(
    String(expected.instruments)
  );
});

test('une sonde que l’archive ne connaît pas le DIT, au lieu de masquer le bloc', async ({
  page,
}) => {
  const absent = Object.keys(INDEX.absent);
  expect(
    absent.length,
    'aucune sonde absente : ce scénario ne prouverait rien'
  ).toBeGreaterThan(0);
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/instruments/')) asked.push(r.url());
  });
  await boot(page, `?body=${absent[0]!}`);

  const instruments = block(page);
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  await instruments.locator('summary').click();
  await expect(instruments.locator('.bi-instruments-body')).toContainText(
    /investigation/i
  );
  // Une sonde absente de l'archive ne DEMANDE rien : son fichier n'existe pas, et demander pour
  // recevoir un 404 serait une requête de trop.
  expect(
    asked,
    `demandé alors qu’aucun fichier n’existe : ${asked.join(', ')}`
  ).toEqual([]);
});

test('un CORPS du catalogue n’affiche aucun bloc instruments, et n’en demande pas la liste', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/instruments/')) asked.push(r.url());
  });
  await boot(page, '?body=titan');
  await expect(page.locator('#body-info')).toBeVisible({ timeout: 15_000 });
  // Un corps n'embarque aucun instrument : le bloc masqué est la bonne réponse, pas un aveu.
  await expect(block(page)).toBeHidden();
  expect(asked, `demandé pour un corps : ${asked.join(', ')}`).toEqual([]);
});

test('revenir sur une SONDE déjà vue réaffiche son bloc', async ({ page }) => {
  /**
   * LE SEUL SCÉNARIO QUI ATTRAPE LA MAUVAISE FORME DU RACCOURCI, et il a fallu le mesurer pour le
   * savoir. Le bloc retient la fiche dont il sait qu'elle n'a RIEN à montrer, pour ne pas
   * redemander son archive toutes les 500 ms indéfiniment (19 appels en 10 s avant la correction,
   * 0 après). La première forme que j'avais écrite retenait « la réponse est arrivée » et la
   * confrontait à `!state` : fermer la fiche remettant `state` à `null` sans rien dire de
   * l'archive, une sonde qui EN A une revoyait son bloc masqué en revenant. J'ai POSÉ cette
   * variante boguée : les six autres scénarios sont restés VERTS. Celui-ci rougit.
   */
  await boot(page, '?body=voyager1');
  const instruments = block(page);
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  await instruments.locator('summary').click();
  const before = await instruments.locator('.bi-instruments-lid').count();
  expect(before).toBeGreaterThan(0);

  /**
   * LE DÉTOUR PAR LA VUE GLOBALE, et c'est LE chemin qui compte — il a fallu deux mesures pour le
   * trouver. Seul le retour à la vue globale appelle `bodyInfo.hide()`, qui remet le corps courant
   * à `null` (`src/ui/bodyInfo.ts`) ; ouvrir la palette ne le fait PAS, elle masque la fiche par
   * l'autre mécanisme et `currentBody()` garde sa valeur. C'est donc ici, et nulle part ailleurs,
   * que la mauvaise forme du raccourci laisserait le bloc d'une sonde masqué en revenant.
   */
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();
  await expect(instruments).toBeHidden();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-voyager1').click();
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  await instruments.locator('summary').click();
  await expect(instruments.locator('.bi-instruments-lid')).toHaveCount(before);

  // Et l'aller-retour par un AUTRE corps, qui est l'autre parcours réel.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-titan').click();
  await expect(instruments).toBeHidden();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-voyager1').click();
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  await instruments.locator('summary').click();
  await expect(instruments.locator('.bi-instruments-lid')).toHaveCount(before);
});

test('garde un porteur SANS instrument, témoin BepiColombo', async ({
  page,
}) => {
  await boot(page, '?body=bepicolombo');
  const instruments = block(page);
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  await instruments.locator('summary').click();
  // Trois engins sous une seule investigation : MPO, MMO et le module de transfert. MMO ne déclare
  // aucun instrument, et le masquer ferait disparaître un tiers de la sonde.
  const hosts = instruments.locator('.bi-instruments-host');
  await expect(hosts).toHaveCount(INDEX.spacecraft['bepicolombo']!.hosts);
  await expect(instruments.locator('.bi-instruments-empty')).toHaveCount(1);
});

test('la DATE de la scène TRANCHE entre les trois investigations de New Horizons', async ({
  page,
}) => {
  /**
   * LES TROIS BORNES SONT LUES DANS LA DONNÉE LIVRÉE, jamais supposées — mes premières valeurs
   * étaient fausses de six ans. L'archive déclare : la mission 2006-01-19 → 2016-10-26, KEM1
   * 2016-10-26 → 2022-09-30, KEM2 2022-10-01 → 2024-09-30. Trois dates suffisent donc à prouver
   * que l'horloge de la scène fait partie de la réponse, et pas seulement qu'elle change quelque
   * chose : avant le début, aucune ; en 2019, KEM1 SEULE ; en 2023, KEM2 SEULE.
   */
  await boot(page, '?body=new-horizons&date=2005-01-01');
  const instruments = block(page);
  await expect(instruments).toBeVisible({ timeout: 15_000 });
  await instruments.locator('summary').click();
  await expect(instruments.locator('li.is-at-date')).toHaveCount(0);

  await boot(page, '?body=new-horizons&date=2019-01-01');
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await block(page).locator('summary').click();
  await expect(block(page).locator('li.is-at-date')).toHaveCount(1);
  await expect(block(page).locator('li.is-at-date')).toContainText(
    'Extended Mission 1'
  );

  await boot(page, '?body=new-horizons&date=2023-01-01');
  await expect(block(page)).toBeVisible({ timeout: 15_000 });
  await block(page).locator('summary').click();
  await expect(block(page).locator('li.is-at-date')).toHaveCount(1);
  await expect(block(page).locator('li.is-at-date')).toContainText(
    'Extended Mission 2'
  );
});
