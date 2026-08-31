import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('VR button stays hidden with no XR runtime (default headless Chromium)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Chromium headless expose bien `navigator.xr`, mais `isSessionSupported` y résout
  // toujours à `false` faute de runtime XR : ui/webxr.ts doit laisser le bouton masqué
  // sans jamais lever d'erreur (cf. share.ts, même philosophie de repli silencieux).
  await expect(page.locator('#webxr-btn')).toBeHidden();
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('VR button stays hidden when the runtime reports no immersive-vr support', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // navigator.xr est un accesseur en lecture seule sur Navigator.prototype dans Chromium
    // (présent même sans runtime XR) : une simple affectation serait un no-op silencieux,
    // il faut redéfinir la propriété en propriété propre pour masquer le getter du prototype.
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: { isSessionSupported: () => Promise.resolve(false) },
    });
  });

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(200); // laisse la promesse isSessionSupported se résoudre

  await expect(page.locator('#webxr-btn')).toBeHidden();
});

test('VR button appears for a supported runtime and requests a session on click', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: {
        isSessionSupported: () => Promise.resolve(true),
        requestSession: () => {
          (window as unknown as { __xrRequested: boolean }).__xrRequested =
            true;
          // Aucun vrai runtime XR en CI : rejet attendu, exactement le chemin que
          // ui/webxr.ts avale silencieusement (cf. le .catch() dédié).
          return Promise.reject(new Error('no XR runtime in CI'));
        },
      },
    });
  });

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const button = page.locator('#webxr-btn');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('title', 'Enter VR');

  await button.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__xrRequested))
    .toBe(true);

  // Le rejet de requestSession ne doit ni crasher l'app ni changer le libellé du bouton.
  await expect(button).toHaveAttribute('title', 'Enter VR');
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
