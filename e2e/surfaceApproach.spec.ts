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
  // Largement plus de crans qu'il n'en faut : c'est le plancher qui arrête la descente,
  // et l'assertion porte sur la valeur où elle s'arrête.
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
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

test('the approach floor follows the resolution of the body it shows', async ({
  page,
}) => {
  // Surface 8k : un texel vaut 1,33 km sur la Lune, donc on descend bas. 1,0737 rayon.
  const moon = await descendToFloor(page, 'moon');
  expect(moon.radii).toBeGreaterThan(1.06);
  expect(moon.radii).toBeLessThan(1.09);

  // Surface 1k : quatre fois moins fine, donc on s'arrête plus haut. 1,589 rayon.
  // Une constante unique pour tout le catalogue rendrait ici la MÊME valeur que ci-dessus,
  // et c'est exactement le défaut que ce test tient.
  const enceladus = await descendToFloor(page, 'enceladus');
  expect(enceladus.radii).toBeGreaterThan(1.55);
  expect(enceladus.radii).toBeLessThan(1.63);
});

test('the body is still drawn at the bottom of the descent', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const moon = await descendToFloor(page, 'moon');
  expect(moon.clipped, 'le plan proche passe devant la surface').toBe(false);

  // Au plancher, la Lune remplit la vue : une valeur basse signifierait un ciel vide, ce
  // que donnait le plan proche fautif (mesuré : 0 pixel de Lune à 11,8 km d'altitude).
  expect(await paintedFraction(page)).toBeGreaterThan(0.8);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
