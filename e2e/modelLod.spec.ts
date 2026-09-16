import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES MODÈLES DE FORME NE SE TÉLÉCHARGENT QU'AU NIVEAU QUI SE VOIT.
 *
 * Chaque astéroïde modélisé est livré en `_shape_1k/2k/4k.glb` (~70 Kio, ~270 Kio, ~1,1 Mio).
 * La promesse de fluidité tient à deux règles que seul le navigateur peut vérifier, en comptant
 * les fichiers réellement demandés : la vue d'ensemble ne charge QUE le niveau léger, et le
 * palier de qualité plafonne le niveau même collé au corps. Sans ce test, un chargement « au
 * plus fin » par défaut ferait télécharger ~5 Mio à chaque visiteur, sans rien casser d'autre.
 */
async function glbRequestsFor(
  page: import('@playwright/test').Page,
  quality: string,
  path: string
): Promise<string[]> {
  const requested: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.endsWith('.glb')) requested.push(url.split('/').pop()!);
  });
  await page.addInitScript((q) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-quality', q);
  }, quality);
  await page.goto(path);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  // Le temps que le vol caméra arrive et que le LOD réévalue la distance.
  await page.waitForTimeout(8000);
  return requested;
}

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

test('the overview only downloads the lightest level of each shape model', async ({
  page,
}) => {
  const requested = await glbRequestsFor(page, 'high', '/?mode=educ');
  expect(requested.length).toBeGreaterThan(0);
  for (const file of requested) expect(file, file).toMatch(/_shape_1k\.glb$/);
});

test('medium quality never goes above 2k, even right next to a body', async ({
  page,
}) => {
  const requested = await glbRequestsFor(page, 'medium', '/bennu/?mode=explo');
  // Le niveau fin est bien monté quand on approche…
  expect(requested).toContain('bennu_shape_2k.glb');
  // …mais jamais au-delà du plafond du palier.
  for (const file of requested) expect(file, file).not.toMatch(/_4k\.glb$/);
});
