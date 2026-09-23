import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Jusqu'où descend-on vers une surface, et que voit-on une fois en bas ?
 *
 * Deux affirmations, et aucune n'est vérifiable ailleurs qu'ici : le plancher d'approche
 * dépend désormais de la FINESSE DE L'IMAGE du corps visé (unité : `core/surfaceApproach.ts`),
 * et le plan proche ne coupe plus le corps en bas de la descente. Ce second point ne se voit
 * qu'à l'écran : la caméra est bien placée, la distance est juste, le panneau d'info affiche
 * la bonne valeur, et le globe a simplement disparu. Mesuré le 2026-09-20 (Lune invisible
 * sous 17,4 km, Terre sous 63,7 km, Mars sous 33,9 km) avant correction.
 *
 * Le relevé chiffré est lu dans `?debug-surface`, le panneau de mesure de la phase 9B.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/** Descend jusqu'au plancher, puis rend le rapport distance/rayon atteint. */
async function descendToFloor(
  page: import('@playwright/test').Page,
  body: string
): Promise<{ radii: number; clipped: boolean }> {
  await page.goto(`/?debug-surface&mode=explo&body=${body}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  const probe = page.locator('#surface-probe');
  await expect(probe).toContainText(body, { timeout: 30_000 });

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // UN seul événement, très ample : OrbitControls met la distance à l'échelle
  // `0,95 ^ (zoomSpeed × |deltaY| / 100)`, donc ce cran divise la distance par plus de
  // soixante et la descente bute forcément sur `minDistance`. Une rafale de petits crans
  // faisait la même chose en cent fois plus de temps, et dépassait le budget d'un test en CI.
  await page.mouse.wheel(0, -12_000);
  await page.waitForTimeout(1500);

  const text = (await probe.textContent()) ?? '';
  const radii = Number(/\(([\d.]+) R\)/.exec(text)?.[1]);
  return { radii, clipped: text.includes('COUPE LE CORPS') };
}

/** Part des pixels non noirs du rendu WebGL : la seule preuve que le corps est là. */
async function paintedFraction(
  page: import('@playwright/test').Page
): Promise<number> {
  return page.evaluate(() => {
    const gl = document.querySelector(
      'canvas[data-engine]'
    ) as HTMLCanvasElement | null;
    if (!gl) return -1;
    // `preserveDrawingBuffer: true` (SceneSystem, pour ui/capture.ts) rend cette lecture
    // possible sans passer par une capture d'écran.
    const flat = document.createElement('canvas');
    flat.width = 160;
    flat.height = 100;
    const context = flat.getContext('2d');
    if (!context) return -1;
    context.drawImage(gl, 0, 0, flat.width, flat.height);
    const { data } = context.getImageData(0, 0, flat.width, flat.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! + data[i + 1]! + data[i + 2]! > 30) lit++;
    }
    return lit / (flat.width * flat.height);
  });
}

/**
 * Un corps par test, donc un seul démarrage par test : chacun en coûte de trente à soixante
 * secondes sur le GPU logiciel de la CI, et deux descentes dans le même test dépassaient son
 * budget de 120 s (mesuré sur le shard 4, trois tentatives rouges).
 */
test('the approach floor follows the resolution of the body it shows', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // Surface 8k : un texel vaut 1,33 km sur la Lune, donc on descend bas. 1,0737 rayon.
  const moon = await descendToFloor(page, 'moon');
  expect(moon.radii).toBeGreaterThan(1.06);
  expect(moon.radii).toBeLessThan(1.09);

  // En bas de la descente, le corps est encore DESSINÉ : le plan proche reste derrière la
  // surface, et la Lune remplit la vue. Une fraction basse voudrait dire un ciel vide, ce que
  // donnait le plan proche fautif (mesuré : zéro pixel de Lune à 11,8 km d'altitude).
  expect(moon.clipped, 'le plan proche passe devant la surface').toBe(false);
  expect(await paintedFraction(page)).toBeGreaterThan(0.8);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * Le corps témoin de ces deux tests était Encelade, choisie au lot 9B parce qu'elle ne livrait
 * qu'un 1k. Le lot 16 l'a portée à 8k depuis la vraie mosaïque Cassini, et son plancher est
 * tombé à 1,0737 rayon, c'est-à-dire EXACTEMENT celui de la Lune : le test ne comparait plus
 * rien. Deux témoins l'ont remplacée, et le cas 2k est le durable des deux.
 *
 * ⚠️ Déimos, qui ne livre pourtant qu'un 1k, serait un mauvais témoin : mesuré à 2,2569 rayon
 * et non 1,589, son plancher est fixé par autre chose que la finesse de son image (son modèle
 * de forme l'écarte davantage). Il aurait donné un test VERT qui ne mesure pas la règle.
 */
test('a 2k texture stops the descent higher than an 8k one', async ({
  page,
}) => {
  // Titan est le témoin DURABLE du lot : son plafond de 2k n'est pas un choix, c'est la
  // largeur de sa mosaïque ISS publiée, 4040 px, lue à son étiquette PDS3. Aucune texture plus
  // fine ne peut donc le faire descendre plus bas, et ce test ne se périmera pas.
  const titan = await descendToFloor(page, 'titan');
  expect(titan.radii).toBeGreaterThan(1.27);
  expect(titan.radii).toBeLessThan(1.32);
  // La relation, qui est l'affirmation réelle : plus grossier s'arrête PLUS HAUT. Une
  // constante unique pour tout le catalogue rendrait ici la valeur 8k de la Lune (1,0737).
  expect(
    titan.radii,
    'un 2k doit rester au-dessus du plancher 8k'
  ).toBeGreaterThan(1.09);
});

test('a 1k texture stops the descent higher still', async ({ page }) => {
  // Uranus ne livre qu'un 1k parce que son 2k ne portait que 0,04 % de variance de plus
  // (lot 16). C'est donc un témoin de TRIM : si une vraie carte d'Uranus est un jour importée,
  // ce test devra changer de corps, contrairement à celui de Titan ci-dessus.
  const uranus = await descendToFloor(page, 'uranus');
  expect(uranus.radii).toBeGreaterThan(1.55);
  expect(uranus.radii).toBeLessThan(1.63);
});
