import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * PROFIL D'APPAREIL MOBILE RÉEL, et le geste tactile.
 *
 * Les autres scénarios « mobile » de cette suite ne changent que le VIEWPORT. Ce n'est pas rien
 * — vérifié : `isLowPowerDevice` a un filet « petit écran » (côté court < 768 et côté long
 * < 1024), donc `IS_MOBILE` bascule bien et le rendu allégé est réellement exercé. Mais deux
 * choses leur échappent, et ce sont exactement celles qu'un vrai téléphone apporte :
 *
 *   - `navigator.maxTouchPoints` reste à 0, donc la branche TACTILE de la détection
 *     (`signals.touch && côté long <= 1280`, celle qui capte les tablettes) n'est couverte que
 *     par des tests unitaires purs, jamais de bout en bout ;
 *   - aucun GESTE tactile n'est joué. Le glissement à un doigt sur OrbitControls — le seul
 *     moyen de tourner la caméra sur un téléphone — n'est testé nulle part.
 *
 * Un émulateur Android complet coûterait plusieurs gigaoctets pour ne rien ajouter à ces deux
 * points : il ne donnerait toujours ni GPU réel ni comportement thermique. Le descripteur
 * d'appareil de Playwright suffit à couvrir ce qui est couvrable.
 */

test.use({ ...devices['Pixel 7'] });

/** Signature du rendu : somme pondérée d'un échantillon de pixels du canvas WebGL. */
async function frameSignature(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector('canvas');
    if (!source) return -1;
    const copy = document.createElement('canvas');
    copy.width = 64;
    copy.height = 64;
    const context = copy.getContext('2d');
    if (!context) return -1;
    context.drawImage(source, 0, 0, 64, 64);
    const { data } = context.getImageData(0, 0, 64, 64);
    let signature = 0;
    for (let i = 0; i < data.length; i += 4)
      signature +=
        (data[i] ?? 0) + (data[i + 1] ?? 0) * 2 + (data[i + 2] ?? 0) * 3;
    return signature;
  });
}

/** Glissement à un doigt : touchStart, plusieurs touchMove, touchEnd. */
async function touchDrag(
  page: Page,
  context: BrowserContext,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / 8,
          y: from.y + ((to.y - from.y) * step) / 8,
        },
      ],
    });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('boots on a real phone profile, touch capability included', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });

  // Le descripteur s'applique VRAIMENT — sans cette vérification, un test tactile qui échoue à
  // toucher passerait pour un test de bureau silencieux.
  const profile = await page.evaluate(() => ({
    touchPoints: navigator.maxTouchPoints,
    ratio: window.devicePixelRatio,
    mobileAgent: /Android|iPhone/i.test(navigator.userAgent),
  }));
  expect(profile.touchPoints).toBeGreaterThan(0);
  expect(profile.ratio).toBeGreaterThan(1);
  expect(profile.mobileAgent).toBe(true);

  expect(pageErrors).toEqual([]);
});

test('a one-finger drag on the canvas turns the camera', async ({
  page,
  context,
}) => {
  await page.goto('/?body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  // Simulation en pause : la scène devient statique, donc tout changement d'image vient du
  // geste et de rien d'autre.
  await page.locator('#play-pause-btn').click();
  await page.waitForTimeout(1500);

  // AUTO-VALIDATION : deux relevés identiques prouvent que l'image est stable. Sans cela, ce
  // test passerait tout aussi bien si le geste ne faisait rien et que la scène bougeait seule.
  const first = await frameSignature(page);
  await page.waitForTimeout(600);
  const second = await frameSignature(page);
  expect(first).toBeGreaterThan(0);
  expect(second).toBe(first);

  const box = page.viewportSize();
  const midX = Math.round((box?.width ?? 390) / 2);
  const midY = Math.round((box?.height ?? 844) / 2);
  await touchDrag(
    page,
    context,
    { x: midX - 90, y: midY },
    { x: midX + 90, y: midY }
  );
  await page.waitForTimeout(1000);

  expect(await frameSignature(page)).not.toBe(second);
});
