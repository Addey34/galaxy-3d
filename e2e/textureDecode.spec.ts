import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES TEXTURES DES CORPS SONT DÉCODÉES HORS DU FIL PRINCIPAL (lot 54), ET LE GPU REÇOIT LES MÊMES
 * PIXELS. `TextureSystem` passe par `createImageBitmap` (retournée au décodage) au lieu d'une
 * `<img>` ; une image retournée ou décalée n'émettrait aucune erreur. La sonde `?debug-perf`
 * rend la même texture par les deux chemins dans une petite cible et rend l'écart maximal.
 */
test('a body texture reaches the GPU with the same pixels as through an <img>', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.goto('/?debug-perf&date=2024-07-01T12:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.waitForFunction(() => 'perfProbe' in window, null, {
    timeout: 60_000,
  });
  for (const [path, quality] of [
    ['earth/earth_surface', '1k'],
    ['mars/mars_surface', '1k'],
  ] as const) {
    const result = await page.evaluate(
      ([p, q]) =>
        (
          window as unknown as {
            perfProbe: {
              decodeEquivalence: (
                p: string,
                q: string
              ) => Promise<{ maxDiff: number; url: string }>;
            };
          }
        ).perfProbe.decodeEquivalence(p, q),
      [path, quality]
    );
    expect(result.url, path).toContain(`${path}_${quality}.jpg`);
    expect(result.maxDiff, path).toBeLessThanOrEqual(2);
  }
});
