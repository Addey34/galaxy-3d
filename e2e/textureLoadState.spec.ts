import { expect, test } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LE TÉMOIN DU SIGNAL « TEXTURES EN VOL » (ligne 44.3, 2026-10-02).
 *
 * `e2e/mainThread.ts` ne déclare le thread calme que si `data-textures-loading` vaut `0`. Si ce
 * signal se taisait (publication retirée, notification oubliée), l'attente redeviendrait celle
 * d'avant, fondée sur la seule durée des images, sans que rien ne rougisse : elle se déclarait
 * alors satisfaite ENTRE deux couches de la Terre, juste avant la suivante, qui fige l'image 2,5
 * à 5 s en rendu logiciel. Ce scénario exige donc que le compte MONTE à l'arrivée sur la Terre,
 * puis retombe à zéro.
 */
test('selecting the Earth raises the in-flight texture count, then it settles to zero', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await waitForCalmMainThread(page);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-textures-loading', /^\d+$/);

  // Le plus haut compte vu pendant l'approche, relevé à chaque image côté page : un sondage
  // depuis le test pourrait tomber entre deux couches et ne jamais voir que des zéros.
  await page.evaluate(() => {
    const w = window as unknown as { __maxTexturesLoading?: number };
    w.__maxTexturesLoading = 0;
    const el = document.querySelector('canvas')!;
    new MutationObserver(() => {
      const n = Number(el.dataset['texturesLoading'] ?? '0');
      w.__maxTexturesLoading = Math.max(w.__maxTexturesLoading ?? 0, n);
    }).observe(el, {
      attributes: true,
      attributeFilter: ['data-textures-loading'],
    });
  });

  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __maxTexturesLoading?: number })
              .__maxTexturesLoading ?? 0
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-textures-loading', '0', {
    timeout: 90_000,
  });
});
