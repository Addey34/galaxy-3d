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

test('the overview downloads no shape model at all, in either mode', async ({
  page,
}) => {
  // GAL-ENGINE-HEADROOM-001 : un corps à quelques pixels garde sa sphère ; ni le chargeur glTF ni
  // aucun maillage ne partent au démarrage de la vue d'ensemble (avant : 23 fichiers, ~1 Mio).
  expect(await glbRequestsFor(page, 'high', '/?mode=educ')).toEqual([]);
});

test('the overview of the exploration mode downloads no shape model either', async ({
  page,
}) => {
  expect(await glbRequestsFor(page, 'high', '/?mode=explo')).toEqual([]);
});

test('targeting a body sends its lightest mesh during the flight, before the camera arrives', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests: { file: string; at: number }[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.endsWith('.glb'))
      requests.push({ file: url.split('/').pop()!, at: Date.now() });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?mode=explo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await page.waitForTimeout(3000);
  expect(requests).toEqual([]);

  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-bennu').click();
  // Le niveau léger part tout de suite (le corps est CIBLÉ, il n'attend pas le seuil de distance).
  await expect
    .poll(() => requests.some((r) => r.file === 'bennu_shape_1k.glb'), {
      timeout: 15_000,
    })
    .toBe(true);
  const light = requests.find((r) => r.file === 'bennu_shape_1k.glb')!;
  // Et il part pendant le vol : le canvas dit encore « en mouvement » une demi-seconde plus tard,
  // ou le vol vient de finir ; jamais un maillage demandé bien APRÈS l'arrivée.
  let arrived = 0;
  await expect
    .poll(
      async () => {
        const moving = await page
          .locator('canvas')
          .first()
          .getAttribute('data-scene-moving');
        if (moving !== '1' && !arrived) arrived = Date.now();
        return arrived > 0;
      },
      { timeout: 60_000, intervals: [100] }
    )
    .toBe(true);
  expect(light.at).toBeLessThanOrEqual(arrived);
  // Une seule fois : le chargeur partagé ne redemande pas le même fichier.
  expect(requests.filter((r) => r.file === 'bennu_shape_1k.glb')).toHaveLength(
    1
  );
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
