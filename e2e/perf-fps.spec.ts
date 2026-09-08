import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Mesure de FPS RÉELLE (pas une estimation) sous ralentissement CPU — le meilleur proxy
 * qu'on puisse faire tourner sans matériel mobile physique : le même principe que le mode
 * throttling « Mid-tier mobile » de Chrome DevTools/Lighthouse (CPU 4x plus lent), qui
 * approxime un appareil milieu de gamme. Ce n'est PAS une mesure sur un vrai téléphone —
 * l'écart réel (GPU mobile, thermal throttling, mémoire partagée) n'est pas capturé ici.
 * Sert à détecter une RÉGRESSION nette de perf, pas à certifier un chiffre absolu.
 */

/**
 * PLANCHERS DE FPS — deux jeux, parce qu'un plancher absolu n'a pas de sens ici.
 *
 * Ce test ne certifie pas une fluidité : il détecte un DECROCHAGE (boucle bloquée, scène
 * figée), où le framerate tombe vers zéro. Le chiffre qui sépare « lent » de « cassé »
 * dépend entièrement de la machine, et l'écart entre les deux environnements est d'un
 * facteur ~2,5. Mesures réelles :
 *
 *                          poste de dev        runner GitHub (GPU logiciel, VM partagée)
 *   desktop                13,3 - 14,0         4,3 - 5,7
 *   4x throttlé            ~10,3               3,7 - 4,7
 *   mobile 4x throttlé     ~59                 23,3
 *
 * Les anciens seuils (10 et 8) avaient été calibrés sur un rendu logiciel LOCAL mesuré à
 * ~15 fps, pas sur le runner : en CI ils échouaient systématiquement, retries compris. Le
 * défaut n'a jamais été vu parce que le job e2e n'avait jamais abouti — 22 des 25 derniers
 * runs annulés par timeout. Un job rouge en permanence ne signale plus rien : on apprend à
 * ignorer sa couleur, ce qui coûte plus cher que l'absence de test.
 *
 * Les planchers CI gardent ~2x de marge sous la mesure la plus basse observée, ce qui laisse
 * passer la lenteur du runner et attrape toujours un vrai blocage (qui donne 0-1 fps).
 */
const IS_CI = Boolean(process.env.CI);
const FPS_FLOOR = {
  desktop: IS_CI ? 2 : 10,
  throttled: IS_CI ? 1.5 : 8,
  mobileThrottled: IS_CI ? 5 : 8,
};

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

/** Échantillonne le framerate réel (rAF) pendant `durationMs`, caméra en orbite continue. */
async function measureFps(
  page: import('@playwright/test').Page,
  durationMs: number
): Promise<number> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    // Orbite continue pendant la mesure : sollicite le rendu comme une vraie interaction,
    // pas une scène figée (qui masquerait un vrai coût de rendu par frame).
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
  }

  const frameCount = await page.evaluate(async (ms) => {
    let frames = 0;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        frames++;
        if (performance.now() - start < ms) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return frames;
  }, durationMs);

  if (box) {
    const cx = box.x + box.width / 2;
    await page.mouse.move(cx + 150, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
  }

  return (frameCount / durationMs) * 1000;
}

test('measures real FPS on desktop (baseline, no throttling)', async ({
  page,
}) => {
  await page.goto('/?mode=explo&body=jupiter');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(2000);

  const fps = await measureFps(page, 3000);
  console.log(`[perf] Desktop baseline FPS: ${fps.toFixed(1)}`);
  // Garde-fou large : détecte un vrai plantage/blocage du rendu, pas une variation de perf
  // (cf. `FPS_FLOOR` pour les mesures des deux environnements).
  expect(fps).toBeGreaterThan(FPS_FLOOR.desktop);
});

test('measures real FPS under 4x CPU throttling (Lighthouse-style mid-tier mobile proxy)', async ({
  page,
  context,
}) => {
  await page.goto('/?mode=explo&body=jupiter');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(2000);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const fps = await measureFps(page, 3000);
  console.log(
    `[perf] 4x CPU-throttled FPS (mid-tier mobile proxy): ${fps.toFixed(1)}`
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // Seuil bas et volontairement permissif : ce test veut détecter un décrochage complet
  // (scène figée, boucle bloquée), pas fixer un objectif de fluidité — voir le commentaire
  // d'en-tête sur les limites de ce proxy vs un vrai appareil.
  expect(fps).toBeGreaterThan(FPS_FLOOR.throttled);
});

test.describe('mobile viewport + CPU throttling', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('measures real FPS on a mobile viewport under 4x CPU throttling', async ({
    page,
    context,
  }) => {
    await page.goto('/?mode=explo&body=jupiter');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    await page.waitForTimeout(2000);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    const fps = await measureFps(page, 3000);
    console.log(
      `[perf] Mobile viewport, 4x CPU-throttled FPS: ${fps.toFixed(1)}`
    );
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    expect(fps).toBeGreaterThan(FPS_FLOOR.mobileThrottled);
  });
});
