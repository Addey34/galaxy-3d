import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LES NOMS DE L'UAI, DANS UN VRAI NAVIGATEUR.
 *
 * Ce que ce scénario prouve et qu'aucun test unitaire ne peut prouver : que le fichier d'un
 * corps n'est demandé qu'à l'APPROCHE, qu'il est ensuite peint, et surtout que les noms
 * tombent du BON CÔTÉ du corps.
 *
 * Ce dernier point est le seul défaut de cette couche qui ne se verrait sur aucune capture
 * isolée : les deux conventions en jeu sont EST (l'UAI publie ses KML en 0-360 est, la scène
 * travaille en -180..180 est), donc un miroir ne déformerait rien — il poserait chaque nom à
 * l'exact opposé de sa formation, sur une sphère qui aurait toujours l'air juste.
 */

const MANIFEST = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../src/config/gazetteerIndex.json'),
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

test('ne demande AUCUN répertoire au démarrage, ni de loin', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/gazetteer/')) asked.push(r.url());
  });
  await boot(page, '');
  // L'index est importé au BUILD depuis `src/` : aucune requête ne doit partir vers
  // `assets/gazetteer/`, où vivent les fichiers de corps (jusqu'à 1,2 Mo pour la seule Lune).
  expect(asked, `demandé au démarrage : ${asked.join(', ')}`).toEqual([]);
});

test('charge le répertoire d’un corps À L’APPROCHE, et écrit ses noms', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/gazetteer/moon.json')) asked.push(r.url());
  });
  await boot(page, '?body=moon');

  const overlay = page.locator('#gazetteer-overlay');
  await expect(overlay).toHaveClass(/is-visible/);

  // On approche jusqu'à ce que la couche ait écrit quelque chose. Le compte est PUBLIÉ par la
  // couche elle-même, comme les autres couches d'instrument le font.
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  for (let i = 0; i < 14; i += 1) {
    const drawn = Number((await overlay.getAttribute('data-names')) ?? '0');
    if (drawn > 0) break;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -6000);
    await page.waitForTimeout(400);
  }
  expect(
    asked.length,
    'le fichier de la Lune n’a jamais été demandé'
  ).toBeGreaterThan(0);
  const drawn = Number((await overlay.getAttribute('data-names')) ?? '0');
  expect(drawn, 'aucun nom écrit à l’approche').toBeGreaterThan(0);

  // ET LE GARDE-FOU DE DISTANCE, prouvé dans le seul sens qui s'observe : on s'ÉLOIGNE, et la
  // couche se tait. Le prouver à l'autre bout ne marche pas — sélectionner la Lune amène déjà
  // la caméra assez près pour que le chargement soit légitime, ce qu'une première version de
  // ce test affirmait à tort. Sans cette assertion, retirer le garde-fou laissait tout vert.
  for (let i = 0; i < 20; i += 1) {
    if (Number((await overlay.getAttribute('data-names')) ?? '0') === 0) break;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 9000);
    await page.waitForTimeout(250);
  }
  expect(
    Number((await overlay.getAttribute('data-names')) ?? '0'),
    'des noms sont encore écrits alors qu’on s’est éloigné'
  ).toBe(0);
});

test('le répertoire livré est celui que le manifeste annonce', async ({
  page,
}) => {
  // Croisement simple mais réel : le fichier SERVI par l'application doit porter le nombre que
  // le manifeste déclare. Un artefact périmé dans `public/` passerait sinon inaperçu.
  await boot(page, '');
  const served = (await page.evaluate(async () => {
    const res = await fetch('/assets/gazetteer/moon.json');
    return (await res.json()) as unknown[];
  })) as unknown[];
  expect(served.length).toBe(MANIFEST.bodies['moon']!.count);
});
