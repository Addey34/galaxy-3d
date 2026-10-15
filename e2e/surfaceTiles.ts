import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Request } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * CE QUE PARTAGENT LES DEUX FICHIERS DE L'IMAGERIE DE SURFACE (`surfaceImagery.spec.ts` et
 * `surfaceImageryEarth.spec.ts`). Le fichier unique pesait 21,7 min mesurées sur un EPYC 7763
 * (`e2e/durations.json`, 2026-10-15), soit une machine entière de la CI à lui seul, et la
 * répartition se fait par FICHIER : il a fallu le couper pour descendre sous 20 min.
 */

/**
 * Tuile de test : JPEG 256 x 256 uni, 651 octets, produit par sharp.
 *
 * Un VRAI decodage est exige (`createImageBitmap`), donc une image bricolee a la main ne
 * suffit pas : mesure le 2026-09-21, un PNG 2x2 mal forme rendait
 * « InvalidStateError: The source image could not be decoded » et aucun carreau ne se
 * posait, sans qu'aucune erreur de page ne le dise.
 */
/** Racine du dépôt vue depuis ce fichier : les specs sont des modules ES, sans `__dirname`. */
export const HERE = dirname(fileURLToPath(import.meta.url));

export const TILE_JPEG = Buffer.from(
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRk' +
    'xOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09P' +
    'T09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAEAAQADASIAAhEBAxEB/8QAFQABAQ' +
    'AAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAA' +
    'AAAAAAL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCuAlQAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//Z',
  'base64'
);

export async function serveTiles(page: Page): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    seen.push(route.request());
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  });
  return seen;
}

export async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  // Le chargeur masqué ne veut pas dire « la scène a fini » : cf. `e2e/mainThread.ts`, où la
  // mesure est écrite. Sans cette attente, la molette de `zoomIn` part pendant que le thread
  // est encore saturé, et le moteur de surface commence sa descente en retard.
  await waitForCalmMainThread(page);
}

/** Un cran de molette très ample : OrbitControls met la distance à l'échelle `0,95^(…)`. */
export async function zoomIn(page: Page, delta = -12_000): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}

/** Avant chaque scénario : réseau extérieur coupé, visites et langue fixées. */
export async function prepareSurfacePage(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
}
