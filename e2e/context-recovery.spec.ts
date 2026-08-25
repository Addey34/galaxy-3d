import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Simule une vraie perte/restauration de contexte WebGL (extension WEBGL_lose_context,
 * le même mécanisme que Chrome DevTools "Restart frame"/"Lose WebGL context" ou qu'un
 * reset driver réel) et vérifie que la bannière de reconnexion (src/ui/contextRecovery.ts)
 * apparaît puis disparaît, et que l'app continue de rendre après restauration.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
  });
});

test('shows a reconnect banner on WebGL context loss and hides it on restore', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const banner = page.locator('#context-recovery-banner');
  await expect(banner).toBeHidden();

  const canLoseContext = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    (window as unknown as { __loseCtx: typeof ext }).__loseCtx = ext;
    ext.loseContext();
    return true;
  });
  test.skip(!canLoseContext, 'WEBGL_lose_context unsupported in this browser');

  await expect(banner).toBeVisible({ timeout: 5000 });

  await page.evaluate(() => {
    (
      window as unknown as { __loseCtx: { restoreContext: () => void } }
    ).__loseCtx.restoreContext();
  });

  await expect(banner).toBeHidden({ timeout: 5000 });

  // Le rendu doit continuer normalement après restauration : le canvas reste attaché
  // et aucune erreur fatale non gérée n'a été levée par la boucle d'animation.
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await expect(page.locator('canvas').first()).toBeVisible();
});
